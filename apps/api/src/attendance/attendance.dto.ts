import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import {
  adjustmentListQuerySchema,
  attendanceListQuerySchema,
  checkInSchema,
  checkOutSchema,
  createAdjustmentRequestSchema,
  createWorkScheduleSchema,
  listPaginationSchema,
  periodMonthSchema,
  reviewNoteSchema,
  updateWorkScheduleSchema,
} from "@mediaos/contracts";

export class CheckInDto extends createZodDto(checkInSchema) {}
export class CheckOutDto extends createZodDto(checkOutSchema) {}
export class CreateWorkScheduleDto extends createZodDto(createWorkScheduleSchema) {}
export class UpdateWorkScheduleDto extends createZodDto(updateWorkScheduleSchema) {}
export class CreateAdjustmentDto extends createZodDto(createAdjustmentRequestSchema) {}
export class ReviewNoteDto extends createZodDto(reviewNoteSchema) {}
export class AttendanceListQueryDto extends createZodDto(attendanceListQuerySchema) {}
export class AdjustmentListQueryDto extends createZodDto(adjustmentListQuerySchema) {}
/** GET /attendance/periods — phân trang danh sách kỳ công. */
export class PeriodListQueryDto extends createZodDto(listPaginationSchema) {}

/** POST /attendance/periods/lock — khoá kỳ công theo tháng. */
export const lockPeriodSchema = z.object({ periodMonth: periodMonthSchema });
export class LockPeriodDto extends createZodDto(lockPeriodSchema) {}
