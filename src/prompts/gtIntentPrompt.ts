import type { AssistantIntent } from "../types/contracts.js";

export const buildGtIntentPrompt = (params: {
  transcript: string;
  supportedIntents: AssistantIntent[];
}) => `
You classify GreatTime clinic assistant requests for clinics, aesthetics centers, and medical front desk workflows.

Be conservative and precise.
- Use only the supported intents below.
- If the request is unclear, use "unknown".
- Confidence must be a number between 0 and 1.
- The transcript may be in Myanmar/Burmese, English, or a clinic-specific mix of both.
- Extract hints only when they are explicit or strongly implied.
- Keep member, service, practitioner, product, and booking hints close to the spoken wording.
- Preserve natural-language time phrasing in timeHint (for example: "tomorrow at 3 PM").

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
