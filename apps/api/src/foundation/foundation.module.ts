import { Module } from "@nestjs/common";
import { AuditModule } from "./audit/audit.module";
import { SettingsModule } from "./settings/settings.module";
import { CompanyModule } from "./company/company.module";
import { ModuleCatalogModule } from "./module-catalog/module-catalog.module";
import { FilesModule } from "./files/files.module";
import { HolidaysModule } from "./holidays/holidays.module";

/**
 * S1-FND-WIRE-1 — FoundationModule: gom các module Foundation CÓ HTTP surface vào MỘT nơi để
 * `/api/v1/foundation/*` được phục vụ tập trung (BACKEND-04 §22). Import vào app.module ADDITIVE (CLAUDE.md
 * §9.3) — thay cho việc wire lẻ từng module (AuditModule trước đây nằm thẳng app.module → relocate vào đây).
 *
 * Re-export 6 module con để consumer khác vẫn lấy được service (SettingsModule exports SettingService cho
 * ATT/LEAVE/DASH; FilesModule exports FileService/FilePolicyService; …). Mỗi module con tự-đủ (đã import
 * DatabaseModule/PermissionModule/EventsModule) nên FoundationModule chỉ cần gom + re-export.
 *
 * NGOÀI phạm vi (S1-FND-WIRE-DRIFT-1): reconcile route files-controller theo spec + chuẩn hoá envelope.
 * retention/seed/sequences = service-only mồ côi (chưa consumer) → CHƯA gom (YAGNI), thêm khi có consumer.
 */
@Module({
  imports: [
    AuditModule,
    SettingsModule,
    CompanyModule,
    ModuleCatalogModule,
    FilesModule,
    HolidaysModule,
  ],
  exports: [
    AuditModule,
    SettingsModule,
    CompanyModule,
    ModuleCatalogModule,
    FilesModule,
    HolidaysModule,
  ],
})
export class FoundationModule {}
