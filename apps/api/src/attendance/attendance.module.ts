import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { SeedModule } from "../foundation/seed/seed.module";
import { PermissionModule } from "../permission/permission.module";
import { HrTasksService } from "../tasks/hr-tasks.service";
import { AttMasterDataSeeder } from "./att-master-data.seeder";
import { AttSeedRegistrar } from "./att-seed.registrar";
import { AttendanceController } from "./attendance.controller";
import { AttendanceReadRepository } from "./attendance-read.repository";
import { AttendanceReadService } from "./attendance-read.service";
import { AttendanceRepository } from "./attendance.repository";
import { AttendanceService } from "./attendance.service";
// S3-ATT-BE-3 (additive): shift/rule/assignment CRUD (minimum) + GET /attendance/rules/effective.
import { AttendanceShiftController } from "./attendance-shift.controller";
import { AttendanceShiftRepository } from "./attendance-shift.repository";
import { AttendanceShiftService } from "./attendance-shift.service";

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
  imports: [DatabaseModule, PermissionModule, SeedModule],
  controllers: [AttendanceController, AttendanceShiftController],
  providers: [
    AttendanceService,
    AttendanceRepository,
    // S3-ATT-BE-2 (additive): scoped records read. AttendanceReadService injects DataScopeService +
    // PermissionService (PermissionModule exports both) + DatabaseService (@Global) + the read repo.
    AttendanceReadService,
    AttendanceReadRepository,
    // S3-ATT-BE-3 (additive): AttendanceShiftService injects AttendanceService to REUSE
    // resolveShiftAndRule (one implementation of the effective shift/rule priority, shared with
    // today/check-in/check-out — see attendance.service.ts).
    AttendanceShiftService,
    AttendanceShiftRepository,
    HrTasksService,
    AttMasterDataSeeder,
    AttSeedRegistrar,
  ],
  exports: [AttendanceService, AttendanceReadService, AttendanceShiftService],
})
export class AttendanceModule {}
