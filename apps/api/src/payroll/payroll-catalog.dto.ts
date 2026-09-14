import { createZodDto } from "nestjs-zod";
import {
  createPayrollTemplateSchema,
  createSalaryComponentSchema,
  createStatutoryRateSchema,
  payrollTemplateListQuerySchema,
  payrollTemplatePreviewSchema,
  putPayrollTemplateComponentsSchema,
  salaryComponentListQuerySchema,
  statutoryRateListQuerySchema,
  updatePayrollTemplateSchema,
  updateSalaryComponentSchema,
  updateStatutoryRateSchema,
  validateFormulaSchema,
} from "@mediaos/contracts";

/**
 * S15-PAYROLL-BE-2 — DTO Nest track B sinh TỪ contracts (`payroll-catalog.ts`). File RIÊNG thay vì nối vào
 * `payroll.dto.ts` để hot-file đó không phình và không đụng import của BE-1.
 *
 * ⚠️ Mọi `@Body()`/`@Query()` đi kèm `@UsePipes(ZodValidationPipe)` **cấp METHOD** ở controller — cấp class không
 * validate gì (`nestjs-zod-class-level-pipe-does-nothing`).
 */
export class ListSalaryComponentsQueryDto extends createZodDto(salaryComponentListQuerySchema) {}
export class CreateSalaryComponentDto extends createZodDto(createSalaryComponentSchema) {}
export class UpdateSalaryComponentDto extends createZodDto(updateSalaryComponentSchema) {}
export class ValidateFormulaDto extends createZodDto(validateFormulaSchema) {}
export class ListPayrollTemplatesQueryDto extends createZodDto(payrollTemplateListQuerySchema) {}
export class CreatePayrollTemplateDto extends createZodDto(createPayrollTemplateSchema) {}
export class UpdatePayrollTemplateDto extends createZodDto(updatePayrollTemplateSchema) {}
export class PutPayrollTemplateComponentsDto extends createZodDto(putPayrollTemplateComponentsSchema) {}
export class PreviewPayrollTemplateDto extends createZodDto(payrollTemplatePreviewSchema) {}
export class ListStatutoryRatesQueryDto extends createZodDto(statutoryRateListQuerySchema) {}
export class CreateStatutoryRateDto extends createZodDto(createStatutoryRateSchema) {}
export class UpdateStatutoryRateDto extends createZodDto(updateStatutoryRateSchema) {}
