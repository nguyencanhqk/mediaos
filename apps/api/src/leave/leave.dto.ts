import { createZodDto } from "nestjs-zod";
import {
  createLeaveRequestSchema,
  createLeaveTypeSchema,
  leaveCalendarQuerySchema,
  leaveListQuerySchema,
  reviewNoteSchema,
  updateLeaveTypeSchema,
  upsertLeaveBalanceSchema,
} from "@mediaos/contracts";

export class CreateLeaveTypeDto extends createZodDto(createLeaveTypeSchema) {}
export class UpdateLeaveTypeDto extends createZodDto(updateLeaveTypeSchema) {}
export class UpsertLeaveBalanceDto extends createZodDto(upsertLeaveBalanceSchema) {}
export class CreateLeaveRequestDto extends createZodDto(createLeaveRequestSchema) {}
export class LeaveListQueryDto extends createZodDto(leaveListQuerySchema) {}
export class LeaveCalendarQueryDto extends createZodDto(leaveCalendarQuerySchema) {}
export class ReviewNoteDto extends createZodDto(reviewNoteSchema) {}
