import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { HrTasksService } from "../tasks/hr-tasks.service";
import { LeaveController } from "./leave.controller";
import { LeaveRepository } from "./leave.repository";
import { LeaveService } from "./leave.service";

/**
 * G11-2 — Leave. AuditService/OutboxService come from the @Global EventsModule; PermissionModule
 * exports PermissionService + the guard stack. HrTasksService (Task Hub bridge) is provided locally —
 * it is stateless and shared with AttendanceModule, avoiding a cross-edit of the shared TasksModule.
 */
@Module({
  imports: [DatabaseModule, PermissionModule],
  controllers: [LeaveController],
  providers: [LeaveService, LeaveRepository, HrTasksService],
  exports: [LeaveService],
})
export class LeaveModule {}
