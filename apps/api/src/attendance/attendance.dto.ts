import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import {
  attendanceListQuerySchema,
  attendanceRecordListQuerySchema,
  checkInSchema,
  checkOutSchema,
  createWorkScheduleSchema,
  listPaginationSchema,
  periodMonthSchema,
  updateWorkScheduleSchema,
} from "@mediaos/contracts";

export class CheckInDto extends createZodDto(checkInSchema) {}
export class CheckOutDto extends createZodDto(checkOutSchema) {}
export class CreateWorkScheduleDto extends createZodDto(createWorkScheduleSchema) {}
export class UpdateWorkScheduleDto extends createZodDto(updateWorkScheduleSchema) {}
// S3-ATT-BE-4: adjustment DTOs (create/list/approve/reject/direct) moved to attendance-adjustment.dto.ts.
export class AttendanceListQueryDto extends createZodDto(attendanceListQuerySchema) {}
/** S3-ATT-BE-2 — GET /attendance/{my-records,team-records,records} query (page-based + filter + sort). */
export class AttendanceRecordListQueryDto extends createZodDto(attendanceRecordListQuerySchema) {}
/** GET /attendance/periods — phân trang danh sách kỳ công. */
export class PeriodListQueryDto extends createZodDto(listPaginationSchema) {}

/** POST /attendance/periods/lock — khoá kỳ công theo tháng. */
export const lockPeriodSchema = z.object({ periodMonth: periodMonthSchema });
export class LockPeriodDto extends createZodDto(lockPeriodSchema) {}
