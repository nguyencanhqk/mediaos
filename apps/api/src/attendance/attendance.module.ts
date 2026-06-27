import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { SeedModule } from "../foundation/seed/seed.module";
import { PermissionModule } from "../permission/permission.module";
import { HrTasksService } from "../tasks/hr-tasks.service";
import { AttMasterDataSeeder } from "./att-master-data.seeder";
import { AttSeedRegistrar } from "./att-seed.registrar";
import { AttendanceController } from "./attendance.controller";
import { AttendanceRepository } from "./attendance.repository";
import { AttendanceService } from "./attendance.service";

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
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    AttendanceRepository,
    HrTasksService,
    AttMasterDataSeeder,
    AttSeedRegistrar,
  ],
  exports: [AttendanceService],
})
export class AttendanceModule {}
