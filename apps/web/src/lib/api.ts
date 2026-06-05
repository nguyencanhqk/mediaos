import { apiResponseSchema } from "@mediaos/contracts";
import { z } from "zod";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/v1";

const healthSchema = z.object({
  status: z.string(),
  service: z.string().optional(),
  time: z.string().optional(),
});
export type Health = z.infer<typeof healthSchema>;

/** Gọi API + validate envelope bằng contract dùng chung (không tin dữ liệu mạng). */
export async function getHealth(): Promise<Health> {
  const res = await fetch(`${API_URL}/health`);
  const json: unknown = await res.json();
  const parsed = apiResponseSchema(healthSchema).parse(json);
  if (!parsed.success || !parsed.data) {
    throw new Error(parsed.error?.message ?? "Health check failed");
  }
  return parsed.data;
}
