import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  refreshRequestSchema,
  resetPasswordRequestSchema,
} from "@mediaos/contracts";
import { createZodDto } from "nestjs-zod";

/** DTO suy ra TỪ contracts (Zod = nguồn sự thật) — validate input ở biên (coding-style). */
export class LoginDto extends createZodDto(loginRequestSchema) {}
export class RefreshDto extends createZodDto(refreshRequestSchema) {}
export class ForgotPasswordDto extends createZodDto(forgotPasswordRequestSchema) {}
export class ResetPasswordDto extends createZodDto(resetPasswordRequestSchema) {}
