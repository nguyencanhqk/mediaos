import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { PermissionModule } from "../../permission/permission.module";
import { SettingsModule } from "../settings/settings.module";
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
  controllers: [ModuleCatalogController],
  providers: [ModuleCatalogService, ModuleCatalogRepository],
  exports: [ModuleCatalogService],
})
export class ModuleCatalogModule {}
