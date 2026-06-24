import { createZodDto } from "nestjs-zod";
import { auditLogQuerySchema } from "@mediaos/contracts";

/**
 * Query DTO cho audit list (Company + System). Nguồn schema = `packages/contracts` (observability.ts) —
 * BE-3 sở hữu DTO audit (D6). ZodValidationPipe validate + áp default limit/offset + refine dateFrom<=dateTo.
 */
export class AuditLogQueryDto extends createZodDto(auditLogQuerySchema) {}
