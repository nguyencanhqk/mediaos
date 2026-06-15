import { createZodDto } from "nestjs-zod";
import {
  assignRoleSchema,
  removeObjectPermissionSchema,
  setObjectPermissionSchema,
} from "@mediaos/contracts";

/** G3 mutation-path — body DTO cho endpoint quản lý phân quyền runtime. */
export class AssignRoleDto extends createZodDto(assignRoleSchema) {}
export class SetObjectPermissionDto extends createZodDto(setObjectPermissionSchema) {}
export class RemoveObjectPermissionDto extends createZodDto(removeObjectPermissionSchema) {}
