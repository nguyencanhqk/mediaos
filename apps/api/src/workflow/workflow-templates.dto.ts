import { createZodDto } from "nestjs-zod";
import {
  createTemplateSchema,
  createTemplateStepSchema,
  updateTemplateSchema,
  updateTemplateStepSchema,
} from "@mediaos/contracts";

export class CreateTemplateDto extends createZodDto(createTemplateSchema) {}
export class UpdateTemplateDto extends createZodDto(updateTemplateSchema) {}
export class CreateTemplateStepDto extends createZodDto(createTemplateStepSchema) {}
export class UpdateTemplateStepDto extends createZodDto(updateTemplateStepSchema) {}
