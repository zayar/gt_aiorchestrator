import type {
  AnalyzeAssistantRequest,
  AnalyzeAssistantResponse,
  AssistantWarning,
  ConfirmActionResponse,
  PendingActionRecord,
} from "../types/contracts.js";
import type { GTSaleDraftLineItem } from "../types/domain.js";
import type { GTSessionContext } from "../types/session.js";
import { GTApiCoreAdapter } from "../adapters/GTApiCoreAdapter.js";
import { GTCatalogService } from "./GTCatalogService.js";
import { EntityResolutionService } from "./EntityResolutionService.js";
import { RecommendationService } from "./RecommendationService.js";
import { ClarificationService } from "./ClarificationService.js";

const quantityWords: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  a: 1,
  an: 1,
};

const parseQuantity = (segment: string): number => {
  const numeric = segment.match(/\b(\d+)\b/);
  if (numeric?.[1]) {
    return Number(numeric[1]);
  }

  const word = Object.entries(quantityWords).find(([label]) => new RegExp(`\\b${label}\\b`, "i").test(segment));
  return word?.[1] ?? 1;
};

const stripQuantity = (segment: string): string =>
  segment
    .replace(/\b\d+\b/g, " ")
    .replace(/\b(one|two|three|four|five|a|an)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseLineItemPhrases = (transcript: string): string[] =>
  transcript
    .replace(/\b(add|create sale|create sale for|quote|check if|is|in stock)\b/gi, " ")
    .split(/\s+(?:and|plus)\s+|,/i)
    .map((segment) => segment.trim())
    .filter(Boolean);

export class SaleOrchestrator {
  constructor(
    private readonly apiCoreAdapter: GTApiCoreAdapter,
    private readonly catalogService: GTCatalogService,
    private readonly entityResolutionService: EntityResolutionService,
    private readonly recommendationService: RecommendationService,
    private readonly clarificationService: ClarificationService,
  ) {}

  async analyze(params: {
    requestId: string;
    transcript: string;
    intent: "sale.create" | "sale.quote" | "inventory.check";
    request: AnalyzeAssistantRequest;
    session: GTSessionContext;
    rawHints: AnalyzeAssistantResponse["resolvedEntities"]["rawHints"];
  }): Promise<AnalyzeAssistantResponse> {
    const warnings: AssistantWarning[] = [];
    const catalog = await this.catalogService.getCatalog(params.session);

    if (params.intent === "inventory.check") {
      const productResolution = this.entityResolutionService.resolveProduct(
        params.rawHints?.productName ?? params.transcript,
        catalog,
        params.request.selectedOptionIds,
      );

      if (productResolution.state !== "resolved") {
        const clarification =
          productResolution.state === "ambiguous"
            ? this.clarificationService.ambiguousEntity(
                "Please choose which product stock item to check.",
                productResolution.options,
                ["product"],
              )
            : this.clarificationService.missingField(
                "Please choose which product stock item to check.",
                ["product"],
                productResolution.options,
              );

        return {
          requestId: params.requestId,
          transcript: params.transcript,
          intent: params.intent,
          confidence: 0.73,
          needsClarification: true,
          clarificationType: clarification.type,
          missingFields: clarification.missingFields,
          candidateOptions: clarification.options,
          clarification,
          resolvedEntities: {
            rawHints: params.rawHints,
          },
          recommendedProducts: [],
          warnings,
          summary: clarification.message,
          confirmRequired: false,
        };
      }

      const resolvedProduct = productResolution.resolved!;
      const product = resolvedProduct.entity;
      return {
        requestId: params.requestId,
        transcript: params.transcript,
        intent: params.intent,
        confidence: 0.95,
        needsClarification: false,
        missingFields: [],
        candidateOptions: [],
        resolvedEntities: {
          product: resolvedProduct,
          rawHints: params.rawHints,
        },
        recommendedProducts: [],
        warnings,
        summary: `${product.name} has ${product.stockItem?.stock ?? 0} units in stock.`,
        confirmRequired: false,
        proposedAction: {
          actionId: `${params.requestId}:inventory:check`,
          intent: params.intent,
          confirmRequired: false,
          summary: `Inventory check for ${product.name}`,
          sale: {
            operation: "inventory_check",
            clinicId: params.session.clinicId,
            lineItems: [],
            subtotal: 0,
            warnings,
          },
        },
      };
    }

    const segments = parseLineItemPhrases(params.transcript);
    const lineItems: GTSaleDraftLineItem[] = [];
    let primaryServiceName: string | undefined;

    for (const segment of segments) {
      const quantity = parseQuantity(segment);
      const normalizedSegment = stripQuantity(segment);
      if (!normalizedSegment) {
        continue;
      }

      const serviceResolution = this.entityResolutionService.resolveService(normalizedSegment, catalog);
      if (serviceResolution.state === "resolved") {
        const service = serviceResolution.resolved!.entity;
        primaryServiceName ||= service.name;
        lineItems.push({
          refId: service.id,
          refType: "SERVICE",
          name: service.name,
          quantity,
          unitPrice: service.price,
          total: service.price * quantity,
        });
        continue;
      }

      const productResolution = this.entityResolutionService.resolveProduct(normalizedSegment, catalog);
      if (productResolution.state === "resolved") {
        const product = productResolution.resolved!.entity;
        if ((product.stockItem?.stock ?? 0) < quantity) {
          warnings.push({
            code: "low_stock",
            message: `${product.name} has only ${product.stockItem?.stock ?? 0} units available.`,
          });
        }
        lineItems.push({
          refId: product.stockItem?.id ?? product.id,
          refType: "PRODUCT",
          name: product.name,
          quantity,
          unitPrice: product.stockItem?.price ?? 0,
          total: (product.stockItem?.price ?? 0) * quantity,
        });
        continue;
      }

      warnings.push({
        code: "unmatched_line_item",
        message: `Could not confidently match "${normalizedSegment}" to a GreatTime service or product.`,
      });
    }

    if (lineItems.length === 0) {
      const clarification = this.clarificationService.missingField(
        "Please choose at least one service or product line item.",
        ["line_items"],
      );
      return {
        requestId: params.requestId,
        transcript: params.transcript,
        intent: params.intent,
        confidence: 0.58,
        needsClarification: true,
        clarificationType: clarification.type,
        missingFields: clarification.missingFields,
        candidateOptions: clarification.options,
        clarification,
        resolvedEntities: {
          rawHints: params.rawHints,
        },
        recommendedProducts: [],
        warnings,
        summary: clarification.message,
        confirmRequired: false,
      };
    }

    const memberResolution = await this.entityResolutionService.resolveMember(
      params.session,
      params.rawHints?.memberName,
      params.request.selectedOptionIds,
    );
    const memberResolved = memberResolution.state === "resolved" ? memberResolution.resolved : undefined;

    if (params.intent === "sale.create" && !memberResolved) {
      const clarification =
        memberResolution.state === "ambiguous"
          ? this.clarificationService.ambiguousEntity("Please choose the member for this sale.", memberResolution.options, ["member"])
          : this.clarificationService.missingField("Please choose the member for this sale.", ["member"], memberResolution.options);

      return {
        requestId: params.requestId,
        transcript: params.transcript,
        intent: params.intent,
        confidence: 0.72,
        needsClarification: true,
        clarificationType: clarification.type,
        missingFields: clarification.missingFields,
        candidateOptions: clarification.options,
        clarification,
        resolvedEntities: {
          lineItems,
          rawHints: params.rawHints,
        },
        recommendedProducts: [],
        warnings,
        summary: clarification.message,
        confirmRequired: false,
      };
    }

    const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
    const primaryService = primaryServiceName
      ? catalog.services.find((service) => service.name === primaryServiceName)
      : undefined;
    const recommendations = primaryService
      ? this.recommendationService.recommendProductsForService({
          service: primaryService,
          catalog,
        })
      : [];

    return {
      requestId: params.requestId,
      transcript: params.transcript,
      intent: params.intent,
      confidence: 0.9,
      needsClarification: false,
      missingFields: [],
      candidateOptions: [],
      resolvedEntities: {
        member: memberResolved,
        lineItems,
        rawHints: params.rawHints,
      },
      recommendedProducts: recommendations,
      warnings,
      summary:
        params.intent === "sale.quote"
          ? `Prepared quote with ${lineItems.length} line items totaling ${subtotal}.`
          : `Prepared sale preview with ${lineItems.length} line items totaling ${subtotal}.`,
      confirmRequired: params.intent === "sale.create",
      proposedAction: {
        actionId: `${params.requestId}:sale:${params.intent === "sale.quote" ? "quote" : "create"}`,
        intent: params.intent,
        confirmRequired: params.intent === "sale.create",
        summary:
          params.intent === "sale.quote"
            ? `Quote for ${lineItems.map((item) => item.name).join(", ")}`
            : `Create sale for ${lineItems.map((item) => item.name).join(", ")}`,
        sale: {
          operation: params.intent === "sale.quote" ? "quote" : "create",
          clinicId: params.session.clinicId,
          memberId: memberResolved?.id,
          memberName: memberResolved?.name,
          paymentMethod: "CASH",
          paymentStatus: "UNPAID",
          lineItems,
          subtotal,
          warnings,
        },
      },
    };
  }

  async execute(params: {
    session: GTSessionContext;
    pendingAction: PendingActionRecord;
  }): Promise<ConfirmActionResponse> {
    const salePreview = params.pendingAction.proposedAction.sale;
    if (!salePreview || salePreview.operation !== "create") {
      return {
        requestId: params.pendingAction.requestId,
        executionStatus: "failed",
        summary: "Sale preview was not available for execution.",
        warnings: params.pendingAction.warnings,
        errors: ["missing_sale_preview"],
      };
    }

    if (!salePreview.memberId) {
      return {
        requestId: params.pendingAction.requestId,
        executionStatus: "needs_clarification",
        summary: "Sale execution still needs a member selection.",
        warnings: params.pendingAction.warnings,
        clarification: this.clarificationService.missingField("Please choose the member for this sale.", ["member"]),
      };
    }

    if (!params.session.userId) {
      return {
        requestId: params.pendingAction.requestId,
        executionStatus: "failed",
        summary: "Authenticated user id was missing from the GreatTime token.",
        warnings: params.pendingAction.warnings,
        errors: ["missing_user_id"],
      };
    }

    const sale = await this.apiCoreAdapter.createSale(params.session, {
      clinicId: params.session.clinicId,
      memberId: salePreview.memberId,
      userId: params.session.userId,
      sellerId: params.session.userId,
      paymentMethod: "CASH",
      paymentStatus: "UNPAID",
      lineItems: salePreview.lineItems,
      note: JSON.stringify({
        source: "ai-orchestrator-gt",
        requestId: params.pendingAction.requestId,
      }),
    });

    return {
      requestId: params.pendingAction.requestId,
      executionStatus: "executed",
      result: {
        sale,
      },
      summary: `Created sale ${sale.orderId ?? sale.id}.`,
      warnings: params.pendingAction.warnings,
    };
  }
}
