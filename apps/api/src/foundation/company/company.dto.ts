import { createZodDto } from "nestjs-zod";
import { patchCompanySchema } from "@mediaos/contracts";

/**
 * S1-FND-MODULE-1 / S2-FND-CONTRACT-1 — Zod DTO cho CompanyService. patchCompanySchema (allow-list PATCH) là
 * NGUỒN SỰ THẬT ở packages/contracts (foundation/company.ts) — file này CHỈ re-export schema/type + bọc
 * `createZodDto` (nestjs-zod là dep của api). KHÔNG khai báo schema cục bộ để tránh drift (CLAUDE §4).
 *
 * PATCH chỉ nhận field hồ sơ EDITABLE (allow-list). Key lạ (id/slug/status/company_id/...) bị Zod STRIP ⇒
 * body `company_id` lạ tự bị bỏ — tenant LẤY TỪ AuthContext, không từ body (BẤT BIẾN #1).
 */

export { patchCompanySchema, companyCurrencyEnum, companyLanguageEnum } from "@mediaos/contracts";
export type { PatchCompanyInput } from "@mediaos/contracts";

export class PatchCompanyDto extends createZodDto(patchCompanySchema) {}

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
