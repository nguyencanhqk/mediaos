import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { EventsModule } from "../../events/events.module";
import { PermissionModule } from "../../permission/permission.module";
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
  imports: [DatabaseModule, PermissionModule, EventsModule],
  controllers: [CompanyController],
  providers: [CompanyService, CompanyRepository],
  exports: [CompanyService],
})
export class CompanyModule {}
