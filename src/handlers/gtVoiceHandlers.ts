import type { Response } from "express";
import { config } from "../config/index.js";
import type { AnalyzeAssistantRequest, AnalyzeAssistantResponse, PendingActionRecord } from "../types/contracts.js";
import type { RequestWithContext } from "../middleware/requestContext.js";
import { AppError } from "../utils/errors.js";
import { TTLCache } from "../utils/cache.js";
import { GTApiCoreAdapter } from "../adapters/GTApiCoreAdapter.js";
import { GTReportAdapter } from "../adapters/GTReportAdapter.js";
import { SessionContextService } from "../services/SessionContextService.js";
import { SpeechRecognitionService } from "../services/SpeechRecognitionService.js";
import { LlmIntentService } from "../services/LlmIntentService.js";
import { IntentRouterService } from "../services/IntentRouterService.js";
import { GTCatalogService } from "../services/GTCatalogService.js";
import { EntityResolutionService } from "../services/EntityResolutionService.js";
import { RecommendationService } from "../services/RecommendationService.js";
import { AppointmentOrchestrator } from "../services/AppointmentOrchestrator.js";
import { SaleOrchestrator } from "../services/SaleOrchestrator.js";
import { ReportSummaryService } from "../services/ReportSummaryService.js";
import { ClarificationService } from "../services/ClarificationService.js";
import { AuditLogService } from "../services/AuditLogService.js";

const apiCoreAdapter = new GTApiCoreAdapter();
const reportAdapter = new GTReportAdapter(apiCoreAdapter);
const sessionContextService = new SessionContextService();
const speechRecognitionService = new SpeechRecognitionService();
const llmIntentService = new LlmIntentService();
const intentRouterService = new IntentRouterService(llmIntentService);
const catalogService = new GTCatalogService(apiCoreAdapter);
const entityResolutionService = new EntityResolutionService(apiCoreAdapter);
const recommendationService = new RecommendationService();
const clarificationService = new ClarificationService();
const appointmentOrchestrator = new AppointmentOrchestrator(
  apiCoreAdapter,
  catalogService,
  entityResolutionService,
  recommendationService,
  clarificationService,
);
const saleOrchestrator = new SaleOrchestrator(
  apiCoreAdapter,
  catalogService,
  entityResolutionService,
  recommendationService,
  clarificationService,
);
const reportSummaryService = new ReportSummaryService(apiCoreAdapter, reportAdapter);
const auditLogService = new AuditLogService();

export const pendingActionStore = new TTLCache<PendingActionRecord>(config.previewCacheTtlMs);

type AudioPayload = {
  base64?: string;
  mimeType?: string;
};

type RequestWithAudio = RequestWithContext & {
  file?: Express.Multer.File;
};

const readAudioPayload = (req: RequestWithAudio): AudioPayload => {
  if (req.file?.buffer?.length) {
    return {
      base64: req.file.buffer.toString("base64"),
      mimeType: String(req.file.mimetype || "audio/m4a").trim() || "audio/m4a",
    };
  }

  return {
    base64: String(req.body?.audio?.base64 ?? "").trim() || undefined,
    mimeType: String(req.body?.audio?.mimeType ?? "audio/m4a").trim() || "audio/m4a",
  };
};

const buildAnalyzeRequest = (req: RequestWithContext): AnalyzeAssistantRequest => ({
  requestId: String(req.body?.requestId ?? req.requestId).trim(),
  clinicId: String(req.body?.clinicId ?? "").trim() || undefined,
  transcript: String(req.body?.transcript ?? "").trim() || undefined,
  audio: req.body?.audio,
  locale: String(req.body?.locale ?? "").trim() || undefined,
  language: String(req.body?.language ?? "").trim() || undefined,
  timezone: String(req.body?.timezone ?? "").trim() || undefined,
  userContext: req.body?.userContext,
  selectedOptionIds: Array.isArray(req.body?.selectedOptionIds)
    ? req.body.selectedOptionIds.map((value: unknown) => String(value))
    : undefined,
  metadata: typeof req.body?.metadata === "object" && req.body.metadata !== null ? req.body.metadata : undefined,
});

const storePendingAction = (response: AnalyzeAssistantResponse) => {
  if (!response.proposedAction || !response.confirmRequired) {
    return;
  }

  pendingActionStore.set(response.requestId, {
    requestId: response.requestId,
    transcript: response.transcript,
    intent: response.intent,
    proposedAction: response.proposedAction,
    resolvedEntities: response.resolvedEntities,
    recommendedProducts: response.recommendedProducts,
    warnings: response.warnings,
    createdAt: new Date().toISOString(),
  });
};

const analyzeInternal = async (req: RequestWithContext, _mode: "analyze" | "query"): Promise<AnalyzeAssistantResponse> => {
  const request = buildAnalyzeRequest(req);
  const session = sessionContextService.fromRequest(req);
  const audioPayload = readAudioPayload(req as RequestWithAudio);
  const recognized = await speechRecognitionService.recognize({
    requestId: request.requestId,
    transcript: request.transcript,
    audioBase64: audioPayload.base64,
    mimeType: audioPayload.mimeType,
    language: request.language ?? request.locale,
  });

  const routedIntent = await intentRouterService.classify(recognized.transcript, request);
  let response: AnalyzeAssistantResponse;

  switch (routedIntent.intent) {
    case "booking.create":
    case "booking.reschedule":
    case "booking.cancel":
    case "booking.availability_check":
      response = await appointmentOrchestrator.analyze({
        requestId: request.requestId,
        transcript: recognized.transcript,
        intent: routedIntent.intent,
        request,
        session,
        rawHints: routedIntent.rawHints,
      });
      break;
    case "sale.create":
    case "sale.quote":
    case "inventory.check":
      response = await saleOrchestrator.analyze({
        requestId: request.requestId,
        transcript: recognized.transcript,
        intent: routedIntent.intent,
        request,
        session,
        rawHints: routedIntent.rawHints,
      });
      break;
    case "recommend.products_for_service": {
      const catalog = await catalogService.getCatalog(session);
      const serviceResolution = entityResolutionService.resolveService(
        routedIntent.rawHints?.serviceName ?? recognized.transcript,
        catalog,
        request.selectedOptionIds,
      );

      if (serviceResolution.state !== "resolved") {
        const clarification =
          serviceResolution.state === "ambiguous"
            ? clarificationService.ambiguousEntity("Please choose the service.", serviceResolution.options, ["service"])
            : clarificationService.missingField("Please choose the service.", ["service"], serviceResolution.options);

        response = {
          requestId: request.requestId,
          transcript: recognized.transcript,
          intent: routedIntent.intent,
          confidence: routedIntent.confidence,
          needsClarification: true,
          clarificationType: clarification.type,
          missingFields: clarification.missingFields,
          candidateOptions: clarification.options,
          clarification,
          resolvedEntities: {
            rawHints: routedIntent.rawHints,
          },
          proposedAction: undefined,
          recommendedProducts: [],
          warnings: [],
          summary: clarification.message,
          confirmRequired: false,
        };
      } else {
        const resolvedService = serviceResolution.resolved!;
        const recommendedProducts = recommendationService.recommendProductsForService({
          service: resolvedService.entity,
          catalog,
        });
        response = {
          requestId: request.requestId,
          transcript: recognized.transcript,
          intent: routedIntent.intent,
          confidence: 0.95,
          needsClarification: false,
          missingFields: [],
          candidateOptions: [],
          resolvedEntities: {
            service: resolvedService,
            rawHints: routedIntent.rawHints,
          },
          proposedAction: {
            actionId: `${request.requestId}:recommendation`,
            intent: routedIntent.intent,
            confirmRequired: false,
            summary: `Related products for ${resolvedService.name}`,
          },
          recommendedProducts,
          warnings: [],
          summary:
            recommendedProducts.length > 0
              ? `Found ${recommendedProducts.length} catalog-grounded products related to ${resolvedService.name}.`
              : `No grounded service-product mappings were found for ${resolvedService.name}.`,
          confirmRequired: false,
        };
      }
      break;
    }
    case "report.booking_summary":
    case "report.sales_summary":
    case "report.practitioner_summary":
      response = await reportSummaryService.analyze({
        requestId: request.requestId,
        transcript: recognized.transcript,
        intent: routedIntent.intent,
        session,
      });
      break;
    default: {
      const clarification = clarificationService.unsupported(
        "I can currently help with bookings, sales, inventory checks, service-related product recommendations, and summary reports.",
      );
      response = {
        requestId: request.requestId,
        transcript: recognized.transcript,
        intent: "unknown",
        confidence: routedIntent.confidence,
        needsClarification: true,
        clarificationType: clarification.type,
        missingFields: clarification.missingFields,
        candidateOptions: clarification.options,
        clarification,
        resolvedEntities: {
          rawHints: routedIntent.rawHints,
        },
        recommendedProducts: [],
        warnings: [],
        summary: clarification.message,
        confirmRequired: false,
      };
    }
  }

  storePendingAction(response);
  auditLogService.logAnalyze({
    session,
    transcript: recognized.transcript,
    intent: routedIntent,
    response,
  });

  return response;
};

export const handleAnalyze = async (req: RequestWithContext, res: Response) => {
  const response = await analyzeInternal(req, "analyze");
  res.json(response);
};

export const handleQuery = async (req: RequestWithContext, res: Response) => {
  const response = await analyzeInternal(req, "query");
  if (response.confirmRequired) {
    throw new AppError("Read-only query endpoint cannot be used for confirm-required actions.", {
      statusCode: 400,
      code: "confirm_required_action",
      details: {
        intent: response.intent,
      },
    });
  }

  res.json(response);
};
