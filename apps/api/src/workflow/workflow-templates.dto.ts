import { createZodDto } from "nestjs-zod";
import {
  applyTemplateSchema,
  createChecklistItemSchema,
  createChecklistSchema,
  createDependencySchema,
  createTemplateSchema,
  createTemplateStepSchema,
  updateTemplateSchema,
  updateTemplateStepSchema,
} from "@mediaos/contracts";

export class CreateTemplateDto extends createZodDto(createTemplateSchema) {}
export class UpdateTemplateDto extends createZodDto(updateTemplateSchema) {}
export class CreateTemplateStepDto extends createZodDto(createTemplateStepSchema) {}
export class UpdateTemplateStepDto extends createZodDto(updateTemplateStepSchema) {}
export class CreateDependencyDto extends createZodDto(createDependencySchema) {}

// Body DTO bỏ field lấy từ URL (workflowDefinitionStepId ← :stepId, checklistId ← :checklistId).
const createChecklistBodySchema = createChecklistSchema.omit({ workflowDefinitionStepId: true });
const createChecklistItemBodySchema = createChecklistItemSchema.omit({ checklistId: true });
export class CreateChecklistDto extends createZodDto(createChecklistBodySchema) {}
export class CreateChecklistItemDto extends createZodDto(createChecklistItemBodySchema) {}
export class ApplyTemplateDto extends createZodDto(applyTemplateSchema) {}
