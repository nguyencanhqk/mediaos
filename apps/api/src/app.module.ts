import { APP_GUARD } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ENV_FILE_PATHS, loadEnv } from "./config/env.schema";
import { AuthModule } from "./auth/auth.module";
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
  ],
  providers: [
    // Global guard pipeline: JWT auth → company context extraction → 2FA enforcement (G16-1b) →
    // G16-3 SaaS enforcement (feature-flag + usage-limit). Order matters: JwtAuthGuard attaches req.user;
    // CompanyGuard asserts companyId; TwoFactorEnforcementGuard DENIES when role requires 2FA but not enrolled;
    // FeatureFlag/UsageLimit guards no-op unless route declares @RequireFeature/@EnforceUsageLimit.
    // PermissionGuard is NOT registered globally here — add @RequirePermission per-route.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CompanyGuard },
    { provide: APP_GUARD, useClass: TwoFactorEnforcementGuard },
    { provide: APP_GUARD, useClass: FeatureFlagEnforcementGuard },
    { provide: APP_GUARD, useClass: UsageLimitEnforcementGuard },
  ],
})
export class AppModule {}
