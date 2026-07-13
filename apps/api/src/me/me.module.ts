import { Module } from "@nestjs/common";
import { PermissionModule } from "../permission/permission.module";
import { SettingsModule } from "../foundation/settings/settings.module";
import { EmployeesModule } from "../employees/employees.module";
import { AttendanceModule } from "../attendance/attendance.module";
import { LeaveModule } from "../leave/leave.module";
import { TasksModule } from "../tasks/tasks.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { MeController } from "./me.controller";
import { MeAggregationService } from "./me-aggregation.service";
import { MeCurrentPersonResolver } from "./me-current-person.resolver";
import { MeRepository } from "./me.repository";

/**
 * S5-ME-BE-1 — MeModule (Personal Hub, SPEC-09 / API-11). Lớp TỔNG HỢP đọc-own: KHÔNG sở hữu dữ liệu nguồn.
 *
 * IMPORT reader ĐÃ export (KHÔNG re-provide instance thứ 2 — dùng đúng singleton của module nguồn):
 *   PermissionModule    → PermissionService (re-check cặp quyền nguồn) + PermissionGuard (cổng ME.ACCESS).
 *   SettingsModule(fnd) → SettingService (resolve module.<code>.enabled — §12.3 module_disabled).
 *   EmployeesModule     → HrReadService.getMyProfile (self, đã mask).
 *   AttendanceModule    → AttendanceService.getToday (own).
 *   LeaveModule         → LeaveReadService.listMyBalances (own).
 *   TasksModule         → TaskCoreService.getMyTasks(user) (own, canonical).
 *   NotificationsModule → MyNotificationsService.unreadCount (own).
 *   DatabaseService + AuditService = @Global (không cần import).
 *
 * Providers CỤC BỘ: MeRepository (account/employee-count self) + MeCurrentPersonResolver (§12.1/§12.4) +
 * MeAggregationService (orchestrate + fail-soft). Mount ở app.module.ts KHỐI ADDITIVE.
 */
@Module({
  imports: [
    PermissionModule,
    SettingsModule,
    EmployeesModule,
    AttendanceModule,
    LeaveModule,
    TasksModule,
    NotificationsModule,
  ],
  controllers: [MeController],
  providers: [MeRepository, MeCurrentPersonResolver, MeAggregationService],
})
export class MeModule {}
