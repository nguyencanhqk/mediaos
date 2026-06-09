import { createZodDto } from "nestjs-zod";
import { startWorkflowSchema, submitStepSchema } from "@mediaos/contracts";

export class StartWorkflowDto extends createZodDto(startWorkflowSchema) {}
export class SubmitStepDto extends createZodDto(submitStepSchema) {}
