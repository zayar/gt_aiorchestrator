import OpenAI, { toFile } from "openai";
import { config } from "../config/index.js";
import { withTimeout } from "../utils/async.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

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

type WhisperSegment = {
  avg_logprob?: number;
  no_speech_prob?: number;
};

type WhisperVerboseTranscription = {
  text?: string;
  language?: string;
  segments?: WhisperSegment[];
};

let openAiClient: OpenAI | null = null;

const normalizeAudioBase64 = (value: string | undefined): string => {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  const data = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
  return data.replace(/[\r\n\s]+/g, "").trim();
};

const normalizeLanguageHint = (value: string | undefined): string | undefined => {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return undefined;
  }

  const normalized = raw.toLowerCase();
  if (normalized === "english") {
    return "en";
  }
  if (normalized === "myanmar" || normalized === "burmese") {
    return "my";
  }

  const compact = normalized.split(/[-_]/)[0];
  return compact || undefined;
};

const normalizeDetectedLanguageCode = (detected: string | undefined, fallback: string): string => {
  const raw = String(detected ?? "").trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  if (raw === "english" || raw === "en") {
    return fallback.toLowerCase().startsWith("en") ? fallback : "en-US";
  }

  if (raw === "myanmar" || raw === "burmese" || raw === "my") {
    return fallback.toLowerCase().startsWith("my") ? fallback : "my-MM";
  }

  return raw;
};

const clampUnit = (value: number): number => {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
};

const scoreSegment = (segment: WhisperSegment): number => {
  const avgLogProb = Number(segment.avg_logprob);
  const noSpeechProb = Number(segment.no_speech_prob);

  let score = 0.86;
  if (Number.isFinite(avgLogProb)) {
    score = Math.min(score, clampUnit(1 - Math.min(1, Math.abs(avgLogProb) / 2.5)));
  }
  if (Number.isFinite(noSpeechProb)) {
    score = Math.min(score, clampUnit(1 - noSpeechProb));
  }

  return clampUnit(score);
};

const estimateConfidence = (payload: WhisperVerboseTranscription, transcript: string): number => {
  const segments = Array.isArray(payload.segments) ? payload.segments : [];
  const scores = segments.map(scoreSegment).filter((value) => Number.isFinite(value) && value > 0);

  if (scores.length > 0) {
    return clampUnit(scores.reduce((sum, value) => sum + value, 0) / scores.length);
  }

  const wordCount = transcript.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 8) {
    return 0.9;
  }
  if (wordCount >= 3) {
    return 0.82;
  }
  return 0.62;
};

const createOpenAiClient = (): OpenAI => {
  if (!config.openAiApiKey) {
    throw new AppError("OPENAI_API_KEY is required when STT_PROVIDER=openai_whisper.", {
      statusCode: 500,
      code: "speech_provider_not_configured",
    });
  }

  if (!openAiClient) {
    openAiClient = new OpenAI({
      apiKey: config.openAiApiKey,
      organization: config.openAiOrganization || undefined,
    });
  }

  return openAiClient;
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

    if (config.sttProvider !== "openai_whisper") {
      throw new AppError(
        "Audio transcription provider is not configured yet. Use transcript input or configure OPENAI whisper transcription.",
        {
          statusCode: 501,
          code: "speech_provider_not_configured",
        },
      );
    }

    const audioBase64 = normalizeAudioBase64(input.audioBase64);
    if (!audioBase64) {
      throw new AppError("Audio payload is empty or invalid.", {
        statusCode: 400,
        code: "invalid_audio_payload",
      });
    }

    const mimeType = String(input.mimeType ?? "audio/m4a").trim() || "audio/m4a";
    const languageCode = String(input.language ?? "en-US").trim() || "en-US";

    try {
      const file = await toFile(Buffer.from(audioBase64, "base64"), `assistant-${input.requestId}.m4a`, {
        type: mimeType,
      });
      const response = (await withTimeout(
        createOpenAiClient().audio.transcriptions.create({
          file,
          model: config.openAiSttModel,
          language: normalizeLanguageHint(input.language),
          response_format: "verbose_json",
        }),
        config.sttTimeoutMs,
        "OpenAI Whisper transcription",
      )) as WhisperVerboseTranscription;

      const recognizedTranscript = String(response.text ?? "").trim();
      if (!recognizedTranscript) {
        throw new AppError("Audio transcription returned an empty transcript.", {
          statusCode: 502,
          code: "speech_provider_failed",
        });
      }

      const confidence = estimateConfidence(response, recognizedTranscript);
      return {
        transcript: recognizedTranscript,
        provider: "openai_whisper",
        languageCode: normalizeDetectedLanguageCode(response.language, languageCode),
        confidence,
        lowConfidence: confidence < config.sttLowConfidenceThreshold,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error("OpenAI Whisper transcription failed", {
        requestId: input.requestId,
        mimeType,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new AppError("Audio transcription failed.", {
        statusCode: 502,
        code: "speech_provider_failed",
        details: config.enableDebugLogs ? String(error) : undefined,
      });
    }
  }
}
