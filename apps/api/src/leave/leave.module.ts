import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { HolidaysModule } from "../foundation/holidays/holidays.module";
import { SeedModule } from "../foundation/seed/seed.module";
import { PermissionModule } from "../permission/permission.module";
import { HrTasksService } from "../tasks/hr-tasks.service";
import { LeaveController } from "./leave.controller";
import { LeaveApprovalRepository } from "./leave-approval.repository";
import { LeaveApprovalService } from "./leave-approval.service";
import { LeaveCalendarRepository } from "./leave-calendar.repository";
import { LeaveCalendarService } from "./leave-calendar.service";
import { LeaveMasterDataSeeder } from "./leave-master-data.seeder";
import { LeaveReadRepository } from "./leave-read.repository";
import { LeaveReadService } from "./leave-read.service";
import { LeaveRepository } from "./leave.repository";
import { LeaveRequestRepository } from "./leave-request.repository";
import { LeaveRequestService } from "./leave-request.service";
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
  imports: [DatabaseModule, PermissionModule, SeedModule, HolidaysModule],
  controllers: [LeaveController],
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
    HrTasksService,
    LeaveMasterDataSeeder,
    LeaveSeedRegistrar,
  ],
  exports: [LeaveService],
})
export class LeaveModule {}
