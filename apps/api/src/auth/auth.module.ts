import { Module, forwardRef } from "@nestjs/common";
import { CryptoModule } from "../crypto/crypto.module";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LoginRateLimiter } from "./login-rate-limiter";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";
import { TotpService } from "./totp.service";
import { TwoFactorService } from "./two-factor.service";

/**
 * AuthModule (G2-6) — login/refresh/me/forgot/reset + 2FA TOTP (G16-1). Dựa EventsModule (audit + outbox,
 * @Global), DatabaseModule (withTenant), CryptoModule (envelope cho secret TOTP). forwardRef(PermissionModule)
 * vì PermissionModule cần TokenService từ đây (và export ValkeyService cho LoginRateLimiter).
 */
@Module({
  imports: [DatabaseModule, forwardRef(() => PermissionModule), CryptoModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, LoginRateLimiter, TotpService, TwoFactorService],
  exports: [AuthService, TokenService, PasswordService, LoginRateLimiter, TwoFactorService],
})
export class AuthModule {}
