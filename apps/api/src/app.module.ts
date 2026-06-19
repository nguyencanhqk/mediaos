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
import { MediaModule } from "./media/media.module";
import { WorkflowModule } from "./workflow/workflow.module";
import { ApprovalModule } from "./approval/approval.module";
import { TasksModule } from "./tasks/tasks.module";
import { AttendanceModule } from "./attendance/attendance.module";
import { LeaveModule } from "./leave/leave.module";
import { PayrollModule } from "./payroll/payroll.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ChatModule } from "./chat/chat.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { FinanceModule } from "./finance/finance.module";
import { PermissionModule } from "./permission/permission.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { EvaluationModule } from "./evaluation/evaluation.module";
import { KpiModule } from "./kpi/kpi.module";
import { DefectModule } from "./defect/defect.module";
import { MeetingModule } from "./meeting/meeting.module";
import { BreakGlassModule } from "./break-glass/break-glass.module";
import { SaasModule } from "./saas/saas.module";
import { TemplatesModule } from "./templates/templates.module";
import { PlatformModule } from "./platform/platform.module";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { ObservabilityModule } from "./observability/observability.module";
import { DbOpsModule } from "./db-ops/db-ops.module";
import { UsageModule } from "./usage/usage.module";
import { MailConfigModule } from "./settings/mail-config.module";
import { SecurityPolicyModule } from "./security-policy/security-policy.module";
import { UserInvitesModule } from "./user-invites/user-invites.module";
import { OperatorBootstrapModule } from "./operator-bootstrap/operator-bootstrap.module";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { RecycleBinModule } from "./recycle-bin/recycle-bin.module";
import { ApiKeyAuthGuard } from "./api-keys/guards/api-key-auth.guard";
import { ApiKeyRepository } from "./api-keys/api-keys.repository";
import { TokenService } from "./auth/token.service";
import { JwtAuthGuard } from "./permission/guards/jwt-auth.guard";
import { CompanyGuard } from "./permission/guards/company.guard";
import { TwoFactorEnforcementGuard } from "./auth/two-factor-enforcement.guard";
import {
  FeatureFlagEnforcementGuard,
  UsageLimitEnforcementGuard,
} from "./saas/enforcement.guards";

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
    MediaModule,
    WorkflowModule,
    ApprovalModule,
    TasksModule,
    AttendanceModule,
    LeaveModule,
    PayrollModule,
    NotificationsModule,
    ChatModule,
    RealtimeModule,
    FinanceModule,
    DashboardModule,
    EvaluationModule,
    KpiModule,
    DefectModule,
    MeetingModule,
    BreakGlassModule,
    // G16-3 SaaS prep
    SaasModule,
    TemplatesModule,
    PlatformModule,
    // AC-5 API key / PAT (exports ApiKeyRepository cho ApiKeyAuthGuard global bên dưới)
    ApiKeysModule,
    // AC-6 Webhooks (tenant self-service — endpoint CRUD + subscribe + delivery log; HMAC secret envelope-KMS)
    WebhooksModule,
    // AC-8 Observability (audit viewer tenant-self + operator cross-tenant + queue monitor — read-only)
    ObservabilityModule,
    // AC-9 db-ops (operator data browser tenant-scoped + migration status + break-glass SoD + export scaffold)
    DbOpsModule,
    // CS-7 Tình hình sử dụng (usage stats per tenant — login count, per-user last-login, task counters)
    UsageModule,
    // CS-8 Cấu hình mail server SMTP (per-tenant + per-app scope; SMTP password envelope-KMS, sensitive).
    MailConfigModule,
    // CS-9 Bảo mật nâng cao (per-company security policy — enforce IP/giờ/2FA/email-domain ở tầng auth)
    SecurityPolicyModule,
    // CS-10 Đối tượng: Mời / Duyệt / Kích hoạt user (invite token → accept → approve; email-domain at accept).
    UserInvitesModule,
    // Operator bootstrap (seed-lúc-khởi-động): tạo/đồng bộ tài khoản platform-admin god-mode từ env.
    OperatorBootstrapModule,
    // WAVE 4 OPS: scheduler gọi processBatch() của OutboxWorker + DbExportWorker định kỳ (tắt khi NODE_ENV=test).
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
    //   TwoFactorEnforcementGuard — PAT (viaApiKey) bỏ qua 2FA-enrollment (không phải phiên người;
    //     bảo mật PAT nằm ở scope∩grant + revoke). FeatureFlag/UsageLimit no-op trừ khi route declare.
    //   PermissionGuard KHÔNG global — add @RequirePermission per-route (mở rộng AC-5: viaApiKey ⇒ scope∩grant).
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
    { provide: APP_GUARD, useClass: FeatureFlagEnforcementGuard },
    { provide: APP_GUARD, useClass: UsageLimitEnforcementGuard },
  ],
})
export class AppModule {}
