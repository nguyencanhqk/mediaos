import { createZodDto } from "nestjs-zod";
import { assignStepSchema, startWorkflowSchema, submitStepSchema } from "@mediaos/contracts";

export class StartWorkflowDto extends createZodDto(startWorkflowSchema) {}
export class SubmitStepDto extends createZodDto(submitStepSchema) {}
export class AssignStepDto extends createZodDto(assignStepSchema) {}
