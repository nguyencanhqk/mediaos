import { z } from "zod";

/**
 * S2-FND-BE-3 (L2) — Foundation retention-policy DTO (nguồn sự thật contracts cho
 * GET/PATCH /api/v1/foundation/retention-policies). BACKEND-11 §17.3/§17.4, DB-08 §8.11.
 *
 * BẤT BIẾN: view WHITELIST — KHÔNG lộ companyId/metadata/createdBy/updatedBy/deletedAt (nội bộ, không
 * cần cho FE). patch CHỈ field mutable (KHÔNG id/moduleCode/entityType/companyId — .strict() chặn leo
 * thang). cleanupAction khớp CHECK mig 0435; retentionDays >= 0. KHÔNG secret trong DTO.
 */

/** cleanup_action ∈ CHECK data_retention_policies (mig 0435) — khớp RetentionService.CLEANUP_ACTIONS. */
export const CLEANUP_ACTIONS = ["None", "Archive", "Delete", "Anonymize"] as const;
export const cleanupActionSchema = z.enum(CLEANUP_ACTIONS);
export type CleanupActionDto = z.infer<typeof cleanupActionSchema>;

/**
 * View DTO cho 1 chính sách lưu trữ (response). WHITELIST an toàn — chỉ field FE cần hiển thị. z.object
 * mặc định STRIP key lạ ⇒ companyId/metadata/createdBy/updatedBy/deletedAt (nếu lọt từ row) bị loại.
 * updatedAt = ISO-8601 string trên wire (khớp convention companyViewSchema).
 */
export const retentionPolicyViewSchema = z
  .object({
    id: z.string().uuid(),
    moduleCode: z.string(),
    entityType: z.string(),
    retentionDays: z.number().int(),
    cleanupAction: cleanupActionSchema,
    archiveAfterDays: z.number().int().nullable(),
    deleteAfterDays: z.number().int().nullable(),
    isLegalHoldSupported: z.boolean(),
    isEnabled: z.boolean(),
    description: z.string().nullable(),
    updatedAt: z.string(),
  })
  .strip();
export type RetentionPolicyView = z.infer<typeof retentionPolicyViewSchema>;

/** Response GET /retention-policies = mảng policy (envelope + pagination bọc ở interceptor). */
export const retentionPolicyListResponseSchema = z.array(retentionPolicyViewSchema);
export type RetentionPolicyListResponse = z.infer<typeof retentionPolicyListResponseSchema>;

/**
 * PATCH /retention-policies/:id — CHỈ nhận field mutable. `.strict()` chặn field bất biến/leo thang
 * (id/moduleCode/entityType/companyId/updatedBy...). `.partial()` cho patch một phần; `.refine` bắt buộc
 * ≥1 field để chống PATCH rỗng ghi audit no-op. retentionDays >= 0 (khớp CHECK mig 0435).
 */
export const patchRetentionPolicySchema = z
  .object({
    retentionDays: z.number().int().min(0),
    cleanupAction: cleanupActionSchema,
    archiveAfterDays: z.number().int().min(0).nullable(),
    deleteAfterDays: z.number().int().min(0).nullable(),
    isLegalHoldSupported: z.boolean(),
    isEnabled: z.boolean(),
    description: z.string().max(2000).nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Phải có ít nhất một trường để cập nhật.",
  });
export type PatchRetentionPolicyDto = z.infer<typeof patchRetentionPolicySchema>;

/**
 * S2-FND-BE-8 (be-retention-create-simulate) — POST /foundation/retention-policies body (create). APPEND
 * vào file đã-export (barrel không đổi). BẤT BIẾN #1/#3: KHÔNG nhận companyId (lấy từ ngữ cảnh tenant) và
 * KHÔNG nhận createdBy/updatedBy/id (server gán từ actor) — `.strict()` chặn field lạ/leo thang. entityType
 * ép `^[a-z_][a-z0-9_]*$` (khớp guard `_countEligible` service — chống SQL identifier injection ở ranh giới).
 * cleanupAction/retentionDays khớp CHECK mig 0435; default áp Ở SERVICE (schema chỉ optional). KHÔNG secret.
 */
export const createRetentionPolicySchema = z
  .object({
    moduleCode: z.string().min(1).max(50),
    entityType: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z_][a-z0-9_]*$/, "entityType phải là snake_case identifier hợp lệ."),
    retentionDays: z.number().int().min(0),
    cleanupAction: cleanupActionSchema.optional(),
    archiveAfterDays: z.number().int().min(0).nullable().optional(),
    deleteAfterDays: z.number().int().min(0).nullable().optional(),
    isLegalHoldSupported: z.boolean().optional(),
    isEnabled: z.boolean().optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type CreateRetentionPolicyDto = z.infer<typeof createRetentionPolicySchema>;

/**
 * S2-FND-BE-8 — response POST /foundation/retention-policies/:id/simulate (§17.3, READ-ONLY đếm eligible).
 * `.strip()` loại field lạ (phòng thủ chiều sâu). cutoffTime = ISO-8601 string trên wire (khớp updatedAt).
 * KHÔNG lộ companyId — chỉ policyId/moduleCode/entityType + số đếm + cờ isEnabled (an toàn, không secret).
 */
export const simulateResultSchema = z
  .object({
    policyId: z.string().uuid(),
    moduleCode: z.string(),
    entityType: z.string(),
    eligibleRecords: z.number().int(),
    action: cleanupActionSchema,
    cutoffTime: z.string(),
    isEnabled: z.boolean(),
  })
  .strip();
export type SimulateResultView = z.infer<typeof simulateResultSchema>;
