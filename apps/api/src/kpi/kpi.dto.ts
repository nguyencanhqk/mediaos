import { createZodDto } from "nestjs-zod";
import {
  computeKpiRequestSchema,
  confirmKpiResultSchema,
  createKpiDefinitionSchema,
  listKpiDefinitionQuerySchema,
} from "@mediaos/contracts";

/** DTO từ contracts Zod (nguồn sự thật). ZodValidationPipe parse/reject ở boundary. */
export class CreateKpiDefinitionDto extends createZodDto(createKpiDefinitionSchema) {}
export class ComputeKpiDto extends createZodDto(computeKpiRequestSchema) {}
export class ConfirmKpiResultDto extends createZodDto(confirmKpiResultSchema) {}
export class ListKpiDefinitionQueryDto extends createZodDto(listKpiDefinitionQuerySchema) {}
