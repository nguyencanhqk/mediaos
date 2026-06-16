import Constants from "expo-constants";
import { z } from "zod";
import { getAccessToken } from "../auth/token-storage";

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
 * Core fetch wrapper for all API modules.
 * - Appends Bearer token when `authenticated: true`.
 * - Unwraps the standard MediaOS envelope.
 * - Parses and validates the response with the provided Zod schema.
 */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  options: FetchOptions = {},
): Promise<T> {
  const { authenticated = false, headers = {}, ...rest } = options;

  const authHeaders: Record<string, string> = {};
  if (authenticated) {
    const token = await getAccessToken();
    if (token) {
      authHeaders["Authorization"] = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw toApiError(res.status, path, body);
  }

  if (res.status === 204) return undefined as T;

  const json: unknown = await res.json();
  return schema.parse(unwrapEnvelope(json));
}
