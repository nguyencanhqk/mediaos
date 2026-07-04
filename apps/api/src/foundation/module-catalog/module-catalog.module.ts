import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { EventsModule } from "../../events/events.module";
import { PermissionModule } from "../../permission/permission.module";
import { SettingsModule } from "../settings/settings.module";
import { ModuleAdminController } from "./module-admin.controller";
import { ModuleCatalogController } from "./module-catalog.controller";
import { ModuleCatalogRepository } from "./module-catalog.repository";
import { ModuleCatalogService } from "./module-catalog.service";
import { ModuleToggleService } from "./module-toggle.service";

/**
 * S1-FND-MODULE-1 / S2-FND-BE-8 — ModuleCatalogModule (self-contained, mẫu SettingsModule). DatabaseModule =
 * withTransaction (đọc catalog no-RLS) + withTenant (ghi company_settings toggle); SettingsModule =
 * SettingService (resolveMany enabled-flag); PermissionModule = PermissionService (getCapabilities lọc quyền)
 * + PermissionGuard (gate view/update:foundation-module ở ModuleAdminController); EventsModule = AuditService
 * (CONFIG_UPDATE object_type='module' in-tx, BẤT BIẾN #2/#3 mask). ModuleCatalogController Authenticated-only
 * (my-apps tự lọc); ModuleAdminController gated.
 *
 * Wiring vào app: S1-FND-WIRE-1 (BE-9) gom vào FoundationModule (KHÔNG sửa app.module.ts ở WO này).
 */
@Module({
  imports: [DatabaseModule, PermissionModule, SettingsModule, EventsModule],
  // ORDER load-bearing: ModuleCatalogController TRƯỚC ModuleAdminController ⇒ route TĨNH `modules/my-apps`
  // đăng ký trước route param `modules/:code` (Express match theo thứ tự) → my-apps KHÔNG bị :code nuốt.
  controllers: [ModuleCatalogController, ModuleAdminController],
  providers: [ModuleCatalogService, ModuleCatalogRepository, ModuleToggleService],
  exports: [ModuleCatalogService],
})
export class ModuleCatalogModule {}
