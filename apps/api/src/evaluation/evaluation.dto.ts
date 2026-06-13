import { createZodDto } from "nestjs-zod";
import {
  createEvaluationTemplateSchema,
  listEvaluationTemplateQuerySchema,
  recordScoresSchema,
  updateCriteriaSchema,
} from "@mediaos/contracts";

/** DTO từ contracts Zod (nguồn sự thật). ZodValidationPipe parse/reject ở boundary. */
export class CreateEvaluationTemplateDto extends createZodDto(createEvaluationTemplateSchema) {}
export class UpdateCriteriaDto extends createZodDto(updateCriteriaSchema) {}
export class RecordScoresDto extends createZodDto(recordScoresSchema) {}
export class ListEvaluationTemplateQueryDto extends createZodDto(
  listEvaluationTemplateQuerySchema,
) {}
