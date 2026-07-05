import { z } from "zod";

/**
 * S2-FND-CONTRACT-1 — Foundation Holidays DTO (nguồn sự thật contracts cho /api/v1/foundation/holidays*).
 * MIGRATE từ apps/api holidays.dto.ts (FOUNDATION-BE-6) GIỮ NGUYÊN shape — apps/api import LẠI + bọc
 * `createZodDto` cục bộ (nestjs-zod là dep của api, KHÔNG của contracts).
 *
 * Validate ở ranh giới HTTP (BẤT BIẾN: không trust input). PATCH mọi field optional (KHÔNG cho đổi
 * company_id — service không nhận, RLS+trigger 0436 chặn). KHÔNG field server-only/secret.
 */

const YYYY_MM_DD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải dạng YYYY-MM-DD");

/** holiday_type ∈ CHECK public_holidays (mig 0436). */
export const holidayTypeEnum = z.enum([
  "PublicHoliday",
  "CompanyHoliday",
  "WorkingDayOverride",
  "SpecialDay",
]);

/** Query boolean an toàn: 'true'/'false' (query string) hoặc boolean thật → KHÔNG dùng z.coerce.boolean
 * (coerce 'false' → true, footgun). */
const boolQuery = z
  .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
  .optional();

export const createHolidaySchema = z.object({
  holidayCode: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  holidayDate: YYYY_MM_DD,
  holidayType: holidayTypeEnum.optional(),
  countryCode: z.string().max(10).optional(),
  regionCode: z.string().max(50).optional(),
  isRecurring: z.boolean().optional(),
  affectsAttendance: z.boolean().optional(),
  affectsLeaveCalculation: z.boolean().optional(),
  isPaidHoliday: z.boolean().optional(),
  description: z.string().max(2000).optional(),
});

/** PATCH: mọi field optional (KHÔNG cho đổi company_id — service không nhận, RLS+trigger 0436 chặn). */
export const updateHolidaySchema = createHolidaySchema.partial();

export const holidayListQuerySchema = z.object({
  year: z.coerce.number().int().min(1970).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  countryCode: z.string().max(10).optional(),
  companyOnly: boolQuery,
});

export const checkWorkingDayQuerySchema = z.object({
  date: YYYY_MM_DD,
  countryCode: z.string().max(10).optional(),
});

export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;
export type HolidayListQuery = z.infer<typeof holidayListQuerySchema>;
export type CheckWorkingDayQuery = z.infer<typeof checkWorkingDayQuerySchema>;
