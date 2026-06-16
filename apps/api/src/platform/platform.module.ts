import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { SaasModule } from "../saas/saas.module";
import { TemplatesModule } from "../templates/templates.module";
import { PlatformCompanyController } from "./platform-company.controller";
import { PlatformCompanyService } from "./platform-company.service";
import { PlatformCompanyRepository } from "./platform-company.repository";

/**
 * PlatformModule (G16-3) — tầng platform-admin quản vòng đời tenant (ADR-0017).
 * Imports SaasModule (SubscriptionService — gán gói) + TemplatesModule (TemplateCloneService — provision).
 */
@Module({
  imports: [DatabaseModule, EventsModule, PermissionModule, SaasModule, TemplatesModule],
  controllers: [PlatformCompanyController],
  providers: [PlatformCompanyService, PlatformCompanyRepository],
  exports: [PlatformCompanyService],
})
export class PlatformModule {}
