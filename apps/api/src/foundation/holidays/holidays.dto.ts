import { createZodDto } from "nestjs-zod";
import {
  checkWorkingDayQuerySchema,
  createHolidaySchema,
  holidayListQuerySchema,
  updateHolidaySchema,
} from "@mediaos/contracts";

/**
 * FOUNDATION-BE-6 / S2-FND-CONTRACT-1 — Zod DTO cho HolidayService. Schema là NGUỒN SỰ THẬT ở
 * packages/contracts (foundation/holidays.ts) — file này CHỈ re-export schema/type + bọc `createZodDto`
 * (nestjs-zod là dep của api, KHÔNG của contracts). KHÔNG khai báo schema cục bộ để tránh drift (CLAUDE §4).
 */

export {
  holidayTypeEnum,
  createHolidaySchema,
  updateHolidaySchema,
  holidayListQuerySchema,
  checkWorkingDayQuerySchema,
} from "@mediaos/contracts";
export type {
  CreateHolidayInput,
  UpdateHolidayInput,
  HolidayListQuery,
  CheckWorkingDayQuery,
} from "@mediaos/contracts";

export class CreateHolidayDto extends createZodDto(createHolidaySchema) {}
export class UpdateHolidayDto extends createZodDto(updateHolidaySchema) {}
export class HolidayListQueryDto extends createZodDto(holidayListQuerySchema) {}
export class CheckWorkingDayQueryDto extends createZodDto(checkWorkingDayQuerySchema) {}
