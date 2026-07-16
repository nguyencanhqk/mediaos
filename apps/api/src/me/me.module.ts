import { Module, type OnModuleInit } from "@nestjs/common";
import { PermissionModule } from "../permission/permission.module";
import { SettingsModule } from "../foundation/settings/settings.module";
import { EmployeesModule } from "../employees/employees.module";
import { AttendanceModule } from "../attendance/attendance.module";
import { LeaveModule } from "../leave/leave.module";
import { TasksModule } from "../tasks/tasks.module";
import { NotificationsModule } from "../notifications/notifications.module";
// S5-ME-BE-2 (additive): FilesModule → FileService/FilePolicyService/FileRepository/FileLinkRepository
// cho avatar self-service (TÁI DÙNG presigned upload/confirm ĐÃ có — KHÔNG dựng pipeline mới).
import { FilesModule } from "../foundation/files/files.module";
import { FilePolicyService } from "../foundation/files/file-policy.service";
import { MeController } from "./me.controller";
import { MeAggregationService } from "./me-aggregation.service";
import { MeCurrentPersonResolver } from "./me-current-person.resolver";
import { MeRepository } from "./me.repository";
// S5-ME-BE-2 (additive): preferences (GET/PATCH /me/preferences[/appearance] — upsert user_preferences own-scope).
import { MePreferencesController } from "./me-preferences.controller";
import { MePreferencesService } from "./me-preferences.service";
import { MePreferencesRepository } from "./me-preferences.repository";
// S5-ME-BE-2 (additive): avatar (POST/DELETE /me/avatar — file_links + employee_profiles.avatar_url).
import { MeAvatarController } from "./me-avatar.controller";
import { MeAvatarService } from "./me-avatar.service";
import { MeAvatarRepository } from "./me-avatar.repository";
import { MeAvatarFileResolver } from "./me-avatar-file.resolver";

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
 *
 * S5-ME-BE-2 (additive): + FilesModule (avatar self-service, TÁI DÙNG FileService register/confirm/link/
 * unlink/getDownloadUrl — KHÔNG dựng pipeline upload mới) + MePreferences/MeAvatar controllers/providers.
 * `MeAvatarFileResolver` đăng ký vào FilePolicyService (singleton, additive wiring) ở onModuleInit — mirror
 * EmployeesModule.onModuleInit (HrContractFileResolver/EmployeeFileResolver) — KHÔNG sửa app.module.ts.
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
    FilesModule,
  ],
  controllers: [MeController, MePreferencesController, MeAvatarController],
  providers: [
    MeRepository,
    MeCurrentPersonResolver,
    MeAggregationService,
    MePreferencesRepository,
    MePreferencesService,
    MeAvatarRepository,
    MeAvatarService,
    MeAvatarFileResolver,
  ],
})
export class MeModule implements OnModuleInit {
  constructor(
    private readonly filePolicy: FilePolicyService,
    private readonly avatarFileResolver: MeAvatarFileResolver,
  ) {}

  onModuleInit(): void {
    this.filePolicy.registerResolver(this.avatarFileResolver);
  }
}
