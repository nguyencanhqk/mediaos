import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { SeedModule } from "../foundation/seed/seed.module";
import { PermissionModule } from "../permission/permission.module";
import { HrTasksService } from "../tasks/hr-tasks.service";
import { LeaveController } from "./leave.controller";
import { LeaveMasterDataSeeder } from "./leave-master-data.seeder";
import { LeaveRepository } from "./leave.repository";
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
  imports: [DatabaseModule, PermissionModule, SeedModule],
  controllers: [LeaveController],
  providers: [
    LeaveService,
    LeaveRepository,
    HrTasksService,
    LeaveMasterDataSeeder,
    LeaveSeedRegistrar,
  ],
  exports: [LeaveService],
})
export class LeaveModule {}
