import { requestBreakGlassInputSchema } from "@mediaos/contracts";
import { createZodDto } from "nestjs-zod";

/**
 * Request DTOs for BreakGlassController — Zod contracts are the single source of truth.
 * approve/revoke take the grantId from the route path (:id) → no body DTO needed.
 */
export class RequestBreakGlassDto extends createZodDto(requestBreakGlassInputSchema) {}
