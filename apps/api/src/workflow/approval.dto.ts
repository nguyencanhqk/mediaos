import { createZodDto } from "nestjs-zod";
import { approveRequestSchema, requestRevisionSchema } from "@mediaos/contracts";

export class ApproveDto extends createZodDto(approveRequestSchema) {}
export class RequestRevisionDto extends createZodDto(requestRevisionSchema) {}
