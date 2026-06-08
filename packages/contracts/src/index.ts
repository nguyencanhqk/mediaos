import { z } from "zod";

/**
 * MediaOS — Shared contracts (nguồn sự thật cho DTO giữa api ↔ web).
 * Mọi schema dùng chung khai báo ở đây bằng Zod, suy ra type bằng z.infer.
 */

/** Envelope phản hồi API thống nhất (xem patterns: API Response Format). */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const paginationMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

/** Bao phản hồi chuẩn: success + data (nullable on error) + error (nullable on success) + meta. */
export function apiResponseSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    success: z.boolean(),
    data: data.nullable(),
    error: apiErrorSchema.nullable(),
    meta: paginationMetaSchema.optional(),
  });
}

/** Placeholder version để verify wiring contracts ↔ api ↔ web. */
export const CONTRACTS_VERSION = "0.0.0" as const;

export * from "./auth";
export * from "./org";
export * from "./media";
export * from "./platform-accounts";
export * from "./workflow";
export * from "./task";
export * from "./notification";
export * from "./chat";
export * from "./settings";
export * from "./positions";
export * from "./employees";
