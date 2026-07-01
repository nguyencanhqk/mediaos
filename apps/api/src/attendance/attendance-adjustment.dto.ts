import { createZodDto } from "nestjs-zod";
import {
  adjustmentListQuerySchema,
  approveAdjustmentSchema,
  createAdjustmentRequestSchema,
  directAdjustSchema,
  rejectAdjustmentSchema,
} from "@mediaos/contracts";

/**
 * S3-ATT-BE-4 — Nest DTOs for the canonical adjustment surface. Each wraps a contracts Zod schema
 * (nguồn sự thật DTO); ZodValidationPipe validates at the boundary and strips server-authoritative keys
 * (employee_id/status/submitted_at/is_applied/applied_value are never accepted from the client).
 */
export class CreateAdjustmentRequestDto extends createZodDto(createAdjustmentRequestSchema) {}
export class AdjustmentListQueryDto extends createZodDto(adjustmentListQuerySchema) {}
export class ApproveAdjustmentDto extends createZodDto(approveAdjustmentSchema) {}
export class RejectAdjustmentDto extends createZodDto(rejectAdjustmentSchema) {}
export class DirectAdjustDto extends createZodDto(directAdjustSchema) {}
