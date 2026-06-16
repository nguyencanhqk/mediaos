import Constants from "expo-constants";
import { z } from "zod";
import { authTokensSchema } from "@mediaos/contracts";
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  saveTokens,
} from "../auth/token-storage";

/**
 * Base URL from app config (EXPO_PUBLIC_API_URL or default localhost).
 * Set EXPO_PUBLIC_API_URL in .env.local for development/staging/prod.
 */
const API_URL =
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "http://localhost:3100/api/v1";

/**
 * Unwrap the standard MediaOS API envelope { success, data, error }.
 * The API always wraps responses via ResponseEnvelopeInterceptor.
 */
function unwrapEnvelope(json: unknown): unknown {
  if (
    json !== null &&
    typeof json === "object" &&
    "success" in json &&
    "data" in json &&
    "error" in json
  ) {
    return (json as { data: unknown }).data;
  }
  return json;
}

/** Structured HTTP error carrying HTTP status + business error code from the envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** True when the error is an HTTP 403 — the server denied the action (permission/RLS). */
export function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

/**
 * User-facing message for any thrown value. A 403 always becomes the generic permission message
 * (never leak server detail); other errors surface their message, falling back to a Vietnamese default.
 */
export function errorMessage(err: unknown, fallback = "Đã có lỗi xảy ra. Vui lòng thử lại."): string {
  if (isForbidden(err)) return "Bạn không có quyền thực hiện thao tác này.";
  if (err instanceof ApiError) {
    // "HTTP_ERROR" is the non-enveloped fallback whose message embeds the raw response body — never
    // surface that to the user (it can carry server stack traces / internal detail). Enveloped errors
    // carry a team-authored business message, which is safe to show.
    if (err.code === "HTTP_ERROR") return `Lỗi máy chủ (${err.status}). Vui lòng thử lại.`;
    return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function toApiError(status: number, path: string, rawBody: string): ApiError {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "error" in parsed &&
      (parsed as { error: unknown }).error !== null &&
      typeof (parsed as { error: unknown }).error === "object"
    ) {
      const err = (parsed as { error: { code?: unknown; message?: unknown } }).error;
      const code = typeof err.code === "string" ? err.code : "HTTP_ERROR";
      const message = typeof err.message === "string" ? err.message : `${status} ${path}`;
      return new ApiError(status, code, message);
    }
  } catch {
    // Non-JSON body — fall through to generic error.
  }
  return new ApiError(status, "HTTP_ERROR", `${status} ${path}: ${rawBody}`.trim());
}

interface FetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
  /** If true, attaches stored Bearer token automatically (default: false). */
  authenticated?: boolean;
}

/**
 * Single-flight refresh: a 401 from any concurrent request triggers ONE refresh attempt that all
 * waiters share. Returns the new access token on success, or null when refresh is impossible
 * (no refresh token / refresh rejected) — in which case stored tokens are cleared so the auth
 * guard forces re-login on the next navigation. The /auth/refresh call is made with raw fetch
 * (not authApi) to avoid an import cycle (auth-api → client).
 */
let refreshInFlight: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      await clearTokens();
      return null;
    }
    const json: unknown = await res.json();
    const parsed = authTokensSchema.safeParse(unwrapEnvelope(json));
    if (!parsed.success) {
      await clearTokens();
      return null;
    }
    await saveTokens(parsed.data.accessToken, parsed.data.refreshToken);
    return parsed.data.accessToken;
  } catch {
    // Network failure — do NOT clear tokens (transient); let the original 401 propagate.
    return null;
  }
}

function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    // Reset the slot inside the value/error continuations (not `.finally`) so the null-reset happens
    // AFTER awaiting callers have received the token — closing the one-microtask window where a late
    // caller could otherwise see `null` and kick off a second refresh.
    refreshInFlight = performRefresh().then(
      (token) => {
        refreshInFlight = null;
        return token;
      },
      (err) => {
        refreshInFlight = null;
        throw err;
      },
    );
  }
  return refreshInFlight;
}

/**
 * Core fetch wrapper for all API modules.
 * - Appends Bearer token when `authenticated: true`.
 * - On a 401 for an authenticated request, transparently refreshes the access token ONCE and
 *   retries (token rotation per session — pays down the M0 "no auto-refresh" debt).
 * - Unwraps the standard MediaOS envelope, then parses with the provided Zod schema.
 */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  options: FetchOptions = {},
): Promise<T> {
  const { authenticated = false, headers = {}, ...rest } = options;

  async function send(token: string | null): Promise<Response> {
    const authHeaders: Record<string, string> = {};
    if (token) authHeaders["Authorization"] = `Bearer ${token}`;
    return fetch(`${API_URL}${path}`, {
      ...rest,
      headers: { "Content-Type": "application/json", ...authHeaders, ...headers },
    });
  }

  let token = authenticated ? await getAccessToken() : null;
  let res = await send(token);

  // 401 on an authenticated call → one refresh + retry. Unauthenticated calls never refresh.
  if (res.status === 401 && authenticated) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      token = newToken;
      res = await send(token);
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw toApiError(res.status, path, body);
  }

  if (res.status === 204) return undefined as T;

  const json: unknown = await res.json();
  return schema.parse(unwrapEnvelope(json));
}
