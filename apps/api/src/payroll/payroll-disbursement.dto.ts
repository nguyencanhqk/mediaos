import { createZodDto } from "nestjs-zod";
import {
  approvePayrollAdvanceSchema,
  completePaymentBatchSchema,
  createPaymentBatchSchema,
  createPayrollAdvanceSchema,
  createPayrollBudgetSchema,
  mePayrollAdvanceListQuerySchema,
  paymentBatchListQuerySchema,
  paymentLineListQuerySchema,
  payrollAdvanceListQuerySchema,
  payrollBudgetListQuerySchema,
  rejectPayrollAdvanceSchema,
  updatePaymentBatchSchema,
  updatePayrollAdvanceSchema,
  updatePayrollBudgetSchema,
} from "@mediaos/contracts";

/**
 * S15-PAYROLL-BE-4 — DTO Nest track C sinh TỪ contracts (`payroll-disbursement.ts`). File RIÊNG (cùng luật
 * `payroll-catalog.dto.ts`) để hot-file `payroll.dto.ts` không phình.
 *
 * ⚠️ Mọi `@Body()`/`@Query()` đi kèm `@UsePipes(ZodValidationPipe)` **cấp METHOD** ở controller — cấp class không
 * validate gì (`nestjs-zod-class-level-pipe-does-nothing`). 076 dùng `@Query(new ZodValidationPipe(schema))` tại chỗ
 * (khuôn HR import — route multipart không có `@Body()`).
 */
export class ListPayrollAdvancesQueryDto extends createZodDto(payrollAdvanceListQuerySchema) {}
export class ListMePayrollAdvancesQueryDto extends createZodDto(mePayrollAdvanceListQuerySchema) {}
export class CreatePayrollAdvanceDto extends createZodDto(createPayrollAdvanceSchema) {}
export class UpdatePayrollAdvanceDto extends createZodDto(updatePayrollAdvanceSchema) {}
export class ApprovePayrollAdvanceDto extends createZodDto(approvePayrollAdvanceSchema) {}
export class RejectPayrollAdvanceDto extends createZodDto(rejectPayrollAdvanceSchema) {}

export class ListPaymentBatchesQueryDto extends createZodDto(paymentBatchListQuerySchema) {}
export class ListPaymentLinesQueryDto extends createZodDto(paymentLineListQuerySchema) {}
export class CreatePaymentBatchDto extends createZodDto(createPaymentBatchSchema) {}
export class UpdatePaymentBatchDto extends createZodDto(updatePaymentBatchSchema) {}
export class CompletePaymentBatchDto extends createZodDto(completePaymentBatchSchema) {}

export class ListPayrollBudgetsQueryDto extends createZodDto(payrollBudgetListQuerySchema) {}
export class CreatePayrollBudgetDto extends createZodDto(createPayrollBudgetSchema) {}
export class UpdatePayrollBudgetDto extends createZodDto(updatePayrollBudgetSchema) {}
