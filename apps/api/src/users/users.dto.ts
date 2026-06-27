import {
  listUsersQuerySchema,
  suspendUserRequestSchema,
  updateProfileRequestSchema,
  updateUserRequestSchema,
} from "@mediaos/contracts";
import { createZodDto } from "nestjs-zod";

/** DTO suy ra TỪ contracts (Zod = nguồn sự thật) — validate input ở biên. */
export class UpdateProfileDto extends createZodDto(updateProfileRequestSchema) {}

// ─── Module 2b: Admin user CRUD (ACCT-2) ─────────────────────────────────────
export class ListUsersQueryDto extends createZodDto(listUsersQuerySchema) {}
export class UpdateUserDto extends createZodDto(updateUserRequestSchema) {}
export class SuspendUserDto extends createZodDto(suspendUserRequestSchema) {}
