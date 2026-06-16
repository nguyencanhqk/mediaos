import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { TemplateController } from "./template.controller";
import { TemplateService } from "./template.service";
import { TemplateCloneService } from "./template-clone.service";
import { TemplateRepository } from "./template.repository";

/**
 * TemplatesModule (G16-3) — clone bộ mẫu (workflow + role + dashboard) cho công ty.
 * Exports TemplateCloneService để PlatformModule provision lúc tạo công ty.
 * PermissionModule cung cấp PermissionGuard (+ Jwt/Company guards) cho controller.
 */
@Module({
  imports: [DatabaseModule, EventsModule, PermissionModule],
  controllers: [TemplateController],
  providers: [TemplateService, TemplateCloneService, TemplateRepository],
  exports: [TemplateCloneService],
})
export class TemplatesModule {}
