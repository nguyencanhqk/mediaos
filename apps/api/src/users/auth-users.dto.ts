import {
  createAuthUserRequestSchema,
  listAuthUsersQuerySchema,
  lockAuthUserRequestSchema,
  updateAuthUserRequestSchema,
} from "@mediaos/contracts";
import { createZodDto } from "nestjs-zod";

/** S2-AUTH-BE-3 DTO suy ra TỪ contracts (Zod = nguồn sự thật) — validate input ở biên /auth/users. */
export class ListAuthUsersQueryDto extends createZodDto(listAuthUsersQuerySchema) {}
export class CreateAuthUserDto extends createZodDto(createAuthUserRequestSchema) {}
export class UpdateAuthUserDto extends createZodDto(updateAuthUserRequestSchema) {}
export class LockAuthUserDto extends createZodDto(lockAuthUserRequestSchema) {}
