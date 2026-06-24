import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * S1-FND-SETTING-1 — Zod DTO CỤC BỘ cho SettingService (mẫu holidays.dto BE-6). KHÔNG sửa
 * packages/contracts/settings.ts (domain company-profile CŨ G5/CS-5 out-of-scope — va = drift, HOT-FILE §3).
 *
 * Validate ở ranh giới HTTP (BẤT BIẾN: không trust input). value_type ∈ DB CHECK (mig 0431):
 * String/Number/Boolean/JSON/Array/SecretRef. setting_value = unknown (jsonb tự do) — khớp value_type được
 * ép ở service (setting-validate), KHÔNG ở Zod (Zod chỉ chặn shape/format thô).
 */

/** value_type hợp lệ — mirror CHECK value_type của company_settings/system_settings (mig 0431). */
export const SETTING_VALUE_TYPES = [
  "String",
  "Number",
  "Boolean",
  "JSON",
  "Array",
  "SecretRef",
] as const;
export const valueTypeEnum = z.enum(SETTING_VALUE_TYPES);
export type SettingValueType = (typeof SETTING_VALUE_TYPES)[number];

/** status ∈ Active/Inactive (mig 0431). PATCH chỉ cho Active/Inactive (soft-disable, KHÔNG hard-delete). */
export const settingStatusEnum = z.enum(["Active", "Inactive"]);

/** CSV `a,b,c` → ['a','b','c'] (trim + bỏ rỗng). Query string ?keys=k1,k2. */
const csvKeys = z
  .string()
  .transform((s) =>
    s
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0),
  )
  .pipe(z.array(z.string().min(1).max(150)).max(200));

/** Query boolean an toàn: 'true'/'false' (query string) hoặc boolean thật (KHÔNG z.coerce.boolean — footgun). */
const boolQuery = z
  .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
  .optional();

/**
 * GET /foundation/settings/public — KHÔNG nhận key tường minh (trả TẤT CẢ public-nonsensitive theo
 * filter category/module). Filter tuỳ chọn để FE bootstrap đúng nhóm.
 */
export const publicQuerySchema = z.object({
  category: z.string().min(1).max(100).optional(),
  moduleCode: z.string().min(1).max(50).optional(),
});

/**
 * POST /foundation/settings/resolve — yêu cầu giải nhiều key (precedence). include_metadata=true → trả
 * kèm value_type/category/scope (FE quản trị); mặc định chỉ key→value an toàn.
 */
export const resolveBodySchema = z
  .object({
    keys: z.array(z.string().min(1).max(150)).max(200).optional(),
    category: z.string().min(1).max(100).optional(),
    moduleCode: z.string().min(1).max(50).optional(),
    includeMetadata: z.boolean().optional(),
  })
  .refine((b) => (b.keys && b.keys.length > 0) || b.category || b.moduleCode, {
    message: "Phải cung cấp ít nhất một trong: keys, category, moduleCode.",
  });

/** Query-string variant của resolve (cho client gọi GET-style nếu cần) — keys csv. */
export const resolveQuerySchema = z.object({
  keys: csvKeys.optional(),
  category: z.string().min(1).max(100).optional(),
  moduleCode: z.string().min(1).max(50).optional(),
  includeMetadata: boolQuery,
});

/**
 * PATCH /foundation/company-settings/:key — upsert override công ty. setting_value = unknown (khớp
 * value_type ép ở service). validation_schema (nếu setting có ở DB) cũng ép ở service. reason → audit.
 */
export const patchCompanySettingSchema = z.object({
  settingValue: z.unknown(),
  valueType: valueTypeEnum.optional(),
  category: z.string().min(1).max(100).optional(),
  moduleCode: z.string().min(1).max(50).optional(),
  description: z.string().max(2000).optional(),
  status: settingStatusEnum.optional(),
  reason: z.string().max(1000).optional(),
});

export type PublicQuery = z.infer<typeof publicQuerySchema>;
export type ResolveBody = z.infer<typeof resolveBodySchema>;
export type ResolveQuery = z.infer<typeof resolveQuerySchema>;
export type PatchCompanySettingInput = z.infer<typeof patchCompanySettingSchema>;

export class PublicQueryDto extends createZodDto(publicQuerySchema) {}
export class ResolveBodyDto extends createZodDto(resolveBodySchema) {}
export class PatchCompanySettingDto extends createZodDto(patchCompanySettingSchema) {}
