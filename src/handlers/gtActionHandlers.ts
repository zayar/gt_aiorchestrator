import type { Response } from "express";
import { config } from "../config/index.js";
import type { ConfirmActionRequest, ConfirmActionResponse } from "../types/contracts.js";
import type { RequestWithContext } from "../middleware/requestContext.js";
import { AppError } from "../utils/errors.js";
import { IdempotencyStore } from "../utils/idempotency.js";
import { SessionContextService } from "../services/SessionContextService.js";
import { GTApiCoreAdapter } from "../adapters/GTApiCoreAdapter.js";
import { GTCatalogService } from "../services/GTCatalogService.js";
import { EntityResolutionService } from "../services/EntityResolutionService.js";
import { RecommendationService } from "../services/RecommendationService.js";
import { ClarificationService } from "../services/ClarificationService.js";
import { AppointmentOrchestrator } from "../services/AppointmentOrchestrator.js";
import { SaleOrchestrator } from "../services/SaleOrchestrator.js";
import { AuditLogService } from "../services/AuditLogService.js";
import { pendingActionStore } from "./gtVoiceHandlers.js";
import { requireConfirmation, requireString } from "../utils/validation.js";

const sessionContextService = new SessionContextService();
const apiCoreAdapter = new GTApiCoreAdapter();
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
const auditLogService = new AuditLogService();
const idempotencyStore = new IdempotencyStore<ConfirmActionResponse>(config.idempotencyTtlMs);

export const handleConfirmAction = async (req: RequestWithContext, res: Response) => {
  const session = sessionContextService.fromRequest(req);
  const body = req.body as ConfirmActionRequest;
  const requestId = requireString(body?.requestId ?? req.requestId, "missing_request_id", "requestId is required.");
  const idempotencyKey = requireString(body?.idempotencyKey, "missing_idempotency_key", "idempotencyKey is required.");
  requireConfirmation(Boolean(body?.confirmation));

  const idempotencyCacheKey = `${session.clinicId}:${requestId}:${idempotencyKey}`;
  const cached = idempotencyStore.get(idempotencyCacheKey);
  if (cached) {
    res.json({
      ...cached,
      executionStatus: "duplicate",
    });
    return;
  }

  const pendingAction = pendingActionStore.get(requestId);
  if (!pendingAction) {
    throw new AppError("No pending analyzed action was found for this requestId. Analyze again before confirming.", {
      statusCode: 404,
      code: "pending_action_not_found",
    });
  }

  let response: ConfirmActionResponse;
  switch (pendingAction.intent) {
    case "booking.create":
    case "booking.reschedule":
    case "booking.cancel":
      response = await appointmentOrchestrator.execute({
        session,
        pendingAction,
      });
      break;
    case "sale.create":
      response = await saleOrchestrator.execute({
        session,
        pendingAction,
      });
      break;
    default:
      response = {
        requestId,
        executionStatus: "rejected",
        summary: "This intent does not support confirm/execute.",
        warnings: pendingAction.warnings,
        errors: ["intent_not_executable"],
      };
      break;
  }

  idempotencyStore.set(idempotencyCacheKey, response);
  auditLogService.logConfirm({
    session,
    response,
  });

  res.json(response);
};
