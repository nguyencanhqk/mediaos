import { Module } from "@nestjs/common";
import { AttendanceModule } from "../attendance/attendance.module";
import { DatabaseModule } from "../db/db.module";
import { AuditRepository } from "../foundation/audit/audit.repository";
import { HolidaysModule } from "../foundation/holidays/holidays.module";
import { SeedModule } from "../foundation/seed/seed.module";
import { PermissionModule } from "../permission/permission.module";
import { HrTasksService } from "../tasks/hr-tasks.service";
import { LeaveController } from "./leave.controller";
import { LeaveAdminRepository } from "./leave-admin.repository";
import { LeaveAdminService } from "./leave-admin.service";
import { LeaveApprovalRepository } from "./leave-approval.repository";
import { LeaveApprovalService } from "./leave-approval.service";
// S3-LEAVE-BE-6 (additive): GET /leave/reports (scoped aggregate) + LEAVE's own audit reader
// (GET /leave/audit-logs, TÁI DÙNG AuditRepository — provided locally below since it has no DI deps of
// its own; foundation AuditModule itself is NOT imported here — KHÔNG tái dùng route/guard).
import { LeaveAuditController } from "./leave-audit.controller";
import { LeaveAuditService } from "./leave-audit.service";
import { LeaveReportController } from "./leave-report.controller";
import { LeaveReportRepository } from "./leave-report.repository";
import { LeaveReportService } from "./leave-report.service";
import { LeaveCalendarRepository } from "./leave-calendar.repository";
import { LeaveCalendarService } from "./leave-calendar.service";
import { LeaveMasterDataSeeder } from "./leave-master-data.seeder";
import { LeaveReadRepository } from "./leave-read.repository";
import { LeaveReadService } from "./leave-read.service";
import { LeaveRepository } from "./leave.repository";
import { LeaveRequestRepository } from "./leave-request.repository";
import { LeaveRequestService } from "./leave-request.service";
// S3-INT-1 (additive): CANCEL(Approved)/REVOKE — needs AttendanceLeaveSyncService (AttendanceModule export).
import { LeaveRevokeService } from "./leave-revoke.service";
import { LeaveSeedRegistrar } from "./leave-seed.registrar";
import { LeaveService } from "./leave.service";

/**
 * G11-2 — Leave. AuditService/OutboxService come from the @Global EventsModule; PermissionModule
 * exports PermissionService + the guard stack. HrTasksService (Task Hub bridge) is provided locally —
 * it is stateless and shared with AttendanceModule, avoiding a cross-edit of the shared TasksModule.
 *
 * S3-LEAVE-SEED-1 (additive): import SeedModule (exports MasterDataSeederRegistry) → LeaveSeedRegistrar
 * (OnModuleInit) registers LeaveMasterDataSeeder so the runtime per-company runner seeds 4 default leave
 * types (ANNUAL/SICK/UNPAID/OTHER) + the DEFAULT_ANNUAL policy. Inversion of dependency: SeedModule/
 * foundation KHÔNG import LEAVE.
 */
@Module({
  // S3-LEAVE-BE-1: + HolidaysModule (self-contained, exports HolidaysService) → leave-specific holiday
  // exclusion in calculate preview. + LeaveReadService/LeaveReadRepository (read/preview surface).
  // S3-INT-1: + AttendanceModule (exports AttendanceLeaveSyncService — no cycle: AttendanceModule loads
  // BEFORE LeaveModule in app.module.ts and never imports LeaveModule).
  imports: [DatabaseModule, PermissionModule, SeedModule, HolidaysModule, AttendanceModule],
  controllers: [LeaveController, LeaveReportController, LeaveAuditController],
  providers: [
    LeaveService,
    LeaveRepository,
    LeaveReadService,
    LeaveReadRepository,
    // S3-LEAVE-BE-2 — request workflow (draft/submit/cancel) service + repo.
    LeaveRequestService,
    LeaveRequestRepository,
    // S3-LEAVE-BE-3 (additive) — approval workflow (approve/reject/management-list). DataScopeService is
    // injected from PermissionModule (exported, line 137) — reuses the S2-INT-2 Team/Company resolver.
    LeaveApprovalService,
    LeaveApprovalRepository,
    // S3-LEAVE-BE-5 (additive) — GET /leave/calendar (own/team/company data-scope). DataScopeService already
    // exported by PermissionModule (reused by LeaveApprovalService above).
    LeaveCalendarService,
    LeaveCalendarRepository,
    // S3-LEAVE-BE-4 (additive) — admin surface (type/policy CRUD + balance view/adjust ledger). DataScopeService
    // already exported by PermissionModule (reused by LeaveApprovalService/LeaveCalendarService above).
    LeaveAdminService,
    LeaveAdminRepository,
    // S3-INT-1 (additive) — CANCEL(Approved)/REVOKE (ATT-revert + balance refund, idempotent). Reuses
    // LeaveRepository/LeaveRequestRepository/LeaveApprovalRepository (already provided above).
    LeaveRevokeService,
    HrTasksService,
    LeaveMasterDataSeeder,
    LeaveSeedRegistrar,
    // S3-LEAVE-BE-6 (additive): LeaveReportService injects DataScopeService (PermissionModule) +
    // DatabaseService (@Global) + LeaveReportRepository. LeaveAuditService REUSES AuditRepository (no DI
    // deps of its own — provided locally, KHÔNG import AuditModule/its route) + AuditMaskerService
    // (EventsModule export, @Global).
    LeaveReportService,
    LeaveReportRepository,
    LeaveAuditService,
    AuditRepository,
  ],
  exports: [LeaveService],
})
export class LeaveModule {}
