import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  refreshRequestSchema,
  resetPasswordRequestSchema,
  twoFactorDisableRequestSchema,
  twoFactorEnableRequestSchema,
  twoFactorVerifyRequestSchema,
} from "@mediaos/contracts";
import { createZodDto } from "nestjs-zod";

/** DTO suy ra TỪ contracts (Zod = nguồn sự thật) — validate input ở biên (coding-style). */
export class LoginDto extends createZodDto(loginRequestSchema) {}
export class RefreshDto extends createZodDto(refreshRequestSchema) {}
export class ForgotPasswordDto extends createZodDto(forgotPasswordRequestSchema) {}
export class ResetPasswordDto extends createZodDto(resetPasswordRequestSchema) {}
export class ChangePasswordDto extends createZodDto(changePasswordRequestSchema) {}
export class TwoFactorEnableDto extends createZodDto(twoFactorEnableRequestSchema) {}
export class TwoFactorVerifyDto extends createZodDto(twoFactorVerifyRequestSchema) {}
export class TwoFactorDisableDto extends createZodDto(twoFactorDisableRequestSchema) {}
