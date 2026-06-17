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
 * lấy từ envelope { error: { code } }). UI bắt theo `status`/`code` (vd publish 422,
 * double-publish/conflict 409) thay vì so khớp chuỗi message.
 *
 * BẤT BIẾN BE (AllExceptionsFilter): mọi lỗi bị bọc thành { success:false, error:{ code, message } }
 * — payload nghiệp vụ phụ (vd dagValidation của publish 422) BỊ DẸP, không tới client. Vì vậy
 * UI tự dựng lại chi tiết (vd chạy validateDag client-side) khi cần danh sách lỗi inline.
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

/** HTTP client dùng chung cho mọi API module — parse response bằng Zod schema. */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
  opts?: { skipAuth?: boolean },
): Promise<T> {
  // Endpoint công khai (login bước 2 / 2FA verify) PHẢI opt-out: không rò Bearer của
  // phiên cũ lên route chưa xác thực. Mặc định gắn Bearer cho mọi data endpoint.
  const token = opts?.skipAuth ? null : getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
