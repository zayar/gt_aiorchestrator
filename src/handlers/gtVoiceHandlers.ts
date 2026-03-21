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
import { logger } from "../utils/logger.js";

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

const SPEECH_BIAS_LIMIT = 1200;
const MEMBER_REFERENCE_LIMIT = 120;
const DEFAULT_SPEECH_BIAS_PHRASES = [
  "booking",
  "appointment",
  "reschedule",
  "cancel booking",
  "availability",
  "consultation",
  "service",
  "product",
  "sale",
  "report",
  "stock",
  "doctor",
  "practitioner",
  "member",
  "client",
  "patient",
  "ရက်ချိန်း",
  "ဘိုကင်",
  "ဝန်ဆောင်မှု",
  "ကုန်ပစ္စည်း",
  "ဒေါက်တာ",
];

type AudioPayload = {
  base64?: string;
  mimeType?: string;
};

type RequestWithAudio = RequestWithContext & {
  file?: Express.Multer.File;
};

const parseJsonField = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const raw = value.trim();
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return value;
  }
};

const parseStringArrayField = (value: unknown): string[] | undefined => {
  const parsed = parseJsonField(value);
  if (Array.isArray(parsed)) {
    const result = parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
    return result.length > 0 ? result : undefined;
  }
  if (typeof parsed === "string" && parsed.trim()) {
    return [parsed.trim()];
  }
  return undefined;
};

const parseObjectField = (value: unknown): Record<string, unknown> | undefined => {
  const parsed = parseJsonField(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
};

const readAudioPayload = (req: RequestWithAudio): AudioPayload => {
  if (req.file?.buffer?.length) {
    return {
      base64: req.file.buffer.toString("base64"),
      mimeType: String(req.file.mimetype || "audio/m4a").trim() || "audio/m4a",
    };
  }

  return {
    base64: String((parseObjectField(req.body?.audio)?.base64 as string | undefined) ?? "").trim() || undefined,
    mimeType:
      String((parseObjectField(req.body?.audio)?.mimeType as string | undefined) ?? "audio/m4a").trim() || "audio/m4a",
  };
};

const buildAnalyzeRequest = (req: RequestWithContext): AnalyzeAssistantRequest => ({
  requestId: String(req.body?.requestId ?? req.requestId).trim(),
  clinicId: String(req.body?.clinicId ?? "").trim() || undefined,
  transcript: String(req.body?.transcript ?? "").trim() || undefined,
  audio: parseObjectField(req.body?.audio) as AnalyzeAssistantRequest["audio"],
  locale: String(req.body?.locale ?? "").trim() || undefined,
  language: String(req.body?.language ?? "").trim() || undefined,
  timezone: String(req.body?.timezone ?? "").trim() || undefined,
  userContext: parseObjectField(req.body?.userContext) as AnalyzeAssistantRequest["userContext"],
  selectedOptionIds: parseStringArrayField(req.body?.selectedOptionIds),
  metadata: parseObjectField(req.body?.metadata),
});

const buildSpeechBiasPhrases = async (session: ReturnType<SessionContextService["fromRequest"]>): Promise<string[]> => {
  const [catalog, members] = await Promise.all([
    catalogService.getCatalog(session),
    catalogService.getMemberReferenceList(session, MEMBER_REFERENCE_LIMIT),
  ]);

  const seen = new Set<string>();
  const phrases: string[] = [];

  const push = (value: unknown) => {
    const phrase = String(value ?? "").trim();
    if (!phrase) {
      return;
    }
    const key = phrase.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    phrases.push(phrase);
  };

  push(catalog.clinic.name);
  DEFAULT_SPEECH_BIAS_PHRASES.forEach(push);
  catalog.services.forEach((item) => push(item.name));
  catalog.products.forEach((item) => {
    push(item.name);
    push(item.stockItem?.name);
  });
  catalog.practitioners.forEach((item) => push(item.name));
  members.forEach((item) => push(item.name));

  return phrases.slice(0, SPEECH_BIAS_LIMIT);
};

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
  let biasPhrases: string[] = [];

  try {
    biasPhrases = await buildSpeechBiasPhrases(session);
  } catch (error) {
    logger.warn("Speech bias phrase preparation failed", {
      requestId: request.requestId,
      clinicId: session.clinicId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const recognized = await speechRecognitionService.recognize({
    requestId: request.requestId,
    transcript: request.transcript,
    audioBase64: audioPayload.base64,
    mimeType: audioPayload.mimeType,
    language: request.language ?? request.locale,
    additionalLanguageCodes: [config.voiceSecondaryLanguage],
    biasPhrases,
  });
  logger.info("Speech recognized", {
    requestId: request.requestId,
    provider: recognized.provider,
    requestedLocale: request.locale,
    requestedLanguage: request.language,
    biasPhraseCount: biasPhrases.length,
    languageCode: recognized.languageCode,
    confidence: recognized.confidence,
    lowConfidence: recognized.lowConfidence,
    transcriptPreview: recognized.transcript.slice(0, 160),
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
