import type { Request } from "express";
import { config } from "../config/index.js";
import type { GTSessionContext, GTTokenClaims } from "../types/session.js";
import { AppError } from "../utils/errors.js";

const normalizeToken = (value: string): string =>
  String(value ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();

const decodeJwtPayload = (token: string): GTTokenClaims | undefined => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as GTTokenClaims;
    return payload;
  } catch (_error) {
    return undefined;
  }
};

export class SessionContextService {
  fromRequest(req: Request & { requestId?: string }): GTSessionContext {
    const accessToken = normalizeToken(String(req.headers.authorization ?? req.headers.token ?? ""));
    if (!accessToken) {
      throw new AppError("GreatTime access token is required in Authorization header.", {
        statusCode: 401,
        code: "missing_access_token",
      });
    }

    const tokenClaims = decodeJwtPayload(accessToken);
    const clinicId =
      String(req.body?.clinicId ?? tokenClaims?.clinicId ?? "").trim() ||
      String(req.query?.clinicId ?? "").trim();

    if (!clinicId) {
      throw new AppError("clinicId is required either in token claims or request body.", {
        statusCode: 400,
        code: "missing_clinic_id",
      });
    }

    const userId = String(req.body?.userContext?.userId ?? tokenClaims?.id ?? "").trim() || undefined;
    const refreshToken = normalizeToken(
      String(req.headers["x-gt-refresh-token"] ?? req.headers["x-refresh-token"] ?? req.body?.refreshToken ?? ""),
    );

    return {
      requestId: String(req.requestId ?? req.body?.requestId ?? "").trim(),
      accessToken,
      refreshToken: refreshToken || undefined,
      clinicId,
      userId,
      role: String(req.body?.userContext?.role ?? tokenClaims?.role ?? "").trim() || undefined,
      appType: String(tokenClaims?.appId ?? "").trim() || undefined,
      locale: String(req.body?.locale ?? req.body?.language ?? "").trim() || undefined,
      timezone: String(req.body?.timezone ?? config.defaultTimezone).trim() || config.defaultTimezone,
      tokenClaims,
    };
  }
}
