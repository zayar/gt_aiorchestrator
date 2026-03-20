import { VertexAI } from "@google-cloud/vertexai";
import { config } from "../config/index.js";
import { supportedAssistantIntents } from "../constants/assistantIntents.js";
import { buildGtIntentPrompt } from "../prompts/gtIntentPrompt.js";
import type { AssistantIntent } from "../types/contracts.js";
import { withTimeout } from "../utils/async.js";
import { parseJsonObject } from "../utils/json.js";
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

type RawLlmIntentPayload = {
  intent?: string;
  confidence?: number | string;
  serviceHint?: string;
  memberHint?: string;
  practitionerHint?: string;
  productHint?: string;
  timeHint?: string;
  bookingIdHint?: string;
};

let vertexClient: VertexAI | null = null;

const cleanHint = (value: unknown): string | undefined => {
  const text = String(value ?? "").trim();
  return text || undefined;
};

const toConfidence = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.min(1, Math.max(0, parsed));
    }
  }

  return 0.45;
};

const toIntent = (value: unknown): AssistantIntent | null => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return supportedAssistantIntents.includes(normalized as AssistantIntent)
    ? (normalized as AssistantIntent)
    : null;
};

const getVertexClient = (): VertexAI | null => {
  if (!config.gcpProjectId) {
    logger.warn("GCP_PROJECT_ID is missing; skipping Gemini intent classification");
    return null;
  }

  if (!vertexClient) {
    vertexClient = new VertexAI({
      project: config.gcpProjectId,
      location: config.vertexRegion,
    });
  }

  return vertexClient;
};

export class LlmIntentService {
  async classify(transcript: string): Promise<LlmIntentHint | null> {
    if (config.llmProvider !== "vertex_gemini") {
      if (config.llmProvider !== "heuristic") {
        logger.warn("Unsupported LLM provider configured; skipping LLM classification", {
          llmProvider: config.llmProvider,
        });
      }
      return null;
    }

    const trimmedTranscript = String(transcript ?? "").trim();
    if (!trimmedTranscript) {
      return null;
    }

    const vertex = getVertexClient();
    if (!vertex) {
      return null;
    }

    try {
      const model = vertex.getGenerativeModel({
        model: config.vertexModel,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 256,
          responseMimeType: "application/json",
        } as any,
      });

      const response = await withTimeout(
        model.generateContent({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: buildGtIntentPrompt({
                    transcript: trimmedTranscript,
                    supportedIntents: supportedAssistantIntents,
                  }),
                },
              ],
            },
          ],
        } as any),
        config.llmTimeoutMs,
        "Gemini intent classification",
      );

      const parts = response.response.candidates?.[0]?.content?.parts ?? [];
      const rawText = (parts as Array<{ text?: string }>)
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
        .trim();

      const payload = parseJsonObject<RawLlmIntentPayload>(rawText);
      const intent = toIntent(payload?.intent);
      if (!intent) {
        logger.warn("Gemini intent classification returned an unsupported payload", {
          rawText,
        });
        return null;
      }

      return {
        intent,
        confidence: toConfidence(payload?.confidence),
        serviceHint: cleanHint(payload?.serviceHint),
        memberHint: cleanHint(payload?.memberHint),
        practitionerHint: cleanHint(payload?.practitionerHint),
        productHint: cleanHint(payload?.productHint),
        timeHint: cleanHint(payload?.timeHint),
        bookingIdHint: cleanHint(payload?.bookingIdHint),
      };
    } catch (error) {
      logger.error("Gemini intent classification failed", {
        model: config.vertexModel,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
