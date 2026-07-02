import { createZodDto } from "nestjs-zod";
import {
  approveRemoteWorkRequestSchema,
  createRemoteWorkRequestSchema,
  rejectRemoteWorkRequestSchema,
  remoteWorkRequestListQuerySchema,
  submitRemoteWorkRequestSchema,
} from "@mediaos/contracts";

/**
 * S3-ATT-BE-5 — Nest DTOs wrapping the contracts Zod schemas (nguồn sự thật DTO). ZodValidationPipe
 * validates at the boundary and strips server-authoritative keys (employeeId/status/submittedAt/
 * requestedBy/currentApproverUserId at create — chosen only at submit; approvedBy/rejectedBy/... never
 * accepted from the client at any step).
 */
export class CreateRemoteWorkRequestDto extends createZodDto(createRemoteWorkRequestSchema) {}
export class SubmitRemoteWorkRequestDto extends createZodDto(submitRemoteWorkRequestSchema) {}
export class RemoteWorkRequestListQueryDto extends createZodDto(remoteWorkRequestListQuerySchema) {}
export class ApproveRemoteWorkRequestDto extends createZodDto(approveRemoteWorkRequestSchema) {}
export class RejectRemoteWorkRequestDto extends createZodDto(rejectRemoteWorkRequestSchema) {}
