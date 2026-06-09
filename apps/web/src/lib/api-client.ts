import { z } from "zod";

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

/** HTTP client dùng chung cho mọi API module — parse response bằng Zod schema. */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json();
  return schema.parse(unwrapEnvelope(json));
}
