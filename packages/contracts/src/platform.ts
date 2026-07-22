import { z } from "zod";

/**
 * G16-3 SaaS prep — PLATFORM tier DTOs (workspace/company management above company-admin).
 *
 * Tầng platform-admin quản vòng đời tenant CHÉO công ty. Mọi route nhạy cảm (cross-tenant) ⇒ server ép
 * quyền `*:platform-company` (is_sensitive) + audit. company status: active | suspended | provisioning.
 */

export const companyStatusEnum = z.enum(["active", "suspended", "provisioning"]);
export type CompanyStatus = z.infer<typeof companyStatusEnum>;

/** slug: lowercase, chữ-số-gạch ngang; ổn định, dùng làm tenant key khi login. */
const slugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug phải là lowercase chữ-số-gạch ngang");

/** DTO tóm tắt 1 công ty (workspace) — trả về cho platform-admin list/get. */
export const companySummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  timezone: z.string(),
  currency: z.string(),
  language: z.string(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type CompanySummaryDto = z.infer<typeof companySummarySchema>;

/** POST /admin/platform/companies — tạo workspace mới (+ provision template + gán plan). */
export const createCompanySchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
  timezone: z.string().min(1).max(64).optional(),
  currency: z.enum(["VND", "USD"]).optional(),
  language: z.enum(["vi", "en"]).optional(),
  /** Mã template provision (default 'starter'). null/absent = chỉ tạo công ty rỗng (no provision). */
  templateCode: z.string().min(1).max(64).nullable().optional(),
  /** Mã gói gán khi tạo (default 'free'). */
  planCode: z.string().min(1).max(64).nullable().optional(),
});
export type CreateCompanyRequest = z.infer<typeof createCompanySchema>;

/** PATCH /admin/platform/companies/:id — cấu hình công ty (platform-admin sửa CHÉO tenant). */
export const updateCompanySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    timezone: z.string().min(1).max(64).optional(),
    currency: z.enum(["VND", "USD"]).optional(),
    language: z.enum(["vi", "en"]).optional(),
    // S5-BRAND-BE-1: BỎ `.url()` — cùng cột `companies.logo_url` với branding endpoint (chứa fileId UUID).
    logoUrl: z.string().max(2048).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Cần ít nhất 1 trường để cập nhật" });
export type UpdateCompanyRequest = z.infer<typeof updateCompanySchema>;

/** GET /admin/platform/companies — filter/paginate. */
export const listCompaniesQuerySchema = z.object({
  status: companyStatusEnum.optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListCompaniesQuery = z.infer<typeof listCompaniesQuerySchema>;
