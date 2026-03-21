import "dotenv/config";

const getStringEnv = (key: string, fallback = ""): string => {
  const value = String(process.env[key] ?? fallback).trim();
  if (!value) {
    throw new Error(`Missing env var: ${key}`);
  }
  return value;
};

const getBooleanEnv = (key: string, fallback: boolean): boolean => {
  const rawValue = String(process.env[key] ?? "").trim().toLowerCase();
  if (!rawValue) {
    return fallback;
  }
  if (rawValue === "true") {
    return true;
  }
  if (rawValue === "false") {
    return false;
  }
  throw new Error(`Invalid env var: ${key}. Expected true or false.`);
};

const getPositiveNumberEnv = (key: string, fallback: number): number => {
  const rawValue = String(process.env[key] ?? "").trim();
  if (!rawValue) {
    return fallback;
  }
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid env var: ${key}. Expected a positive number.`);
  }
  return value;
};

const getUnitIntervalEnv = (key: string, fallback: number): number => {
  const rawValue = String(process.env[key] ?? "").trim();
  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid env var: ${key}. Expected a number between 0 and 1.`);
  }
  return value;
};

const getUrlEnv = (key: string, fallback: string): string => {
  const value = getStringEnv(key, fallback);
  try {
    new URL(value);
  } catch (_error) {
    throw new Error(`Invalid env var: ${key}. Expected a full URL.`);
  }
  return value;
};

const normalizeProvider = <TProvider extends string>(
  value: string,
  supported: readonly TProvider[],
  fallback: TProvider,
): TProvider => {
  const normalized = String(value ?? "").trim().toLowerCase() as TProvider;
  return supported.includes(normalized) ? normalized : fallback;
};

export const config = {
  serviceName: "ai-orchestrator-gt",
  port: getPositiveNumberEnv("PORT", 8082),
  requestBodyLimit: getStringEnv("REQUEST_BODY_LIMIT", "8mb"),
  logRequestBodies: getBooleanEnv("LOG_REQUEST_BODIES", false),
  gtApiCoreUrl: getUrlEnv("GT_APICORE_URL", "https://api.greattime.app/apicore"),
  gtRequestTimeoutMs: getPositiveNumberEnv("GT_REQUEST_TIMEOUT_MS", 12000),
  catalogCacheTtlMs: getPositiveNumberEnv("GT_CATALOG_CACHE_TTL_MS", 5 * 60 * 1000),
  previewCacheTtlMs: getPositiveNumberEnv("GT_PREVIEW_CACHE_TTL_MS", 15 * 60 * 1000),
  idempotencyTtlMs: getPositiveNumberEnv("GT_IDEMPOTENCY_TTL_MS", 60 * 60 * 1000),
  defaultTimezone: getStringEnv("DEFAULT_TIMEZONE", "Asia/Yangon"),
  sttProvider: normalizeProvider(
    String(process.env.STT_PROVIDER ?? "vertex_gemini"),
    ["stub", "openai_whisper", "vertex_gemini"],
    "vertex_gemini",
  ),
  openAiApiKey: String(process.env.OPENAI_API_KEY ?? "").trim(),
  openAiOrganization: String(process.env.OPENAI_ORG_ID ?? "").trim(),
  openAiSttModel: getStringEnv("OPENAI_STT_MODEL", "whisper-1"),
  sttTimeoutMs: getPositiveNumberEnv("STT_TIMEOUT_MS", 20000),
  sttLowConfidenceThreshold: getUnitIntervalEnv("STT_LOW_CONFIDENCE_THRESHOLD", 0.68),
  voiceRealtimeVertexLocation: getStringEnv("VOICE_REALTIME_VERTEX_LOCATION", "global"),
  voiceRealtimeModel: getStringEnv(
    "VOICE_REALTIME_MODEL",
    "gemini-2.0-flash-live-preview-04-09",
  ),
  voiceRecognitionFallbackModel: getStringEnv(
    "VOICE_RECOGNITION_FALLBACK_MODEL",
    process.env.VERTEX_MODEL ?? "gemini-2.5-flash",
  ),
  voicePrimaryLanguage: getStringEnv("VOICE_PRIMARY_LANGUAGE", "my-MM"),
  voiceSecondaryLanguage: getStringEnv("VOICE_SECONDARY_LANGUAGE", "en-US"),
  llmProvider: normalizeProvider(
    String(process.env.LLM_PROVIDER ?? "heuristic"),
    ["heuristic", "vertex_gemini"],
    "heuristic",
  ),
  gcpProjectId: String(process.env.GCP_PROJECT_ID ?? "").trim(),
  vertexRegion: getStringEnv("VERTEX_REGION", process.env.GCP_REGION ?? "asia-southeast1"),
  vertexModel: getStringEnv("VERTEX_MODEL", "gemini-2.5-flash"),
  llmTimeoutMs: getPositiveNumberEnv("LLM_TIMEOUT_MS", 10000),
  llmMinConfidenceForHints: getUnitIntervalEnv("LLM_MIN_CONFIDENCE_FOR_HINTS", 0.6),
  enableDebugLogs: getBooleanEnv("ENABLE_DEBUG_LOGS", false),
};
