import { createZodDto } from "nestjs-zod";
import { applyWorkspaceTemplateSchema } from "@mediaos/contracts";

/** G16-3 — body DTO cho apply-template. */
export class ApplyTemplateDto extends createZodDto(applyWorkspaceTemplateSchema) {}
