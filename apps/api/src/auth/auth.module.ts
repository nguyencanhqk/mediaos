import { Module, forwardRef } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LoginRateLimiter } from "./login-rate-limiter";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

/**
 * AuthModule (G2-6) — login/refresh/me/forgot/reset. Dựa EventsModule (audit + outbox, @Global) và
 * DatabaseModule (withTenant). forwardRef(PermissionModule) vì PermissionModule cần TokenService từ đây.
 */
@Module({
  imports: [DatabaseModule, forwardRef(() => PermissionModule)],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, LoginRateLimiter],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
