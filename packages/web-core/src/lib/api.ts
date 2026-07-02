import { apiResponseSchema } from "@mediaos/contracts";
import { z } from "zod";
import { getApiBaseUrl } from "./api-client";

const healthSchema = z.object({
  status: z.string(),
  service: z.string().optional(),
  time: z.string().optional(),
});
export type Health = z.infer<typeof healthSchema>;

/** Gọi API + validate envelope bằng contract dùng chung (không tin dữ liệu mạng). */
export async function getHealth(): Promise<Health> {
  const res = await fetch(`${getApiBaseUrl()}/health`);
  const json: unknown = await res.json();
  const parsed = apiResponseSchema(healthSchema).parse(json);
  if (!parsed.success || !parsed.data) {
    throw new Error(parsed.error?.message ?? "Health check failed");
  }
  return parsed.data;
}

/**
 * S2-FE-FND-4 — GET /health/db (readiness, mirror HealthController.healthDb — fail-soft: BE trả
 * status "down" thay vì lỗi HTTP khi DB ping thất bại). `@Public()` ở BE nên KHÔNG cần Bearer.
 */
const healthDbSchema = z.object({
  status: z.enum(["ok", "down"]),
  database: z
    .object({
      ok: z.boolean(),
      latencyMs: z.number().optional(),
      error: z.string().optional(),
    })
    .passthrough(),
});
export type HealthDb = z.infer<typeof healthDbSchema>;

export async function getHealthDb(): Promise<HealthDb> {
  const res = await fetch(`${getApiBaseUrl()}/health/db`);
  const json: unknown = await res.json();
  const parsed = apiResponseSchema(healthDbSchema).parse(json);
  if (!parsed.success || !parsed.data) {
    throw new Error(parsed.error?.message ?? "Health DB check failed");
  }
  return parsed.data;
}
