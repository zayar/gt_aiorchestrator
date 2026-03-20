import { config } from "../config/index.js";
import { supportedAssistantIntents } from "../constants/assistantIntents.js";
import type { AnalyzeAssistantRequest, AssistantIntent, IntentResult } from "../types/contracts.js";
import { LlmIntentService } from "./LlmIntentService.js";

const extractWithRegex = (text: string, pattern: RegExp): string | undefined => {
  const match = text.match(pattern);
  return String(match?.[1] ?? "").trim() || undefined;
};

const extractTimeHint = (text: string): string | undefined => {
  const match = text.match(
    /\b(?:today|tomorrow|this evening|this morning|this afternoon|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening|night))?(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i,
  );
  if (match?.[0]) {
    return match[0].trim();
  }

  const timeOnly = text.match(/\b\d{1,2}(?::\d{2})?\s*(am|pm)?\b/i);
  return timeOnly?.[0]?.trim() || undefined;
};

export class IntentRouterService {
  constructor(private readonly llmIntentService: LlmIntentService) {}

  async classify(transcript: string, _request: AnalyzeAssistantRequest): Promise<IntentResult> {
    const normalized = transcript.toLowerCase();

    let intent: AssistantIntent = "unknown";
    let confidence = 0.35;

    if (/\b(reschedule|move booking|move appointment)\b/.test(normalized)) {
      intent = "booking.reschedule";
      confidence = 0.88;
    } else if (/\b(cancel booking|cancel appointment|cancel her booking|cancel it)\b/.test(normalized)) {
      intent = "booking.cancel";
      confidence = 0.86;
    } else if (/\b(free slot|availability|available slot|find a free slot)\b/.test(normalized)) {
      intent = "booking.availability_check";
      confidence = 0.88;
    } else if (/\b(book|schedule appointment|new appointment)\b/.test(normalized)) {
      intent = "booking.create";
      confidence = 0.9;
    } else if (/\b(recommend|go with|related to this service|related products|included or related)\b/.test(normalized)) {
      intent = "recommend.products_for_service";
      confidence = 0.9;
    } else if (/\b(in stock|inventory|stock check|check stock)\b/.test(normalized)) {
      intent = "inventory.check";
      confidence = 0.89;
    } else if (/\b(top selling|sold the most|sales summary|revenue)\b/.test(normalized)) {
      intent = "report.sales_summary";
      confidence = 0.85;
    } else if (/\b(practitioner summary|which staff|which therapist)\b/.test(normalized)) {
      intent = "report.practitioner_summary";
      confidence = 0.82;
    } else if (/\b(summary|summarize today'?s bookings|bookings summary)\b/.test(normalized)) {
      intent = "report.booking_summary";
      confidence = 0.84;
    } else if (/\b(quote)\b/.test(normalized)) {
      intent = "sale.quote";
      confidence = 0.78;
    } else if (/\b(add|create sale|sale for|consultation plus|aftercare set)\b/.test(normalized)) {
      intent = "sale.create";
      confidence = 0.8;
    }

    const regexHints = {
      memberName: extractWithRegex(transcript, /\bfor\s+([^,]+?)(?:\s+(?:today|tomorrow|with|at|this|on)\b|$)/i),
      practitionerName: extractWithRegex(transcript, /\bwith\s+([^,]+?)(?:\s+(?:today|tomorrow|at|this|on)\b|$)/i),
      bookingId: extractWithRegex(transcript, /\bbooking\s+#?([a-z0-9_-]{6,})\b/i),
      timeText: extractTimeHint(transcript),
      serviceName:
        extractWithRegex(transcript, /\b(?:book|find|schedule|recommend products for|what products go with|create sale for)\s+([^,]+?)(?:\s+(?:for|with|today|tomorrow|at|this|on)\b|$)/i) ||
        extractWithRegex(transcript, /\b(?:add|quote)\s+([^,]+)$/i),
      productName: extractWithRegex(transcript, /\b(?:check if|is)\s+([^,]+?)\s+in stock\b/i),
    };

    const llmHint = await this.llmIntentService.classify(transcript);
    if (llmHint && supportedAssistantIntents.includes(llmHint.intent) && llmHint.confidence > confidence) {
      intent = llmHint.intent;
      confidence = llmHint.confidence;
    }

    const shouldUseLlmHints = Boolean(llmHint && llmHint.confidence >= config.llmMinConfidenceForHints);
    const rawHints = shouldUseLlmHints
      ? {
          memberName: regexHints.memberName ?? llmHint?.memberHint,
          practitionerName: regexHints.practitionerName ?? llmHint?.practitionerHint,
          bookingId: regexHints.bookingId ?? llmHint?.bookingIdHint,
          timeText: regexHints.timeText ?? llmHint?.timeHint,
          serviceName: regexHints.serviceName ?? llmHint?.serviceHint,
          productName: regexHints.productName ?? llmHint?.productHint,
        }
      : regexHints;

    return {
      intent,
      confidence,
      risky: ["booking.create", "booking.reschedule", "booking.cancel", "sale.create"].includes(intent),
      rawHints,
    };
  }
}
