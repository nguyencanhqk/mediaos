import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * FOUNDATION-BE-6 — Zod DTO cho HolidayService. Định nghĩa CỤC BỘ ở module (BE-9 sẽ gom vào
 * packages/contracts khi hợp nhất Foundation contracts — KHÔNG sửa packages/contracts ở WO này để
 * tránh va hot-file). `createZodDto` nhận schema cục bộ (mẫu `lockPeriodSchema` ở attendance.dto).
 */

const YYYY_MM_DD = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải dạng YYYY-MM-DD");

const holidayTypeEnum = z.enum([
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

export class CreateHolidayDto extends createZodDto(createHolidaySchema) {}
export class UpdateHolidayDto extends createZodDto(updateHolidaySchema) {}
export class HolidayListQueryDto extends createZodDto(holidayListQuerySchema) {}
export class CheckWorkingDayQueryDto extends createZodDto(checkWorkingDayQuerySchema) {}
