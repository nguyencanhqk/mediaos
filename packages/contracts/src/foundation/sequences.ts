import { z } from "zod";

/**
 * S2-FND-BE-2 — Foundation sequence-counter DTO (nguồn sự thật contracts cho
 * GET/PATCH /api/v1/foundation/sequences + GET /:id/preview). BACKEND-04 §8.6, DB-08 §8.9.
 *
 * BẤT BIẾN:
 *  - view WHITELIST — KHÔNG lộ companyId/createdBy/updatedBy/deletedAt/metadata/lockVersion (nội bộ).
 *  - KHÔNG lộ `current_value` (giá trị runtime — QA-06): list là snapshot CẤU HÌNH audit-safe. `preview`
 *    trả `value` = giá trị KẾ TIẾP (đã tính, KHÔNG mutate) + `code` render sẵn — KHÔNG phải current_value.
 *  - PATCH CHỈ field cấu hình mutable (.strict() chặn leo thang: KHÔNG id/sequenceKey/currentValue/
 *    companyId). ≥1 field (chống PATCH rỗng ghi audit no-op). Enum khớp CHECK mig 0434.
 *  - KHÔNG secret trong DTO.
 */

/** reset_policy ∈ CHECK sequence_counters (mig 0434). */
export const SEQUENCE_RESET_POLICIES = ["Never", "Yearly", "Monthly", "Daily"] as const;
export const sequenceResetPolicySchema = z.enum(SEQUENCE_RESET_POLICIES);
export type SequenceResetPolicyDto = z.infer<typeof sequenceResetPolicySchema>;

/** status ∈ CHECK sequence_counters (mig 0434). */
export const SEQUENCE_STATUSES = ["Active", "Inactive"] as const;
export const sequenceStatusSchema = z.enum(SEQUENCE_STATUSES);
export type SequenceStatusDto = z.infer<typeof sequenceStatusSchema>;

/** scope_type ∈ CHECK sequence_counters (mig 0434). */
export const SEQUENCE_SCOPE_TYPES = [
  "System",
  "Company",
  "Department",
  "Employee",
  "Custom",
] as const;
export const sequenceScopeTypeSchema = z.enum(SEQUENCE_SCOPE_TYPES);
export type SequenceScopeTypeDto = z.infer<typeof sequenceScopeTypeSchema>;

/**
 * View DTO cho 1 counter (response GET list). WHITELIST an toàn — CHỈ cấu hình + trạng thái + mã đã sinh
 * gần nhất (đã emit — KHÔNG phải secret). z.object STRIP mặc định ⇒ companyId/createdBy/updatedBy/
 * deletedAt/metadata/lockVersion/currentValue (nếu lọt từ row) bị loại. datePattern = format_pattern.
 */
export const sequenceCounterViewSchema = z
  .object({
    id: z.string().uuid(),
    moduleCode: z.string(),
    sequenceKey: z.string(),
    scopeType: sequenceScopeTypeSchema,
    scopeReferenceId: z.string().uuid().nullable(),
    prefix: z.string().nullable(),
    suffix: z.string().nullable(),
    datePattern: z.string().nullable(),
    paddingLength: z.number().int(),
    incrementBy: z.number().int(),
    resetPolicy: sequenceResetPolicySchema,
    status: sequenceStatusSchema,
    lastGeneratedCode: z.string().nullable(),
    lastResetAt: z.string().nullable(),
    updatedAt: z.string(),
  })
  .strip();
export type SequenceCounterView = z.infer<typeof sequenceCounterViewSchema>;

/** Response GET /foundation/sequences = mảng counter (envelope bọc ở interceptor). */
export const sequenceListResponseSchema = z.array(sequenceCounterViewSchema);
export type SequenceListResponse = z.infer<typeof sequenceListResponseSchema>;

/**
 * Response GET /foundation/sequences/:id/preview — mã KẾ TIẾP (KHÔNG mutate). `value` = giá trị đã tính
 * (current_value + increment / reset) — KHÔNG phải current_value đang lưu. `code` render sẵn theo cấu hình.
 */
export const sequencePreviewResponseSchema = z
  .object({
    sequenceKey: z.string(),
    value: z.number().int(),
    code: z.string(),
  })
  .strip();
export type SequencePreviewResponse = z.infer<typeof sequencePreviewResponseSchema>;

/**
 * PATCH /foundation/sequences/:id — CHỈ nhận field cấu hình mutable. `.strict()` chặn field bất biến/leo
 * thang (id/sequenceKey/currentValue/companyId/updatedBy...). `.partial()` cho patch một phần; `.refine`
 * bắt buộc ≥1 field (chống PATCH rỗng ghi audit no-op). paddingLength ≥ 0, incrementBy ≥ 1.
 */
export const patchSequenceSchema = z
  .object({
    prefix: z.string().max(100).nullable(),
    suffix: z.string().max(100).nullable(),
    datePattern: z.string().max(255).nullable(),
    paddingLength: z.number().int().min(0).max(50),
    incrementBy: z.number().int().min(1),
    resetPolicy: sequenceResetPolicySchema,
    status: sequenceStatusSchema,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Phải có ít nhất một trường để cập nhật.",
  });
export type PatchSequenceDto = z.infer<typeof patchSequenceSchema>;
