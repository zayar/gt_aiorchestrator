import { config } from "../config/index.js";
import type { AssistantIntent } from "../types/contracts.js";
import { logger } from "../utils/logger.js";

export type LlmIntentHint = {
  intent: AssistantIntent;
  confidence: number;
  serviceHint?: string;
  memberHint?: string;
  practitionerHint?: string;
  productHint?: string;
  timeHint?: string;
  bookingIdHint?: string;
};

export class LlmIntentService {
  async classify(_transcript: string): Promise<LlmIntentHint | null> {
    if (config.llmProvider !== "heuristic") {
      logger.warn("Unsupported LLM provider configured for first pass; skipping LLM classification");
    }

    return null;
  }
}
