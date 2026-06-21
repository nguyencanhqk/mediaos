import { APP_GUARD } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ENV_FILE_PATHS, loadEnv } from "./config/env.schema";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { DatabaseModule } from "./db/db.module";
import { EventsModule } from "./events/events.module";
import { HealthModule } from "./health/health.module";
import { OrgModule } from "./org/org.module";
import { SettingsModule } from "./settings/settings.module";
import { PositionsModule } from "./positions/positions.module";
import { EmployeesModule } from "./employees/employees.module";
import { WorkflowModule } from "./workflow/workflow.module";
import { ApprovalModule } from "./approval/approval.module";
import { TasksModule } from "./tasks/tasks.module";
import { AttendanceModule } from "./attendance/attendance.module";
import { LeaveModule } from "./leave/leave.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ChatModule } from "./chat/chat.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { PermissionModule } from "./permission/permission.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { MailConfigModule } from "./settings/mail-config.module";
import { SecurityPolicyModule } from "./security-policy/security-policy.module";
import { UserInvitesModule } from "./user-invites/user-invites.module";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { RecycleBinModule } from "./recycle-bin/recycle-bin.module";
import { ApiKeyAuthGuard } from "./api-keys/guards/api-key-auth.guard";
import { ApiKeyRepository } from "./api-keys/api-keys.repository";
import { TokenService } from "./auth/token.service";
import { JwtAuthGuard } from "./permission/guards/jwt-auth.guard";
import { CompanyGuard } from "./permission/guards/company.guard";
import { TwoFactorEnforcementGuard } from "./auth/two-factor-enforcement.guard";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [...ENV_FILE_PATHS],
      validate: (config: Record<string, unknown>) => loadEnv(config as NodeJS.ProcessEnv),
    }),
    DatabaseModule,
    EventsModule,
    AuthModule,
    UsersModule,
    PermissionModule,
    HealthModule,
    OrgModule,
    SettingsModule,
    PositionsModule,
    EmployeesModule,
    WorkflowModule,
    ApprovalModule,
    TasksModule,
    AttendanceModule,
    LeaveModule,
    NotificationsModule,
    ChatModule,
    RealtimeModule,
    DashboardModule,
    // AC-5 API key / PAT (exports ApiKeyRepository cho ApiKeyAuthGuard global bên dưới)
    ApiKeysModule,
    // CS-8 Cấu hình mail server SMTP (per-company scope; SMTP password envelope-KMS, sensitive).
    MailConfigModule,
    // CS-9 Bảo mật nâng cao (per-company security policy — enforce IP/giờ/2FA/email-domain ở tầng auth)
    SecurityPolicyModule,
    // CS-10 Đối tượng: Mời / Duyệt / Kích hoạt user (invite token → accept → approve; email-domain at accept).
    UserInvitesModule,
    // WAVE 4 OPS: scheduler gọi processBatch() của OutboxWorker định kỳ (tắt khi NODE_ENV=test).
    SchedulerModule,
    // CS-6: Thùng rác / recycle bin + restore (soft-deleted employees).
    RecycleBinModule,
  ],
  providers: [
    // Global guard pipeline (THỨ TỰ QUAN TRỌNG):
    //   ApiKeyAuthGuard (AC-5) — chạy ĐẦU: nếu Bearer là PAT (mok_) → verify + set req.user{viaApiKey}.
    //     Token KHÔNG phải mok_ (JWT thường) / header vắng → PASS-THROUGH (KHÔNG nuốt JWT) cho JwtAuthGuard.
    //   JwtAuthGuard — nếu req.user đã set bởi ApiKeyAuthGuard (viaApiKey) → bỏ qua verify JWT; ngược lại
    //     verify Bearer access token như cũ (đường JWT y nguyên).
    //   CompanyGuard — req.user.companyId đã có (từ key hoặc JWT) → pass.
    //   TwoFactorEnforcementGuard — PAT (viaApiKey) bỏ qua 2FA-enrollment (không phải phiên người).
    //   PermissionGuard KHÔNG global — add @RequirePermission per-route.
    //
    // ApiKeyAuthGuard cần ApiKeyAuthLookup → bind ApiKeyRepository (export từ ApiKeysModule).
    {
      provide: APP_GUARD,
      useFactory: (tokens: TokenService, repo: ApiKeyRepository) =>
        new ApiKeyAuthGuard(tokens, repo),
      inject: [TokenService, ApiKeyRepository],
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CompanyGuard },
    { provide: APP_GUARD, useClass: TwoFactorEnforcementGuard },
  ],
})
export class AppModule {}
