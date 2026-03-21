import { config } from "../config/index.js";
import { supportedAssistantIntents } from "../constants/assistantIntents.js";
import type { AnalyzeAssistantRequest, AssistantIntent, IntentResult } from "../types/contracts.js";
import { LlmIntentService } from "./LlmIntentService.js";

const extractWithRegex = (text: string, pattern: RegExp): string | undefined => {
  const match = text.match(pattern);
  return String(match?.[1] ?? "").trim() || undefined;
};

const cleanTrailingBookingWords = (value: string | undefined): string | undefined =>
  String(value ?? "")
    .replace(/\b(appointment|book|booking|service|slot|create|sale)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || undefined;

const extractMyanmarMemberHint = (text: string): string | undefined => {
  const parts = text.split(/\s+ကို/);
  if (parts.length < 2) {
    return undefined;
  }

  const left = String(parts[0] ?? "").trim();
  if (!left) {
    return undefined;
  }

  const trimmed = left
    .replace(
      /\b(today|tomorrow)\b|ဒီနေ့|ဒီေန႔|မနက်ဖြန်|မနက္ျဖန္|မနက်ဖန်|မနက္ဖန္|\d{1,2}|[၀-၉]{1,2}|နာရီ|မှာ|တြင္|တွင်/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  if (!trimmed) {
    return undefined;
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return tokens.slice(-3).join(" ").trim() || undefined;
};

const extractMyanmarMemberHintFromAhtwet = (text: string): string | undefined => {
  const parts = text.split(/\s+အတွက်/);
  if (parts.length < 2) {
    return undefined;
  }

  const left = String(parts[0] ?? "")
    .replace(
      /\b(today|tomorrow)\b|ဒီနေ့|ဒီေန႔|မနက်ဖြန်|မနက္ျဖန္|မနက်ဖန်|မနက္ဖန္|\d{1,2}|[၀-၉]{1,2}|နာရီ|မှာ|တြင္|တွင်/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!left) {
    return undefined;
  }

  const tokens = left.split(/\s+/).filter(Boolean);
  return tokens.slice(-3).join(" ").trim() || undefined;
};

const extractMyanmarServiceHint = (text: string): string | undefined =>
  cleanTrailingBookingWords(
    extractWithRegex(
      text,
      /\sအတွက်\s+([a-z][a-z0-9 &+/'().-]{2,}?)\s+(?:appointment|booking|book)\b/i,
    ) ||
      extractWithRegex(
        text,
        /\sကို\s+([a-z][a-z0-9 &+/'().-]{2,}?)\s+(?:appointment|booking|book)\b/i,
      ) ||
      extractWithRegex(
        text,
        /([a-z][a-z0-9 &+/'().-]{2,}?)\s+(?:appointment|booking|book)\b/i,
      ),
  );

const extractEnglishBookingServiceHint = (text: string): string | undefined =>
  cleanTrailingBookingWords(
    extractWithRegex(text, /\sfor\s+([a-z][a-z0-9 &+/'().-]{2,}?)\s+(?:appointment|booking)\b/i) ||
      extractWithRegex(text, /\sfor\s+([a-z][a-z0-9 &+/'().-]{2,}?)\s+with\b/i) ||
      extractWithRegex(text, /([a-z][a-z0-9 &+/'().-]{2,}?)\s+(?:appointment|booking)\b/i),
  );

const extractServiceHint = (text: string): string | undefined =>
  cleanTrailingBookingWords(
    extractMyanmarServiceHint(text) ||
      extractEnglishBookingServiceHint(text) ||
    extractWithRegex(
      text,
      /\b(?:book|find|schedule|recommend products for|what products go with|create sale for)\s+([^,]+?)(?:\s+(?:for|with|today|tomorrow|at|this|on)\b|$)/i,
    ) ||
      extractWithRegex(text, /\b(?:add|quote)\s+([^,]+)$/i) ||
      extractWithRegex(text, /\sကို\s+([a-z][a-z0-9 &+/'().-]{2,}?)\s+(?:appointment|booking)\b/i),
  );

const extractTimeHint = (text: string): string | undefined => {
  const hasDateCue =
    /\b(today|tomorrow|this evening|this morning|this afternoon|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      text,
    ) ||
    /(ဒီနေ့|ဒီေန႔|မနက်ဖြန်|မနက္ျဖန္|မနက်ဖန်|မနက္ဖန္|တနင်္လာ|တနလၤာ|အင်္ဂါ|အဂၤါ|ဗုဒ္ဓဟူး|ဗုဒၶဟူး|ကြာသပတေး|ၾကာသပေတး|သောကြာ|ေသာၾကာ|စနေ|စေန|တနင်္ဂနွေ|တနဂၤေႏြ)/i.test(
      text,
    );
  const match = text.match(
    /\b(?:today|tomorrow|this evening|this morning|this afternoon|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening|night))?(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i,
  );
  if (match?.[0]) {
    return match[0].trim();
  }

  const myanmarDateTime = text.match(
    /(ဒီနေ့|ဒီေန႔|မနက်ဖြန်|မနက္ျဖန္|မနက်ဖန်|မနက္ဖန္|တနင်္လာ|တနလၤာ|အင်္ဂါ|အဂၤါ|ဗုဒ္ဓဟူး|ဗုဒၶဟူး|ကြာသပတေး|ၾကာသပေတး|သောကြာ|ေသာၾကာ|စနေ|စေန|တနင်္ဂနွေ|တနဂၤေႏြ).{0,20}?([၀-၉]|\d){1,2}(?::([၀-၉]|\d){2})?\s*နာရီ?/i,
  );
  if (myanmarDateTime?.[0]) {
    return myanmarDateTime[0].trim();
  }

  const myanmarTimeOnly = text.match(/([၀-၉]|\d){1,2}(?::([၀-၉]|\d){2})?\s*နာရီ/i);
  if (myanmarTimeOnly?.[0]) {
    return myanmarTimeOnly[0].trim();
  }

  const timeOnly = hasDateCue ? text.match(/\b\d{1,2}(?::\d{2})?\s*(am|pm)?\b/i) : text.match(/\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)\b/i);
  return timeOnly?.[0]?.trim() || undefined;
};

export class IntentRouterService {
  constructor(private readonly llmIntentService: LlmIntentService) {}

  async classify(transcript: string, _request: AnalyzeAssistantRequest): Promise<IntentResult> {
    const normalized = transcript.toLowerCase();
    const hasBookingCue = /\b(book|booking|appointment|schedule appointment|new appointment)\b|appointment book|ရက်ချိန်း|ဘိုကင်/.test(
      normalized,
    );
    const hasSaleCue = /\b(add|create sale|sale for|consultation plus|aftercare set|sell)\b|ရောင်း|ေရာင္း/.test(
      normalized,
    );

    let intent: AssistantIntent = "unknown";
    let confidence = 0.35;

    if (/\b(reschedule|move booking|move appointment)\b|ရက်ချိန်းပြောင်း|ဘိုကင်ပြောင်း/.test(normalized)) {
      intent = "booking.reschedule";
      confidence = 0.88;
    } else if (/\b(cancel booking|cancel appointment|cancel her booking|cancel it)\b|ရက်ချိန်းဖျက်|ဘိုကင်ဖျက်/.test(normalized)) {
      intent = "booking.cancel";
      confidence = 0.86;
    } else if (/\b(free slot|availability|available slot|find a free slot)\b|အားလပ်ချိန်|အားလပ် slot/.test(normalized)) {
      intent = "booking.availability_check";
      confidence = 0.88;
    } else if (hasBookingCue) {
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
    } else if (hasSaleCue && !hasBookingCue) {
      intent = "sale.create";
      confidence = 0.8;
    }

    const regexHints = {
      memberName:
        extractWithRegex(transcript, /\bfor\s+([^,]+?)(?:\s+(?:today|tomorrow|with|at|this|on)\b|$)/i) ||
        extractMyanmarMemberHint(transcript) ||
        extractMyanmarMemberHintFromAhtwet(transcript),
      practitionerName: extractWithRegex(transcript, /\bwith\s+([^,]+?)(?:\s+(?:today|tomorrow|at|this|on)\b|$)/i),
      bookingId: extractWithRegex(transcript, /\bbooking\s+#?([a-z0-9_-]{6,})\b/i),
      timeText: extractTimeHint(transcript),
      serviceName: extractServiceHint(transcript),
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
