import { AppError } from "../utils/errors.js";

export type SpeechRecognitionInput = {
  requestId: string;
  transcript?: string;
  audioBase64?: string;
  mimeType?: string;
  language?: string;
};

export type SpeechRecognitionOutput = {
  transcript: string;
  provider: string;
  languageCode: string;
  confidence: number;
  lowConfidence: boolean;
};

export class SpeechRecognitionService {
  async recognize(input: SpeechRecognitionInput): Promise<SpeechRecognitionOutput> {
    const transcript = String(input.transcript ?? "").trim();
    if (transcript) {
      return {
        transcript,
        provider: "transcript_only",
        languageCode: String(input.language ?? "en-US").trim() || "en-US",
        confidence: 1,
        lowConfidence: false,
      };
    }

    if (!String(input.audioBase64 ?? "").trim()) {
      throw new AppError("Either transcript or audio is required.", {
        statusCode: 400,
        code: "missing_input",
      });
    }

    throw new AppError(
      "Audio transcription provider is not configured yet. Use transcript input for the first pass or wire an STT provider.",
      {
        statusCode: 501,
        code: "speech_provider_not_configured",
      },
    );
  }
}
