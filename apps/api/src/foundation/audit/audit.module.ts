import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { PermissionModule } from "../../permission/permission.module";
import { AuditController } from "./audit.controller";
import { AuditRepository } from "./audit.repository";
import { AuditQueryService } from "./audit.service";

/**
 * AuditModule (FOUNDATION-BE-3) — audit viewer read-API. PermissionModule cấp permission stack cho
 * @UseGuards(PermissionGuard); AuditMaskerService đến từ EventsModule (@Global); DatabaseService từ
 * DatabaseModule (@Global, import tường minh cho rõ ràng).
 *
 * BE-9 sẽ RELOCATE module này vào FoundationModule (APPEND, KHÔNG rewrite — CLAUDE §9.3).
 */
@Module({
  imports: [DatabaseModule, PermissionModule],
  controllers: [AuditController],
  providers: [AuditQueryService, AuditRepository],
})
export class AuditModule {}
