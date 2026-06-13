import { createZodDto } from "nestjs-zod";
import { approveLevelSchema, rejectLevelSchema } from "@mediaos/contracts";

export class ApproveLevelDto extends createZodDto(approveLevelSchema) {}
export class RejectLevelDto extends createZodDto(rejectLevelSchema) {}
