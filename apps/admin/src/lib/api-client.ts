import { z } from "zod";
import { getAccessToken } from "@/stores/auth";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3100/api/v1";

/**
 * Gỡ envelope chuẩn của API ({ success, data, error }) nếu có, ngược lại trả nguyên body.
 * API thật (main.ts ResponseEnvelopeInterceptor) luôn bọc envelope; một số test mock body trần.
 * Tolerant unwrap → cùng client chạy đúng cả 2 hình dạng.
 */
export function unwrapEnvelope(json: unknown): unknown {
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

/**
 * Lỗi HTTP có cấu trúc — mang theo `status` (mã HTTP) + `code` (mã lỗi nghiệp vụ của BE
 * lấy từ envelope { error: { code } }). UI bắt theo `status`/`code` thay vì so khớp chuỗi message.
 *
 * BẤT BIẾN BE (AllExceptionsFilter): mọi lỗi bị bọc thành { success:false, error:{ code, message } }.
 */
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

/** Bóc { error: { code, message } } từ body lỗi (envelope chuẩn) → ApiError; fallback nếu body không phải JSON. */
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
    // body không phải JSON — rơi xuống fallback bên dưới.
  }
  return new ApiError(status, "HTTP_ERROR", `${status} ${path}: ${rawBody}`.trim());
}

/**
 * HTTP client dùng chung cho mọi API module — parse response bằng Zod schema.
 *
 * FIX (port từ apps/web): apiFetch **tự gắn** `Authorization: Bearer <token>` từ auth store.
 * Bug gốc ở apps/web: apiFetch KHÔNG gắn token nên mọi data screen 401 sau login (chỉ vài
 * call gắn tay). Ở đây token được gắn mặc định; caller vẫn override được qua `init.headers`
 * (vd step-up token cho cross-tenant write ở AC-0b).
 */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // init.headers ĐẶT CUỐI → caller có thể override Authorization (vd step-up) hoặc Content-Type.
      ...init?.headers,
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
