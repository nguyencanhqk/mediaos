import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { EventsModule } from "../../events/events.module";
import { PermissionModule } from "../../permission/permission.module";
import { SettingRepository } from "./setting.repository";
import { SettingService } from "./setting.service";
import { SettingsController } from "./settings.controller";

/**
 * S1-FND-SETTING-1 — SettingsModule (self-contained). DatabaseModule = withTenant/RLS (BẤT BIẾN #1);
 * PermissionModule = PermissionService + guard stack (resolve quyền-aware + route gate); EventsModule =
 * AuditService (CONFIG_UPDATE in-tx, BẤT BIẾN #2/#3 mask). Exports SettingService để ATT/LEAVE/DASH dùng
 * resolveSetting/resolveMany.
 *
 * Wiring vào app: S1-FND-WIRE-1 (BE-9) gom module này vào FoundationModule (KHÔNG sửa app.module.ts ở WO
 * này — tránh va hot-file). EventsModule là @Global nên AuditService có sẵn; import tường minh để self-contained.
 */
@Module({
  imports: [DatabaseModule, PermissionModule, EventsModule],
  controllers: [SettingsController],
  providers: [SettingService, SettingRepository],
  exports: [SettingService],
})
export class SettingsModule {}
