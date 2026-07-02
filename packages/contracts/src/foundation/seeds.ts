import { z } from "zod";

/**
 * S2-FND-BE-2 — Foundation seed-run status DTO (nguồn sự thật contracts cho GET /api/v1/foundation/seeds).
 * BACKEND-04 §11.8, DB-08 §8.12/8.13.
 *
 * READ-ONLY: endpoint chỉ đọc trạng thái batch seed (status/checksum/last-run) — KHÔNG mutation.
 *
 * BẤT BIẾN:
 *  - view WHITELIST — KHÔNG lộ companyId/metadata/executedBy/errorMessage (nội bộ). z.object STRIP mặc định.
 *  - KHÔNG secret/PII/payload trong DTO (BẤT BIẾN #3): CHỈ metadata vận hành (key/version/status/checksum/
 *    mốc thời gian). `payload` của seed_items KHÔNG BAO GIỜ trả (có thể chứa config nhạy cảm).
 *  - `checksum` = hash cấu hình seed (KHÔNG phải secret) — trả để so sánh drift; app-role KHÔNG sửa được
 *    (seed_batches append-only — KHÔNG UPDATE/DELETE ngoài đường service).
 */

/** status ∈ CHECK seed_batches (mig 0435) — đồng bộ SEED_BATCH_STATUSES service. */
export const SEED_BATCH_STATUS_VALUES = [
  "Pending",
  "Running",
  "Success",
  "Failed",
  "Skipped",
  "RolledBack",
] as const;
export const seedBatchStatusSchema = z.enum(SEED_BATCH_STATUS_VALUES);
export type SeedBatchStatusDto = z.infer<typeof seedBatchStatusSchema>;

/**
 * View DTO cho 1 batch seed (response GET list). WHITELIST — trạng thái vận hành, KHÔNG secret/payload.
 * `startedAt`/`finishedAt` = mốc chạy gần nhất (ISO-8601 string). `checksum` nullable (batch cũ chưa set).
 */
export const seedBatchStatusViewSchema = z
  .object({
    id: z.string().uuid(),
    seedKey: z.string(),
    seedVersion: z.string(),
    environment: z.string().nullable(),
    status: seedBatchStatusSchema,
    checksum: z.string().nullable(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strip();
export type SeedBatchStatusView = z.infer<typeof seedBatchStatusViewSchema>;

/** Response GET /foundation/seeds = mảng batch status (envelope bọc ở interceptor). */
export const seedStatusListResponseSchema = z.array(seedBatchStatusViewSchema);
export type SeedStatusListResponse = z.infer<typeof seedStatusListResponseSchema>;
