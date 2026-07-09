import { Injectable, Logger, Module, OnModuleInit } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { EventBus, type EventContext } from "../events/event-bus";
import { AuditRepository } from "../foundation/audit/audit.repository";
import { SeedModule } from "../foundation/seed/seed.module";
import { PermissionModule } from "../permission/permission.module";
import { HrTasksService } from "../tasks/hr-tasks.service";
import { AttMasterDataSeeder } from "./att-master-data.seeder";
import { AttSeedRegistrar } from "./att-seed.registrar";
import { AttendanceController } from "./attendance.controller";
import { AttendanceAdjustmentController } from "./attendance-adjustment.controller";
import { AttendanceInternalController } from "./attendance-internal.controller";
import { AttendanceReadRepository } from "./attendance-read.repository";
import { AttendanceReadService } from "./attendance-read.service";
// S3-ATT-EXPORT-1 (additive): CSV export of scoped records (GET /attendance/records/export).
import { AttendanceExportService } from "./attendance-export.service";
import { AttendanceAdjustmentRepository } from "./attendance-adjustment.repository";
import { AttendanceAdjustmentService } from "./attendance-adjustment.service";
import { AttendanceRepository } from "./attendance.repository";
import { AttendanceService } from "./attendance.service";
// S3-ATT-BE-3 (additive): shift/rule/assignment CRUD (minimum) + GET /attendance/rules/effective.
import { AttendanceShiftController } from "./attendance-shift.controller";
import { AttendanceShiftRepository } from "./attendance-shift.repository";
import { AttendanceShiftService } from "./attendance-shift.service";
// S3-INT-1 (additive): LEAVE→ATT sync (onLeaveApproved consumer + revert for LeaveModule to call inline).
import { AttendanceLeaveSyncRepository } from "./attendance-leave-sync.repository";
import { AttendanceLeaveSyncService } from "./attendance-leave-sync.service";
// S3-ATT-BE-5 (additive): remote/onsite-work request workflow (Draft→Pending→Approved/Rejected/Cancelled).
import { RemoteWorkRequestController } from "./remote-work-request.controller";
import { RemoteWorkRequestRepository } from "./remote-work-request.repository";
import { RemoteWorkRequestService } from "./remote-work-request.service";
// S3-ATT-BE-6 (additive): scoped attendance report aggregate (GET /attendance/reports) + ATT's own
// audit-log reader (GET /attendance/audit-logs, TÁI DÙNG AuditRepository — provided locally below since
// it has no DI deps of its own; AuditModule itself is NOT imported here — KHÔNG tái dùng route/guard).
import { AttendanceReportController } from "./attendance-report.controller";
import { AttendanceReportRepository } from "./attendance-report.repository";
import { AttendanceReportService } from "./attendance-report.service";
import { AttendanceAuditController } from "./attendance-audit.controller";
import { AttendanceAuditService } from "./attendance-audit.service";

/**
 * S3-INT-1 — binds AttendanceLeaveSyncService.onLeaveApproved as an EventBus consumer of
 * `leave.request.approved` (emitted in-tx by LeaveApprovalService.approve, S3-LEAVE-BE-3). Mirrors
 * PermissionCacheInvalidator (permission.module.ts): OnModuleInit registers ONCE at boot; the handler
 * itself opens its OWN withTenant tx (OutboxWorker claims the event AFTER the approval tx commits).
 */
@Injectable()
class LeaveApprovedSyncRegistrar implements OnModuleInit {
  private readonly logger = new Logger(LeaveApprovedSyncRegistrar.name);

  constructor(
    private readonly bus: EventBus,
    private readonly sync: AttendanceLeaveSyncService,
  ) {}

  onModuleInit(): void {
    this.bus.register({
      consumerName: "attendance-leave-sync",
      eventType: "leave.request.approved",
      handle: async (ctx: EventContext): Promise<void> => {
        try {
          await this.sync.onLeaveApproved(ctx);
        } catch (err) {
          this.logger.error("onLeaveApproved sync failed — will retry via outbox", {
            eventId: ctx.eventId,
            companyId: ctx.companyId,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err; // let OutboxWorker retry/dead-letter (BẤT BIẾN #2 — no silent swallow)
        }
      },
    });
  }
}

/**
 * G11-1 — Attendance. AuditService/OutboxService come from the @Global EventsModule; PermissionModule
 * exports PermissionService + the guard stack. HrTasksService (Task Hub bridge) is provided locally —
 * it is stateless and shared with LeaveModule, avoiding a cross-edit of the shared TasksModule.
 *
 * S3-ATT-SEED-1 (additive): import SeedModule (exports MasterDataSeederRegistry) → AttSeedRegistrar
 * (OnModuleInit) registers AttMasterDataSeeder so the runtime per-company runner seeds OFFICE_8H +
 * DEFAULT_OFFICE_RULE. Inversion of dependency: SeedModule/foundation KHÔNG import ATT.
 */
@Module({
  imports: [DatabaseModule, EventsModule, PermissionModule, SeedModule],
  controllers: [
    AttendanceController,
    AttendanceAdjustmentController,
    AttendanceShiftController,
    AttendanceInternalController,
    RemoteWorkRequestController,
    AttendanceReportController,
    AttendanceAuditController,
  ],
  providers: [
    AttendanceService,
    AttendanceRepository,
    // S3-ATT-BE-5 (additive): remote/onsite-work request workflow — reuses DataScopeService +
    // PermissionService (PermissionModule exports both) + AuditService/OutboxService (EventsModule).
    RemoteWorkRequestService,
    RemoteWorkRequestRepository,
    // S3-ATT-BE-2 (additive): scoped records read. AttendanceReadService injects DataScopeService +
    // PermissionService (PermissionModule exports both) + DatabaseService (@Global) + the read repo.
    AttendanceReadService,
    AttendanceReadRepository,
    // S3-ATT-EXPORT-1 (additive): CSV export service — reuses AttendanceReadRepository (export query),
    // DataScopeService (PermissionModule) + AuditService (EventsModule) + DatabaseService (@Global).
    AttendanceExportService,
    // S3-ATT-BE-4 (additive): canonical adjustment surface (create/list/detail/approve/reject/direct).
    // Reuses AttendanceRepository (record/log/period) + DataScopeService + HrTasksService (Task Hub).
    AttendanceAdjustmentService,
    AttendanceAdjustmentRepository,
    // S3-ATT-BE-3 (additive): AttendanceShiftService injects AttendanceService to REUSE
    // resolveShiftAndRule (one implementation of the effective shift/rule priority, shared with
    // today/check-in/check-out — see attendance.service.ts).
    AttendanceShiftService,
    AttendanceShiftRepository,
    HrTasksService,
    AttMasterDataSeeder,
    AttSeedRegistrar,
    // S3-INT-1 (additive): LEAVE→ATT sync — exported so LeaveModule can inject it (revert on cancel/revoke,
    // called INLINE inside the leave tx). onLeaveApproved is bound as an EventBus consumer at boot.
    AttendanceLeaveSyncService,
    AttendanceLeaveSyncRepository,
    LeaveApprovedSyncRegistrar,
    // S3-ATT-BE-6 (additive): AttendanceReportService injects DataScopeService (PermissionModule) +
    // DatabaseService (@Global) + AttendanceReportRepository. AttendanceAuditService REUSES
    // AuditRepository (no DI deps of its own — provided locally, KHÔNG import AuditModule/its route)
    // + AuditMaskerService (EventsModule export).
    AttendanceReportService,
    AttendanceReportRepository,
    AttendanceAuditService,
    AuditRepository,
  ],
  exports: [
    AttendanceService,
    AttendanceReadService,
    AttendanceAdjustmentService,
    AttendanceShiftService,
    AttendanceLeaveSyncService,
    RemoteWorkRequestService,
    AttendanceReportService,
    AttendanceAuditService,
  ],
})
export class AttendanceModule {}
