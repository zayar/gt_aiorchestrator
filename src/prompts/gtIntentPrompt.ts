import type { AssistantIntent } from "../types/contracts.js";

export const buildGtIntentPrompt = (params: {
  transcript: string;
  supportedIntents: AssistantIntent[];
}) => `
You classify GreatTime clinic assistant requests.

Supported intents:
${params.supportedIntents.join("\n")}

Transcript:
${params.transcript}

Return JSON only with:
{
  "intent": "...",
  "confidence": 0.0,
  "serviceHint": "",
  "memberHint": "",
  "practitionerHint": "",
  "productHint": "",
  "timeHint": "",
  "bookingIdHint": ""
}
`;
