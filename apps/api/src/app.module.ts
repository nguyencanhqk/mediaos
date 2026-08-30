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
import { TasksModule } from "./tasks/tasks.module";
import { AttendanceModule } from "./attendance/attendance.module";
import { LeaveModule } from "./leave/leave.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { PermissionModule } from "./permission/permission.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { FoundationModule } from "./foundation/foundation.module";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { MailConfigModule } from "./settings/mail-config.module";
import { SecurityPolicyModule } from "./security-policy/security-policy.module";
import { UserInvitesModule } from "./user-invites/user-invites.module";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { RecycleBinModule } from "./recycle-bin/recycle-bin.module";
import { MeModule } from "./me/me.module";
import { IntegrationsLmsModule } from "./integrations/lms/lms.module";
// S9-SOCIAL-BE-1 (additive): cầu SSO sang app vệ tinh fbpost (đăng bài Facebook Page) — DECISIONS-08.
import { IntegrationsSocialModule } from "./integrations/social/social.module";
// S5-GOAL-BE-1 (additive): GoalsModule — cây mục tiêu 3 cấp + /me/goals (SPEC-10 / DB-11).
import { GoalsModule } from "./goals/goals.module";
// S11-ASSET-BE-1 (additive): AssetsModule — quản lý tài sản (SPEC-13 / DB-15 / API-14).
import { AssetsModule } from "./assets/assets.module";
// S11-ROOM-BE-1 (additive): RoomsModule — phòng họp + đặt lịch (SPEC-14 / DB-16 / API-15).
import { RoomsModule } from "./rooms/rooms.module";
// S7-CHAT-BE-1 (additive): ChatModule — phòng chat & thành viên (SPEC-15 / DB-12 / API-13).
import { ChatModule } from "./chat/chat.module";
import { IdempotencyModule } from "./common/idempotency/idempotency.module";
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
    // WorkflowModule + ApprovalModule ĐÃ GỠ HẲN (S10-CLEAN-WORKFLOWPARK-1 gỡ bề mặt `/workflow`,
    // S10-CLEAN-WORKFLOWCLUSTER-2 gỡ nốt `/approval` + engine). Cả cụm là code PARK của hướng media
    // cũ: 0 hộ tiêu thụ FE/scripts/lms, và sau khi `workflow.service.ts` biến mất thì KHÔNG đường
    // code nào còn sinh ra `approval_requests` ⇒ inbox chỉ thao tác được trên hàng không ai tạo.
    // Bảng của cụm cũng đã DROP ở cùng WO. Thêm lại vào đây là dựng lại bề mặt đã cố ý gỡ.
    TasksModule,
    AttendanceModule,
    LeaveModule,
    NotificationsModule,
    RealtimeModule,
    DashboardModule,
    // S1-FND-WIRE-1 (BE-9): FoundationModule gom audit·settings·company·module-catalog·files·holidays →
    // /api/v1/foundation/*. AuditModule (FOUNDATION-BE-3) đã relocate vào đây (KHÔNG wire lẻ nữa).
    // S3-FND-SEEDRUN-1 (additive): FoundationModule nay gồm SeedModule → MasterDataSeedBootstrapService
    // (OnApplicationBootstrap) chạy reconcileAllCompanies() lúc boot (gated MASTER_DATA_SEED_ON_BOOT + NODE_ENV).
    FoundationModule,
    // AC-5 API key / PAT — out-of-scope (de-media-fy). Guard global đã GỠ ở CLEAN-DECOUPLE-1;
    // module giữ tạm tới CLEAN-BE-2 (gỡ hẳn cùng console FE). KHÔNG còn provider nào dùng ApiKeyRepository.
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
    // S5-ME-BE-1: MeModule (Personal Hub /api/v1/me) — lớp tổng hợp đọc-own (SPEC-09 / API-11). Compose
    // reader nguồn own-scope, re-check quyền nguồn per-section, fail-soft. KHÔNG sở hữu dữ liệu canonical.
    MeModule,
    // Giai đoạn A tích hợp LMS (fmc-app): cầu SSO — phát token HMAC 60s cho chính user đang đăng nhập.
    IntegrationsLmsModule,
    // S9-SOCIAL-BE-1: cầu SSO sang fbpost (app vệ tinh đăng bài Facebook Page). Cùng khuôn LMS, thêm
    // CỔNG CÔNG TY (SOCIAL_COMPANY_ID) vì fbpost chạy SQLite không có company_id — DECISIONS-08 §3.
    IntegrationsSocialModule,
    // S5-GOAL-BE-1 (additive): module GOAL (SPEC-10) — CRUD cây mục tiêu 3 cấp + GET /goals/tree +
    // GET /me/goals own-scope. Tái dùng ProjectAccessService của TasksModule cho goal cấp dự án.
    GoalsModule,
    // S5-BE-CONTRACT-1 (additive): thực thi `Idempotency-Key` cho mutation gắn @Idempotent()
    // (IMPLEMENTATION-08 §13.2). Module LÁ, tự cung cấp ValkeyService → không tạo vòng phụ thuộc.
    IdempotencyModule,
    // S7-CHAT-BE-1 (additive): module CHAT (SPEC-15) — phòng (danh sách/tạo nhóm/mở DM idempotent/chi
    // tiết/sửa/lưu trữ/rời) + thành viên. Ranh giới dữ liệu là THÀNH VIÊN PHÒNG (ChatAccessService),
    // KHÔNG phải data_scope. Đường đọc-vượt của Super Admin nằm ở WO RIÊNG S7-CHAT-BE-7.
    ChatModule,
    // S11-ASSET-BE-1 (additive): module ASSET (SPEC-13) — danh mục loại + hồ sơ tài sản + cấp phát/thu hồi +
    // bảo trì + kiểm kê + /me/assets. Data-scope Own/Department/Company + masking tài chính/danh tính ở service;
    // ngoài scope ⇒ 404. Registrar NOTI + job nhắc bảo trì sống ở NotificationsModule.
    AssetsModule,
    // S11-ROOM-BE-1 (additive): module ROOM (SPEC-14) — CRUD phòng họp (Office Admin) + đặt lịch chống trùng
    // (EXCLUDE là chốt cuối) + huỷ own/all theo data_scope + lịch/phòng trống/thống kê + /me/room-bookings.
    // Ngoài scope GHI ⇒ 403 (lịch công khai trong company), cross-tenant ⇒ 404. Registrar NOTI + job nhắc 15′
    // sống ở NotificationsModule.
    RoomsModule,
  ],
  providers: [
    // Global guard pipeline (THỨ TỰ QUAN TRỌNG):
    //   JwtAuthGuard — verify Bearer access token (đường JWT là đường auth DUY NHẤT).
    //   CompanyGuard — req.user.companyId đã có (từ JWT) → pass.
    //   TwoFactorEnforcementGuard — enforce 2FA-enrollment cho phiên người.
    //   PermissionGuard KHÔNG global — add @RequirePermission per-route.
    //
    // CLEAN-DECOUPLE-1 (de-media-fy): GỠ ApiKeyAuthGuard (đường PAT mok_ = out-of-scope, api-keys gỡ ở BE-2).
    //   Token không-JWT (kể cả mok_) rơi vào JwtAuthGuard → verify thất bại → 401 (fail-closed, không lọt).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CompanyGuard },
    { provide: APP_GUARD, useClass: TwoFactorEnforcementGuard },
  ],
})
export class AppModule {}
