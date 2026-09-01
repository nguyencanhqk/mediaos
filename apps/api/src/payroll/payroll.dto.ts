import { createZodDto } from "nestjs-zod";
import {
  adjustPayrollLineSchema,
  approveBonusPenaltySchema,
  bonusPenaltyListQuerySchema,
  createBonusPenaltySchema,
  createPayrollPeriodSchema,
  createSalaryProfileSchema,
  mePayslipListQuerySchema,
  payrollAttendancePeriodPickerQuerySchema,
  payrollExportQuerySchema,
  payrollLineListQuerySchema,
  payrollPeoplePickerQuerySchema,
  payrollPeriodListQuerySchema,
  payslipListQuerySchema,
  rejectBonusPenaltySchema,
  rejectPayrollPeriodSchema,
  reopenPayrollPeriodSchema,
  salaryProfileListQuerySchema,
  updateBonusPenaltySchema,
  updatePayrollPeriodSchema,
  updateSalaryProfileSchema,
} from "@mediaos/contracts";

/**
 * S13-PAYROLL-BE-1 — DTO Nest sinh TỪ contracts (Zod là nguồn sự thật DTO, không khai lại hình dạng).
 *
 * ⚠️ Mọi `@Body()`/`@Query()` phải đi kèm `@UsePipes(ZodValidationPipe)` **cấp METHOD** ở controller —
 * `@UsePipes` cấp CLASS **không validate gì** (memory `nestjs-zod-class-level-pipe-does-nothing`), và
 * `body-validation-ratchet` đặt ngưỡng **0 offender**.
 */
export class ListPayrollPeriodsQueryDto extends createZodDto(payrollPeriodListQuerySchema) {}
export class CreatePayrollPeriodDto extends createZodDto(createPayrollPeriodSchema) {}
export class UpdatePayrollPeriodDto extends createZodDto(updatePayrollPeriodSchema) {}
export class AttendancePeriodPickerQueryDto extends createZodDto(
  payrollAttendancePeriodPickerQuerySchema,
) {}

export class ListSalaryProfilesQueryDto extends createZodDto(salaryProfileListQuerySchema) {}
export class CreateSalaryProfileDto extends createZodDto(createSalaryProfileSchema) {}
export class UpdateSalaryProfileDto extends createZodDto(updateSalaryProfileSchema) {}
export class PeoplePickerQueryDto extends createZodDto(payrollPeoplePickerQuerySchema) {}

export class ListBonusPenaltiesQueryDto extends createZodDto(bonusPenaltyListQuerySchema) {}
export class CreateBonusPenaltyDto extends createZodDto(createBonusPenaltySchema) {}
export class UpdateBonusPenaltyDto extends createZodDto(updateBonusPenaltySchema) {}
export class ApproveBonusPenaltyDto extends createZodDto(approveBonusPenaltySchema) {}
export class RejectBonusPenaltyDto extends createZodDto(rejectBonusPenaltySchema) {}

// ── S13-PAYROLL-BE-2 ────────────────────────────────────────────────────────────────────────────
export class AdjustPayrollLineDto extends createZodDto(adjustPayrollLineSchema) {}
export class RejectPayrollPeriodDto extends createZodDto(rejectPayrollPeriodSchema) {}
export class ReopenPayrollPeriodDto extends createZodDto(reopenPayrollPeriodSchema) {}
export class ListPayrollLinesQueryDto extends createZodDto(payrollLineListQuerySchema) {}
export class PayrollExportQueryDto extends createZodDto(payrollExportQuerySchema) {}
export class ListPayslipsQueryDto extends createZodDto(payslipListQuerySchema) {}
export class ListMePayslipsQueryDto extends createZodDto(mePayslipListQuerySchema) {}
