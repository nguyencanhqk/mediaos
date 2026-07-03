import { Module, forwardRef } from "@nestjs/common";
import { CryptoModule } from "../crypto/crypto.module";
import { DatabaseModule } from "../db/db.module";
import { ModuleCatalogModule } from "../foundation/module-catalog/module-catalog.module";
import { PermissionModule } from "../permission/permission.module";
import { SecurityPolicyModule } from "../security-policy/security-policy.module";
import { AuthController } from "./auth.controller";
import { AuthLogsViewerController } from "./auth-logs-viewer.controller";
import { AuthLogsViewerService } from "./auth-logs-viewer.service";
import { LoginLogRepository } from "./login-log.repository";
import { SecurityEventRepository } from "./security-event.repository";
import { SecurityEventWriter } from "./security-event-writer.service";
import { AuthService } from "./auth.service";
import { LoginRateLimiter } from "./login-rate-limiter";
import { PasswordService } from "./password.service";
import { ReplayGuardService } from "./replay-guard.service";
import { ResetPasswordMailService } from "./reset-password-mail.service";
import { SecurityAlertService } from "./security-alert.service";
import { SessionCookieService } from "./session-cookie.service";
import { TokenService } from "./token.service";
import { TotpService } from "./totp.service";
import { TwoFactorService } from "./two-factor.service";
import { TwoFactorEnforcementGuard } from "./two-factor-enforcement.guard";

/**
 * AuthModule (G2-6) — login/refresh/me/forgot/reset + 2FA TOTP (G16-1) + 2FA defense-in-depth (G16-1b:
 * jti single-use / OTP step-replay / mustSetup enforcement / security alerting). Dựa EventsModule (audit +
 * outbox, @Global), DatabaseModule (withTenant), CryptoModule (envelope cho secret TOTP). forwardRef(
 * PermissionModule) vì PermissionModule cần TokenService từ đây (và export ValkeyService cho LoginRateLimiter
 * + ReplayGuardService). Export TwoFactorEnforcementGuard + TwoFactorService cho APP_GUARD toàn cục (app.module).
 */
@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => PermissionModule),
    CryptoModule,
    // CS-9: SecurityPolicyService cho enforce IP/giờ ở login/refresh + 2FA fail-stricter. forwardRef vì
    // SecurityPolicyModule → PermissionModule → forwardRef(AuthModule) (vòng gián tiếp).
    forwardRef(() => SecurityPolicyModule),
    // S2-AUTH-BE-1: /auth/me TÁI DÙNG ModuleCatalogService.getMyApps() cho `modules`. ModuleCatalogModule
    // KHÔNG import AuthModule (chỉ Permission/Settings/Database) → import thẳng, KHÔNG cần forwardRef.
    ModuleCatalogModule,
  ],
  // S2-AUTH-BE-5 (APPEND): AuthLogsViewerController = viewer READ-ONLY login_logs + user_security_events.
  controllers: [AuthController, AuthLogsViewerController],
  providers: [
    // S2-AUTH-BE-5 (APPEND): viewer service + 2 repo append-only (PermissionGuard từ PermissionModule).
    AuthLogsViewerService,
    LoginLogRepository,
    SecurityEventRepository,
    // S2-AUTH-BE-8 (APPEND): writer append-only user_security_events (dual-write cạnh audit) — dùng ở
    // AuthService + TwoFactorService; export cho lane users-lock/perm-role (mỗi module tự đăng ký provider).
    SecurityEventWriter,
    AuthService,
    PasswordService,
    TokenService,
    LoginRateLimiter,
    TotpService,
    TwoFactorService,
    ReplayGuardService,
    ResetPasswordMailService,
    SecurityAlertService,
    SessionCookieService,
    TwoFactorEnforcementGuard,
  ],
  exports: [
    AuthService,
    TokenService,
    PasswordService,
    LoginRateLimiter,
    TwoFactorService,
    ReplayGuardService,
    SecurityAlertService,
    SecurityEventWriter,
    TwoFactorEnforcementGuard,
  ],
})
export class AuthModule {}
