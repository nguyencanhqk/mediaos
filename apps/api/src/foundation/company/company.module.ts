import { Module, type OnModuleInit } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { EventsModule } from "../../events/events.module";
import { PermissionModule } from "../../permission/permission.module";
import { FilePolicyService } from "../files/file-policy.service";
import { FilesModule } from "../files/files.module";
import { SettingsModule } from "../settings/settings.module";
import { CompanyBrandingFileResolver } from "./company-branding-file.resolver";
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
  // S5-BRAND-BE-1 (additive): FilesModule = FileService/FileRepository/FileLinkRepository/FilePolicyService
  // (wrapper presign logo+favicon, mẫu ME avatar); SettingsModule = SettingService (con trỏ favicon).
  imports: [DatabaseModule, PermissionModule, EventsModule, FilesModule, SettingsModule],
  controllers: [CompanyController, CompanyBrandingController],
  providers: [
    CompanyService,
    CompanyRepository,
    CompanyBrandingService,
    CompanyBrandingFileResolver,
  ],
  exports: [CompanyService, CompanyBrandingService],
})
export class CompanyModule implements OnModuleInit {
  constructor(
    private readonly filePolicy: FilePolicyService,
    private readonly brandingFileResolver: CompanyBrandingFileResolver,
  ) {}

  /**
   * S5-BRAND-BE-1 (security-review BLOCK #1) — đăng ký resolver cho (FOUNDATION, company-logo|company-favicon)
   * vào singleton FilePolicyService dùng chung (mẫu MeModule.onModuleInit).
   *
   * BẮT BUỘC: `decideForLinkedFile` fail-closed `deny-no-resolver` cho MỌI link chưa có resolver, KHÔNG
   * escalate fallback ⇒ thiếu dòng này thì `files.link` 403 và `GET /branding` luôn trả null (tính năng
   * chết trong im lặng). Additive — KHÔNG đụng app.module.ts.
   */
  onModuleInit(): void {
    this.filePolicy.registerResolver(this.brandingFileResolver);
  }
}
