import { z } from "zod";

const workingDaysJsonSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)),
});

const payrollConfigJsonSchema = z.object({
  cutoffDay: z.number().int().min(1).max(31),
  payDay: z.number().int().min(1).max(31),
});

/** DTO Company Settings — G5-1. */
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
});
export type CompanySettingsDto = z.infer<typeof companySettingsSchema>;

export const updateCompanySettingsSchema = z.object({
  logoUrl: z.string().url().nullable().optional(),
  timezone: z.string().min(1).optional(),
  currency: z.enum(["VND", "USD"]).optional(),
  language: z.enum(["vi", "en"]).optional(),
  workingDaysJson: workingDaysJsonSchema.optional(),
  payrollConfigJson: payrollConfigJsonSchema.optional(),
});
export type UpdateCompanySettingsRequest = z.infer<typeof updateCompanySettingsSchema>;
