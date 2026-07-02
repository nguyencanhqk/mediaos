import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { PermissionModule } from "../../permission/permission.module";
import { SettingsModule } from "../settings/settings.module";
import { ModuleAdminController } from "./module-admin.controller";
import { ModuleCatalogController } from "./module-catalog.controller";
import { ModuleCatalogRepository } from "./module-catalog.repository";
import { ModuleCatalogService } from "./module-catalog.service";

/**
 * S1-FND-MODULE-1 — ModuleCatalogModule (self-contained, mẫu SettingsModule). DatabaseModule =
 * withTransaction (đọc catalog no-RLS); SettingsModule = SettingService (resolveMany enabled-flag);
 * PermissionModule = PermissionService (getCapabilities lọc quyền). KHÔNG gắn PermissionGuard ở controller
 * (Authenticated-only) — guard global Jwt/Company đủ cấp req.user.
 *
 * Wiring vào app: S1-FND-WIRE-1 (BE-9) gom vào FoundationModule (KHÔNG sửa app.module.ts ở WO này).
 */
@Module({
  imports: [DatabaseModule, PermissionModule, SettingsModule],
  // ORDER load-bearing: ModuleCatalogController TRƯỚC ModuleAdminController ⇒ route TĨNH `modules/my-apps`
  // đăng ký trước route param `modules/:code` (Express match theo thứ tự) → my-apps KHÔNG bị :code nuốt.
  controllers: [ModuleCatalogController, ModuleAdminController],
  providers: [ModuleCatalogService, ModuleCatalogRepository],
  exports: [ModuleCatalogService],
})
export class ModuleCatalogModule {}
