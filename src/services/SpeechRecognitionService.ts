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

const countMatches = (value: string, pattern: RegExp): number => {
  return value.match(pattern)?.length ?? 0;
};

const containsMyanmarScript = (value: string): boolean => {
  return /[\u1000-\u109F\uAA60-\uAA7F]/u.test(value);
};

const looksSuspiciousForMyanmar = (transcript: string): boolean => {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return true;
  }

  if (containsMyanmarScript(trimmed)) {
    return false;
  }

  const asciiLetters = countMatches(trimmed, /[A-Za-z]/g);
  return asciiLetters >= 10;
};

const buildTranscriptionPrompt = (languageHint: string | undefined): string => {
  if (languageHint === "my") {
    return [
      "This is a GreatTime clinic voice assistant for Myanmar clinics.",
      "Transcribe Burmese or Myanmar speech exactly as spoken.",
      "Keep Burmese words in Burmese script whenever they are spoken in Burmese.",
      "Do not translate Burmese speech into English.",
      "Keep member names, service names, product names, practitioner names, phone numbers, dates, times, and quantities exactly as spoken.",
      "Clinic terms may include consultation, booking, hydrafacial, serum, sunscreen, facial, laser, Dr Min, Ma Su, and Piti Aesthetic.",
    ].join(" ");
  }

  return [
    "GreatTime clinic voice assistant transcription.",
    "Transcribe the audio exactly as spoken.",
    "Keep member names, service names, product names, practitioner names, phone numbers, dates, times, and quantities exactly as spoken.",
    "Do not summarize or rewrite the speech.",
  ].join(" ");
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

const transcribeWithOpenAi = async (params: {
  requestId: string;
  audioBase64: string;
  mimeType: string;
  model: string;
  languageHint?: string;
  prompt: string;
  timeoutMs: number;
}): Promise<WhisperVerboseTranscription> => {
  const file = await toFile(Buffer.from(params.audioBase64, "base64"), `assistant-${params.requestId}.m4a`, {
    type: params.mimeType,
  });

  return (await withTimeout(
    createOpenAiClient().audio.transcriptions.create({
      file,
      model: params.model,
      language: params.languageHint,
      prompt: params.prompt,
      response_format: "verbose_json",
      temperature: 0,
    }),
    params.timeoutMs,
    "OpenAI Whisper transcription",
  )) as WhisperVerboseTranscription;
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
    const languageHint = normalizeLanguageHint(input.language);
    const prompt = buildTranscriptionPrompt(languageHint);

    try {
      let response = await transcribeWithOpenAi({
        requestId: input.requestId,
        audioBase64,
        mimeType,
        model: config.openAiSttModel,
        languageHint,
        prompt,
        timeoutMs: config.sttTimeoutMs,
      });

      let recognizedTranscript = String(response.text ?? "").trim();
      if (!recognizedTranscript) {
        throw new AppError("Audio transcription returned an empty transcript.", {
          statusCode: 502,
          code: "speech_provider_failed",
        });
      }

      let confidence = estimateConfidence(response, recognizedTranscript);
      if (languageHint === "my" && looksSuspiciousForMyanmar(recognizedTranscript)) {
        logger.warn("Retrying low-confidence Myanmar transcription without fixed language hint", {
          requestId: input.requestId,
          requestedLanguage: input.language,
          transcriptPreview: recognizedTranscript.slice(0, 160),
          confidence,
        });

        const retryResponse = await transcribeWithOpenAi({
          requestId: `${input.requestId}-retry`,
          audioBase64,
          mimeType,
          model: config.openAiSttModel,
          prompt,
          timeoutMs: config.sttTimeoutMs,
        });
        const retryTranscript = String(retryResponse.text ?? "").trim();
        const retryConfidence = retryTranscript
          ? estimateConfidence(retryResponse, retryTranscript)
          : 0;

        if (
          retryTranscript &&
          (retryConfidence > confidence ||
              (containsMyanmarScript(retryTranscript) &&
                  !containsMyanmarScript(recognizedTranscript)))
        ) {
          response = retryResponse;
          recognizedTranscript = retryTranscript;
          confidence = retryConfidence;
        }
      }

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
        requestedLanguage: input.language,
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
