import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { EventsModule } from "../../events/events.module";
import { PermissionModule } from "../../permission/permission.module";
import { FilesModule } from "../files/files.module";
import { SettingsModule } from "../settings/settings.module";
import { CompanyBrandingController } from "./company-branding.controller";
import { CompanyBrandingService } from "./company-branding.service";
import { CompanyController } from "./company.controller";
import { CompanyRepository } from "./company.repository";
import { CompanyService } from "./company.service";

/**
 * S1-FND-MODULE-1 — CompanyModule (self-contained, mẫu SettingsModule). DatabaseModule = withTenant/RLS
 * (BẤT BIẾN #1); EventsModule = AuditService (COMPANY_UPDATED in-tx, BẤT BIẾN #2/#3); PermissionModule =
 * guard stack (route gate fail-closed).
 *
 * Wiring vào app: S1-FND-WIRE-1 (BE-9) gom vào FoundationModule (KHÔNG sửa app.module.ts ở WO này — tránh
 * va hot-file §3). Exports CompanyService cho consumer khác (vd dashboard company-info) nếu cần.
 */
@Module({
  // S5-BRAND-BE-1 (additive): FilesModule = FileService/FileRepository/FileLinkRepository (wrapper presign
  // logo+favicon, mẫu ME avatar); SettingsModule = SettingService (con trỏ favicon qua company_settings).
  imports: [DatabaseModule, PermissionModule, EventsModule, FilesModule, SettingsModule],
  controllers: [CompanyController, CompanyBrandingController],
  providers: [CompanyService, CompanyRepository, CompanyBrandingService],
  exports: [CompanyService, CompanyBrandingService],
})
export class CompanyModule {}
