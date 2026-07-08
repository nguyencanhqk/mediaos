import { createZodDto } from "nestjs-zod";
import {
  applyPermissionRuleSchema,
  assignRolePermissionSchema,
  createRoleSchema,
  revokeRolePermissionSchema,
  updateRoleSchema,
} from "@mediaos/contracts";

/** S2-AUTH-BE-6 — body DTO cho POST/PATCH /auth/roles + assign/revoke permission cho role. */
export class CreateRoleDto extends createZodDto(createRoleSchema) {}
export class UpdateRoleDto extends createZodDto(updateRoleSchema) {}
export class AssignRolePermissionDto extends createZodDto(assignRolePermissionSchema) {}
export class RevokeRolePermissionDto extends createZodDto(revokeRolePermissionSchema) {}
/** S2-AUTH-PERMRULE-1 — body DTO cho POST /auth/roles/:id/permissions/apply-rule (rule builder). */
export class ApplyPermissionRuleDto extends createZodDto(applyPermissionRuleSchema) {}
