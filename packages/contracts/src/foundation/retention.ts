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
