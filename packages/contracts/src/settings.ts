import { z } from "zod";

const workingDaysJsonSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)),
});

const payrollConfigJsonSchema = z.object({
  cutoffDay: z.number().int().min(1).max(31),
  payDay: z.number().int().min(1).max(31),
});

/** DTO Company Settings — G5-1 + CS-5 (hồ sơ đầy đủ, migration 0360). */
export const companySettingsSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  status: z.string(),
  logoUrl: z.string().url().nullable().optional(),
  timezone: z.string().min(1),
  currency: z.enum(["VND", "USD"]),
  language: z.enum(["vi", "en"]),
  workingDaysJson: workingDaysJsonSchema,
  payrollConfigJson: payrollConfigJsonSchema,
  schemaVersion: z.number().int(),
  // CS-5 profile fields (all nullable — additive)
  shortName: z.string().nullable().optional(),
  taxCode: z.string().nullable().optional(),
  businessType: z.string().nullable().optional(),
  companyCode: z.string().nullable().optional(),
  regNumber: z.string().nullable().optional(),
  regDate: z.string().nullable().optional(),
  regPlace: z.string().nullable().optional(),
  legalRepName: z.string().nullable().optional(),
  legalRepTitle: z.string().nullable().optional(),
  establishedDate: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  fax: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  website: z.string().url().nullable().optional(),
});
export type CompanySettingsDto = z.infer<typeof companySettingsSchema>;

/** Mã số thuế Việt Nam: 10 chữ số, hoặc 10+'-'+3 chữ số (chi nhánh). */
const taxCodeSchema = z
  .string()
  .regex(/^\d{10}(-\d{3})?$/, "Mã số thuế không hợp lệ (10 hoặc 10-3 chữ số)")
  .optional()
  .nullable();

/** ISO date string YYYY-MM-DD. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải theo định dạng YYYY-MM-DD")
  .optional()
  .nullable();

export const updateCompanySettingsSchema = z.object({
  // Thiết lập chung (G5-1, giữ nguyên)
  logoUrl: z.string().url().nullable().optional(),
  timezone: z.string().min(1).optional(),
  currency: z.enum(["VND", "USD"]).optional(),
  language: z.enum(["vi", "en"]).optional(),
  workingDaysJson: workingDaysJsonSchema.optional(),
  payrollConfigJson: payrollConfigJsonSchema.optional(),
  // CS-5 profile fields (all optional/nullable — additive)
  shortName: z.string().max(100).optional().nullable(),
  taxCode: taxCodeSchema,
  businessType: z.string().max(200).optional().nullable(),
  // companyCode is READ-ONLY — NOT included here (rejected at service layer)
  regNumber: z.string().max(50).optional().nullable(),
  regDate: isoDateSchema,
  regPlace: z.string().max(200).optional().nullable(),
  legalRepName: z.string().max(200).optional().nullable(),
  legalRepTitle: z.string().max(100).optional().nullable(),
  establishedDate: isoDateSchema,
  address: z.string().max(500).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  fax: z.string().max(20).optional().nullable(),
  email: z.string().email("Email không hợp lệ").optional().nullable(),
  website: z.string().url("Website phải là URL hợp lệ").optional().nullable(),
});
export type UpdateCompanySettingsRequest = z.infer<typeof updateCompanySettingsSchema>;
