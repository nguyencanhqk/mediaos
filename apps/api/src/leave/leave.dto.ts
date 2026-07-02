import { createZodDto } from "nestjs-zod";
import {
  adjustLeaveBalanceSchema,
  approveLeaveRequestSchema,
  cancelLeaveRequestSchema,
  createLeavePolicySchema,
  createLeaveRequestDraftSchema,
  createLeaveRequestSchema,
  createLeaveTypeAdminSchema,
  createLeaveTypeSchema,
  leaveBalanceAdminListQuerySchema,
  leaveCalculateRequestSchema,
  leaveCalendarQuerySchema,
  leaveListQuerySchema,
  leavePolicyListQuerySchema,
  leaveRequestListQuerySchema,
  pendingLeaveRequestListQuerySchema,
  rejectLeaveRequestSchema,
  reviewNoteSchema,
  submitLeaveRequestSchema,
  updateLeavePolicySchema,
  updateLeaveRequestDraftSchema,
  updateLeaveTypeAdminSchema,
  updateLeaveTypeSchema,
  upsertLeaveBalanceSchema,
} from "@mediaos/contracts";

export class CreateLeaveTypeDto extends createZodDto(createLeaveTypeSchema) {}
export class UpdateLeaveTypeDto extends createZodDto(updateLeaveTypeSchema) {}
export class UpsertLeaveBalanceDto extends createZodDto(upsertLeaveBalanceSchema) {}
export class CreateLeaveRequestDto extends createZodDto(createLeaveRequestSchema) {}
export class LeaveListQueryDto extends createZodDto(leaveListQuerySchema) {}
// S3-LEAVE-BE-5: scope=own|team|company + [from,to] (replaces the old unscoped month-only query).
export class LeaveCalendarQueryDto extends createZodDto(leaveCalendarQuerySchema) {}
export class ReviewNoteDto extends createZodDto(reviewNoteSchema) {}
// S3-LEAVE-BE-1: preview body (server-authoritative — client employee_id/calculated_* stripped by Zod).
export class LeaveCalculateDto extends createZodDto(leaveCalculateRequestSchema) {}
// S3-LEAVE-BE-2: request workflow (draft/submit/cancel). Server-authoritative — client employee_id/user_id/
// company_id/status/total_* stripped by Zod (object strip).
export class CreateLeaveRequestDraftDto extends createZodDto(createLeaveRequestDraftSchema) {}
export class UpdateLeaveRequestDraftDto extends createZodDto(updateLeaveRequestDraftSchema) {}
export class SubmitLeaveRequestDto extends createZodDto(submitLeaveRequestSchema) {}
export class CancelLeaveRequestDto extends createZodDto(cancelLeaveRequestSchema) {}
export class LeaveRequestListQueryDto extends createZodDto(leaveRequestListQuerySchema) {}
// S3-LEAVE-BE-3: approval workflow (approve/reject/management-list). Server-authoritative — client
// status/approvedBy/companyId stripped by Zod. reject reason REQUIRED (min 1); approve note optional.
export class ApproveLeaveRequestDto extends createZodDto(approveLeaveRequestSchema) {}
export class RejectLeaveRequestDto extends createZodDto(rejectLeaveRequestSchema) {}
export class PendingLeaveRequestListQueryDto extends createZodDto(
  pendingLeaveRequestListQuerySchema,
) {}

// S3-LEAVE-BE-4: admin surface (type/policy CRUD + balance view/adjust ledger). Server-authoritative —
// client status/companyId/created_by/etc. stripped by Zod (object strip).
export class CreateLeaveTypeAdminDto extends createZodDto(createLeaveTypeAdminSchema) {}
export class UpdateLeaveTypeAdminDto extends createZodDto(updateLeaveTypeAdminSchema) {}
export class CreateLeavePolicyDto extends createZodDto(createLeavePolicySchema) {}
export class UpdateLeavePolicyDto extends createZodDto(updateLeavePolicySchema) {}
export class LeavePolicyListQueryDto extends createZodDto(leavePolicyListQuerySchema) {}
export class LeaveBalanceAdminListQueryDto extends createZodDto(leaveBalanceAdminListQuerySchema) {}
export class AdjustLeaveBalanceDto extends createZodDto(adjustLeaveBalanceSchema) {}
