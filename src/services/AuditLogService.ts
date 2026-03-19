import type { AnalyzeAssistantResponse, ConfirmActionResponse, IntentResult } from "../types/contracts.js";
import type { GTSessionContext } from "../types/session.js";
import { logger } from "../utils/logger.js";

export class AuditLogService {
  logAnalyze(params: {
    session: GTSessionContext;
    transcript: string;
    intent: IntentResult;
    response: AnalyzeAssistantResponse;
  }): void {
    logger.info("GT analyze audit", {
      requestId: params.session.requestId,
      clinicId: params.session.clinicId,
      userId: params.session.userId,
      transcript: params.transcript,
      intent: params.intent.intent,
      confidence: params.intent.confidence,
      proposedAction: params.response.proposedAction?.intent,
      warnings: params.response.warnings,
    });
  }

  logConfirm(params: {
    session: GTSessionContext;
    response: ConfirmActionResponse;
  }): void {
    logger.info("GT confirm audit", {
      requestId: params.session.requestId,
      clinicId: params.session.clinicId,
      userId: params.session.userId,
      executionStatus: params.response.executionStatus,
      summary: params.response.summary,
      warnings: params.response.warnings,
      errors: params.response.errors,
    });
  }
}
