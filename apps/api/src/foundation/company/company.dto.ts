import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * S1-FND-MODULE-1 — Zod DTO CỤC BỘ cho CompanyService (mẫu settings.dto/holidays.dto). KHÔNG sửa
 * packages/contracts ở WO này (envelope/contracts = S1-FND-WIRE-1). Validate ở ranh giới HTTP (BẤT BIẾN:
 * không trust input).
 *
 * PATCH chỉ nhận field hồ sơ EDITABLE (allow-list). Key lạ (id/slug/status/company_id/...) bị Zod STRIP
 * (object mặc định strip unknown) ⇒ body `company_id` lạ tự bị bỏ — tenant LẤY TỪ AuthContext, không từ body.
 * currency/language ép enum khớp CHECK DB (mig 0002: currency IN VND/USD, language IN vi/en).
 */

export const companyCurrencyEnum = z.enum(["VND", "USD"]);
export const companyLanguageEnum = z.enum(["vi", "en"]);

/** YYYY-MM-DD cho cột `date` (drizzle date mode string). */
const isoDate = z
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
    logoUrl: z.string().url().max(2048).nullable(),
    timezone: z.string().min(1).max(64),
    currency: companyCurrencyEnum,
    language: companyLanguageEnum,
    taxCode: z.string().max(50).nullable(),
    businessType: z.string().max(255).nullable(),
    regNumber: z.string().max(100).nullable(),
    regDate: isoDate,
    regPlace: z.string().max(255).nullable(),
    legalRepName: z.string().max(255).nullable(),
    legalRepTitle: z.string().max(255).nullable(),
    establishedDate: isoDate,
    address: z.string().max(1024).nullable(),
    phone: z.string().max(50).nullable(),
    fax: z.string().max(50).nullable(),
    email: z.string().email().max(255).nullable(),
    website: z.string().url().max(2048).nullable(),
  })
  .partial();

export class PatchCompanyDto extends createZodDto(patchCompanySchema) {}
export type PatchCompanyInput = z.infer<typeof patchCompanySchema>;

/** Field hiển thị cho GET/response (read-only id/slug/status + hồ sơ). KHÔNG lộ secret (company không có). */
export interface CompanyView {
  id: string;
  name: string;
  slug: string;
  status: string;
  shortName: string | null;
  companyCode: string | null;
  logoUrl: string | null;
  timezone: string;
  currency: string;
  language: string;
  taxCode: string | null;
  businessType: string | null;
  regNumber: string | null;
  regDate: string | null;
  regPlace: string | null;
  legalRepName: string | null;
  legalRepTitle: string | null;
  establishedDate: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
  website: string | null;
}
