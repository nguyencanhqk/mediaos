import { createZodDto } from "nestjs-zod";
import { createTemplateSchema, updateTemplateSchema } from "@mediaos/contracts";

export class CreateTemplateDto extends createZodDto(createTemplateSchema) {}
export class UpdateTemplateDto extends createZodDto(updateTemplateSchema) {}
