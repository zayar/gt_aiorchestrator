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
  sttProvider: normalizeProvider(String(process.env.STT_PROVIDER ?? "stub"), ["stub"], "stub"),
  llmProvider: normalizeProvider(String(process.env.LLM_PROVIDER ?? "heuristic"), ["heuristic"], "heuristic"),
  enableDebugLogs: getBooleanEnv("ENABLE_DEBUG_LOGS", false),
};
