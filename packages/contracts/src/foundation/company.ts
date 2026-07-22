import { z } from "zod";
import { brandingLogoRefSchema } from "./branding";

/**
 * S1-FND-WIRE-1 — Foundation Company response DTO (nguồn sự thật contracts cho GET/PATCH
 * /api/v1/foundation/company/current). Khớp CompanyView (apps/api foundation/company). Field read-only
 * id/slug/status + hồ sơ; KHÔNG có secret. BACKEND-04 §9.2.
 */
export const companyViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  shortName: z.string().nullable(),
  companyCode: z.string().nullable(),
  logoUrl: z.string().nullable(),
  timezone: z.string(),
  currency: z.string(),
  language: z.string(),
  taxCode: z.string().nullable(),
  businessType: z.string().nullable(),
  regNumber: z.string().nullable(),
  regDate: z.string().nullable(),
  regPlace: z.string().nullable(),
  legalRepName: z.string().nullable(),
  legalRepTitle: z.string().nullable(),
  establishedDate: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  fax: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
});

export type CompanyView = z.infer<typeof companyViewSchema>;

/**
 * S2-FND-CONTRACT-1 — Company PATCH allow-list (nguồn sự thật contracts cho PATCH
 * /api/v1/foundation/company/current). MIGRATE từ apps/api company.dto.ts (S1-FND-MODULE-1) GIỮ NGUYÊN
 * shape — apps/api import LẠI + bọc `createZodDto` cục bộ. APPEND vào file company.ts (đã có
 * companyViewSchema) — barrel foundation không đổi.
 *
 * PATCH chỉ nhận field hồ sơ EDITABLE (allow-list). Key lạ (id/slug/status/company_id/...) bị Zod STRIP
 * (object mặc định strip unknown) ⇒ body `company_id` lạ tự bị bỏ — tenant LẤY TỪ AuthContext, không từ
 * body (BẤT BIẾN #1). currency/language ép enum khớp CHECK DB (mig 0002: currency IN VND/USD, language IN
 * vi/en).
 */
export const companyCurrencyEnum = z.enum(["VND", "USD"]);
export const companyLanguageEnum = z.enum(["vi", "en"]);

/** YYYY-MM-DD cho cột `date` (drizzle date mode string). */
const patchIsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date phải dạng YYYY-MM-DD")
  .nullable();

/**
 * Field hồ sơ company được phép cập nhật (mig 0002 + 0360 CS-5). KHÔNG gồm: id/slug/status/schema_version/
 * working_days_json (BE-1) / payroll_config_json (PAYROLL) / created_at/updated_at/deleted_at / company_id.
 */
export const patchCompanySchema = z
  .object({
    name: z.string().min(1).max(255),
    shortName: z.string().max(255).nullable(),
    // S5-BRAND-BE-1: fileId (UUID) HOẶC http(s) URL — KHÔNG dùng `.url()` (zod v3 cho javascript:/data: qua).
    // Đường ghi ĐÚNG cho logo là /foundation/company/branding; nhánh này giữ cho round-trip GET→PATCH.
    logoUrl: brandingLogoRefSchema.nullable(),
    timezone: z.string().min(1).max(64),
    currency: companyCurrencyEnum,
    language: companyLanguageEnum,
    taxCode: z.string().max(50).nullable(),
    businessType: z.string().max(255).nullable(),
    regNumber: z.string().max(100).nullable(),
    regDate: patchIsoDate,
    regPlace: z.string().max(255).nullable(),
    legalRepName: z.string().max(255).nullable(),
    legalRepTitle: z.string().max(255).nullable(),
    establishedDate: patchIsoDate,
    address: z.string().max(1024).nullable(),
    phone: z.string().max(50).nullable(),
    fax: z.string().max(50).nullable(),
    email: z.string().email().max(255).nullable(),
    website: z.string().url().max(2048).nullable(),
  })
  .partial();

export type PatchCompanyInput = z.infer<typeof patchCompanySchema>;
