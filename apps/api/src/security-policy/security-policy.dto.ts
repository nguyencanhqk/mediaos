import { createZodDto } from "nestjs-zod";
import { updateSecurityPolicySchema } from "@mediaos/contracts";

/** PATCH /settings/security-policy body — validate qua updateSecurityPolicySchema (strict, partial). */
export class UpdateSecurityPolicyDto extends createZodDto(updateSecurityPolicySchema) {}
