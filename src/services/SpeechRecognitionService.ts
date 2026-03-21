import OpenAI, { toFile } from "openai";
import { VertexAI } from "@google-cloud/vertexai";
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
  additionalLanguageCodes?: string[];
  biasPhrases?: string[];
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

type ModelTranscriptionPayload = {
  transcript?: string;
  languageCode?: string;
  confidence?: number | string;
};

const LIVE_PROVIDER = "gemini_live_stt";
const FALLBACK_PROVIDER = "gemini_audio_transcription";
const MAX_BIAS_PHRASES = 1200;
const MAX_TRANSCRIPT_LENGTH = 1800;

let openAiClient: OpenAI | null = null;
let vertexClient: VertexAI | null = null;

const clampUnit = (value: number): number => {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
};

const normalizeAudioBase64 = (value: string | undefined): string => {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  const data = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
  return data.replace(/[\r\n\s]+/g, "").trim();
};

const normalizeLanguageHint = (value: string | undefined): string | undefined => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) {
    return undefined;
  }

  if (raw === "english") {
    return "en";
  }
  if (raw === "myanmar" || raw === "burmese") {
    return "my";
  }

  const compact = raw.split(/[-_]/)[0];
  return compact || undefined;
};

const normalizeLanguageCode = (value: string | undefined): string => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) {
    return config.voicePrimaryLanguage;
  }

  if (raw === "en" || raw === "en-us" || raw === "english") {
    return "en-US";
  }
  if (raw === "my" || raw === "my-mm" || raw === "myanmar" || raw === "burmese") {
    return "my-MM";
  }

  return raw;
};

const normalizeDetectedLanguageCode = (detected: string | undefined, fallback: string): string => {
  const raw = String(detected ?? "").trim().toLowerCase();
  if (!raw) {
    return normalizeLanguageCode(fallback);
  }

  if (raw === "english" || raw === "en") {
    return fallback.toLowerCase().startsWith("en") ? normalizeLanguageCode(fallback) : "en-US";
  }

  if (raw === "myanmar" || raw === "burmese" || raw === "my") {
    return fallback.toLowerCase().startsWith("my") ? normalizeLanguageCode(fallback) : "my-MM";
  }

  return normalizeLanguageCode(raw);
};

const normalizeAdditionalLanguageCodes = (value: string[] | undefined, primaryLanguageCode: string): string[] => {
  const seeds = Array.isArray(value) ? value : [];
  const collected = new Set<string>();

  for (const candidate of seeds) {
    const normalized = normalizeLanguageCode(candidate);
    if (normalized && normalized !== primaryLanguageCode) {
      collected.add(normalized);
    }
  }

  if (primaryLanguageCode !== normalizeLanguageCode(config.voiceSecondaryLanguage)) {
    collected.add(normalizeLanguageCode(config.voiceSecondaryLanguage));
  }
  if (primaryLanguageCode !== normalizeLanguageCode(config.voicePrimaryLanguage)) {
    collected.add(normalizeLanguageCode(config.voicePrimaryLanguage));
  }

  return Array.from(collected).slice(0, 4);
};

const sanitizePhrases = (phrases: string[] | undefined): string[] => {
  const source = Array.isArray(phrases) ? phrases : [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of source) {
    const phrase = String(raw ?? "").trim();
    if (!phrase) {
      continue;
    }

    const key = phrase.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    out.push(phrase);
    if (out.length >= MAX_BIAS_PHRASES) {
      break;
    }
  }

  return out;
};

const clampTranscript = (value: string): string => {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length <= MAX_TRANSCRIPT_LENGTH) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_TRANSCRIPT_LENGTH);
};

const buildWhisperPrompt = (languageHint: string | undefined, biasPhrases: string[]): string => {
  if (languageHint === "my") {
    return [
      "This is a GreatTime clinic voice assistant for Myanmar clinics.",
      "Transcribe Myanmar or Burmese speech exactly as spoken.",
      "Keep Burmese words in Burmese script whenever they are spoken in Burmese.",
      "Do not translate Burmese speech into English.",
      "Preserve member names, service names, product names, practitioner names, dates, times, and quantities exactly as spoken.",
      biasPhrases.length > 0
        ? `Prefer these spellings when they match the audio: ${biasPhrases.slice(0, 200).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    "GreatTime clinic voice assistant transcription.",
    "Transcribe the audio exactly as spoken.",
    "Keep member names, service names, product names, practitioner names, dates, times, and quantities exactly as spoken.",
    biasPhrases.length > 0
      ? `Prefer these spellings when they match the audio: ${biasPhrases.slice(0, 200).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
};

const buildGeminiSystemInstruction = (params: {
  primaryLanguageCode: string;
  additionalLanguageCodes: string[];
  biasPhrases: string[];
}): string => {
  const languageHints = [params.primaryLanguageCode, ...params.additionalLanguageCodes].join(", ");
  const biasPreview = params.biasPhrases.length > 0 ? params.biasPhrases.slice(0, 300).join(", ") : "";

  return [
    "You are a real-time speech-to-text transcriber for GreatTime clinic operations.",
    "Transcribe the speaker exactly and preserve member names, service names, product names, practitioner names, dates, times, and quantities.",
    "Support mixed Myanmar and English in the same utterance.",
    `Preferred language order: ${languageHints}`,
    "Do not translate. Do not summarize. Output faithful transcript text only.",
    biasPreview ? `Bias phrases (prefer these spellings): ${biasPreview}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildGeminiFallbackPrompt = (params: {
  primaryLanguageCode: string;
  additionalLanguageCodes: string[];
  biasPhrases: string[];
}): string => {
  const biasPreview = params.biasPhrases.slice(0, 400).join(", ");
  return [
    "Transcribe this clinic staff speech audio.",
    "Return strict JSON only with this shape:",
    '{"transcript":"string","languageCode":"string","confidence":0.0}',
    "Rules:",
    "- Keep member names, service names, product names, practitioner names, dates, times, and quantities exactly as spoken.",
    "- Handle Myanmar and English mixed speech.",
    `- Primary language: ${params.primaryLanguageCode}`,
    `- Additional languages: ${params.additionalLanguageCodes.join(", ") || "none"}`,
    biasPreview ? `- bias_phrases: ${biasPreview}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const countMatches = (value: string, pattern: RegExp): number => value.match(pattern)?.length ?? 0;

const containsMyanmarScript = (value: string): boolean => /[\u1000-\u109F\uAA60-\uAA7F]/u.test(value);

const looksSuspiciousForMyanmar = (transcript: string): boolean => {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return true;
  }

  if (containsMyanmarScript(trimmed)) {
    return false;
  }

  return countMatches(trimmed, /[A-Za-z]/g) >= 10;
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

const estimateWhisperConfidence = (payload: WhisperVerboseTranscription, transcript: string): number => {
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

const extractJsonObject = (raw: string): string => {
  const text = String(raw ?? "").trim();
  if (!text) {
    return "";
  }

  const unwrapped = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const firstBrace = unwrapped.indexOf("{");
  if (firstBrace < 0) {
    return "";
  }

  let depth = 0;
  let escaped = false;
  let inString = false;

  for (let index = firstBrace; index < unwrapped.length; index += 1) {
    const ch = unwrapped[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }

    if (ch === "{") {
      depth += 1;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return unwrapped.slice(firstBrace, index + 1);
      }
    }
  }

  return "";
};

const parseModelPayload = (raw: string): ModelTranscriptionPayload => {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    const plain = clampTranscript(raw);
    return plain ? { transcript: plain } : {};
  }

  try {
    const parsed = JSON.parse(jsonText) as ModelTranscriptionPayload;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const toConfidence = (value: unknown): number | null => {
  if (typeof value === "number") {
    if (Number.isFinite(value) && value >= 0 && value <= 1) {
      return value;
    }
    return null;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }

  return null;
};

const mergeTranscriptionPieces = (pieces: string[]): string => {
  let transcript = "";
  for (const piece of pieces) {
    const text = clampTranscript(piece);
    if (!text) {
      continue;
    }

    if (!transcript) {
      transcript = text;
      continue;
    }

    if (text === transcript || transcript.includes(text)) {
      continue;
    }

    if (text.length > transcript.length && text.includes(transcript)) {
      transcript = text;
      continue;
    }

    transcript = `${transcript} ${text}`.replace(/\s+/g, " ").trim();
  }

  return clampTranscript(transcript);
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

const getVertexClient = (): VertexAI => {
  if (!config.gcpProjectId) {
    throw new AppError("GCP_PROJECT_ID is required when STT_PROVIDER=vertex_gemini.", {
      statusCode: 500,
      code: "speech_provider_not_configured",
    });
  }

  if (!vertexClient) {
    vertexClient = new VertexAI({
      project: config.gcpProjectId,
      location: config.vertexRegion,
    });
  }

  return vertexClient;
};

const transcribeWithOpenAi = async (params: {
  requestId: string;
  audioBase64: string;
  mimeType: string;
  model: string;
  languageHint?: string;
  biasPhrases: string[];
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
      prompt: buildWhisperPrompt(params.languageHint, params.biasPhrases),
      response_format: "verbose_json",
      temperature: 0,
    }),
    params.timeoutMs,
    "OpenAI Whisper transcription",
  )) as WhisperVerboseTranscription;
};

const transcribeWithGeminiLive = async (params: {
  audioBase64: string;
  mimeType: string;
  primaryLanguageCode: string;
  additionalLanguageCodes: string[];
  biasPhrases: string[];
}): Promise<string> => {
  const genaiModule = await import("@google/genai");
  const ai = new genaiModule.GoogleGenAI({
    vertexai: true,
    project: config.gcpProjectId,
    location: config.voiceRealtimeVertexLocation,
  });

  let session: any = null;

  try {
    const transcription = await Promise.race([
      new Promise<string>(async (resolve, reject) => {
        const chunks: string[] = [];
        let completed = false;

        const finish = (value: string) => {
          if (completed) {
            return;
          }
          completed = true;
          resolve(value);
        };

        const fail = (error: unknown) => {
          if (completed) {
            return;
          }
          completed = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        };

        try {
          session = await ai.live.connect({
            model: config.voiceRealtimeModel,
            config: {
              responseModalities: [genaiModule.Modality.TEXT],
              inputAudioTranscription: {},
              temperature: 0,
              maxOutputTokens: 128,
              systemInstruction: buildGeminiSystemInstruction({
                primaryLanguageCode: params.primaryLanguageCode,
                additionalLanguageCodes: params.additionalLanguageCodes,
                biasPhrases: params.biasPhrases,
              }),
            },
            callbacks: {
              onmessage: (message: any) => {
                const part = String(message?.serverContent?.inputTranscription?.text ?? "").trim();
                if (part) {
                  chunks.push(part);
                }

                const isFinished = Boolean(message?.serverContent?.inputTranscription?.finished);
                const turnComplete = Boolean(message?.serverContent?.turnComplete);
                if (isFinished || turnComplete) {
                  finish(mergeTranscriptionPieces(chunks));
                }
              },
              onerror: (error: unknown) => {
                fail(error);
              },
              onclose: () => {
                finish(mergeTranscriptionPieces(chunks));
              },
            },
          });

          session.sendRealtimeInput({
            audio: {
              data: params.audioBase64,
              mimeType: params.mimeType || "audio/m4a",
            },
          });
          session.sendRealtimeInput({ audioStreamEnd: true });
          session.sendClientContent({ turnComplete: true });
        } catch (error) {
          fail(error);
        }
      }),
      new Promise<string>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("gemini_live_transcription_timeout"));
        }, config.sttTimeoutMs);
      }),
    ]);

    return clampTranscript(transcription);
  } finally {
    try {
      session?.close();
    } catch {
      // Ignore close errors.
    }
  }
};

const transcribeWithGeminiFallback = async (params: {
  audioBase64: string;
  mimeType: string;
  primaryLanguageCode: string;
  additionalLanguageCodes: string[];
  biasPhrases: string[];
}): Promise<{ transcript: string; languageCode: string; confidence: number | null }> => {
  const model = getVertexClient().getGenerativeModel({
    model: config.voiceRecognitionFallbackModel,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 512,
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
              text: buildGeminiFallbackPrompt({
                primaryLanguageCode: params.primaryLanguageCode,
                additionalLanguageCodes: params.additionalLanguageCodes,
                biasPhrases: params.biasPhrases,
              }),
            },
            {
              inlineData: {
                mimeType: params.mimeType || "audio/m4a",
                data: params.audioBase64,
              },
            },
          ],
        },
      ],
    } as any),
    config.sttTimeoutMs,
    "Gemini fallback transcription",
  );

  const parts = response.response.candidates?.[0]?.content?.parts ?? [];
  const rawText = (parts as Array<{ text?: string }>)
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();

  const payload = parseModelPayload(rawText);
  return {
    transcript: clampTranscript(String(payload.transcript ?? "")),
    languageCode: normalizeLanguageCode(String(payload.languageCode ?? params.primaryLanguageCode)),
    confidence: toConfidence(payload.confidence),
  };
};

export class SpeechRecognitionService {
  async recognize(input: SpeechRecognitionInput): Promise<SpeechRecognitionOutput> {
    const transcript = String(input.transcript ?? "").trim();
    if (transcript) {
      return {
        transcript,
        provider: "transcript_only",
        languageCode: normalizeLanguageCode(input.language),
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

    const audioBase64 = normalizeAudioBase64(input.audioBase64);
    if (!audioBase64) {
      throw new AppError("Audio payload is empty or invalid.", {
        statusCode: 400,
        code: "invalid_audio_payload",
      });
    }

    const mimeType = String(input.mimeType ?? "audio/m4a").trim() || "audio/m4a";
    const primaryLanguageCode = normalizeLanguageCode(input.language);
    const additionalLanguageCodes = normalizeAdditionalLanguageCodes(
      input.additionalLanguageCodes,
      primaryLanguageCode,
    );
    const biasPhrases = sanitizePhrases(input.biasPhrases);

    if (config.sttProvider === "stub") {
      throw new AppError(
        "Audio transcription provider is not configured yet. Use transcript input or configure Gemini speech transcription.",
        {
          statusCode: 501,
          code: "speech_provider_not_configured",
        },
      );
    }

    if (config.sttProvider === "vertex_gemini") {
      let transcriptFromLive = "";
      let provider = LIVE_PROVIDER;
      let languageCode = primaryLanguageCode;
      let confidence: number | null = null;

      try {
        transcriptFromLive = await transcribeWithGeminiLive({
          audioBase64,
          mimeType,
          primaryLanguageCode,
          additionalLanguageCodes,
          biasPhrases,
        });
      } catch (error) {
        logger.warn("Gemini live transcription failed, falling back", {
          requestId: input.requestId,
          requestedLanguage: input.language,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (!transcriptFromLive) {
        const fallback = await transcribeWithGeminiFallback({
          audioBase64,
          mimeType,
          primaryLanguageCode,
          additionalLanguageCodes,
          biasPhrases,
        });
        transcriptFromLive = fallback.transcript;
        confidence = fallback.confidence;
        languageCode = fallback.languageCode;
        provider = FALLBACK_PROVIDER;
      }

      const recognizedTranscript = clampTranscript(transcriptFromLive);
      if (!recognizedTranscript) {
        throw new AppError("Audio transcription failed.", {
          statusCode: 502,
          code: "speech_provider_failed",
        });
      }

      const finalConfidence = confidence ?? 0.78;
      return {
        transcript: recognizedTranscript,
        provider,
        languageCode,
        confidence: finalConfidence,
        lowConfidence: finalConfidence < config.sttLowConfidenceThreshold,
      };
    }

    if (config.sttProvider !== "openai_whisper") {
      throw new AppError("Unsupported speech provider configuration.", {
        statusCode: 500,
        code: "speech_provider_not_configured",
      });
    }

    try {
      const languageHint = normalizeLanguageHint(input.language);
      let response = await transcribeWithOpenAi({
        requestId: input.requestId,
        audioBase64,
        mimeType,
        model: config.openAiSttModel,
        languageHint,
        biasPhrases,
        timeoutMs: config.sttTimeoutMs,
      });

      let recognizedTranscript = String(response.text ?? "").trim();
      if (!recognizedTranscript) {
        throw new AppError("Audio transcription returned an empty transcript.", {
          statusCode: 502,
          code: "speech_provider_failed",
        });
      }

      let confidence = estimateWhisperConfidence(response, recognizedTranscript);
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
          biasPhrases,
          timeoutMs: config.sttTimeoutMs,
        });
        const retryTranscript = String(retryResponse.text ?? "").trim();
        const retryConfidence = retryTranscript
          ? estimateWhisperConfidence(retryResponse, retryTranscript)
          : 0;

        if (
          retryTranscript &&
          (retryConfidence > confidence ||
            (containsMyanmarScript(retryTranscript) && !containsMyanmarScript(recognizedTranscript)))
        ) {
          response = retryResponse;
          recognizedTranscript = retryTranscript;
          confidence = retryConfidence;
        }
      }

      return {
        transcript: recognizedTranscript,
        provider: "openai_whisper",
        languageCode: normalizeDetectedLanguageCode(response.language, primaryLanguageCode),
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
