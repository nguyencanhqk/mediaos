import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { HrTasksService } from "../tasks/hr-tasks.service";
import { AttendanceController } from "./attendance.controller";
import { AttendanceRepository } from "./attendance.repository";
import { AttendanceService } from "./attendance.service";

/**
 * G11-1 — Attendance. AuditService/OutboxService come from the @Global EventsModule; PermissionModule
 * exports PermissionService + the guard stack. HrTasksService (Task Hub bridge) is provided locally —
 * it is stateless and shared with LeaveModule, avoiding a cross-edit of the shared TasksModule.
 */
@Module({
  imports: [DatabaseModule, PermissionModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceRepository, HrTasksService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
