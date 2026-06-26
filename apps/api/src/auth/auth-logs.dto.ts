import { createZodDto } from "nestjs-zod";
import { loginLogListQuerySchema, securityEventListQuerySchema } from "@mediaos/contracts";

/**
 * Query DTO cho 2 viewer READ-ONLY (S2-AUTH-BE-5). Nguồn schema = packages/contracts (auth.ts) — nguồn
 * sự thật DTO dùng CHUNG api ↔ web. ZodValidationPipe validate + coerce + áp default page/per_page +
 * refine from_date<=to_date + whitelist sort/order/status (sai dải → 400 VALIDATION-ERR field-level).
 */
export class LoginLogListQueryDto extends createZodDto(loginLogListQuerySchema) {}

export class SecurityEventListQueryDto extends createZodDto(securityEventListQuerySchema) {}
