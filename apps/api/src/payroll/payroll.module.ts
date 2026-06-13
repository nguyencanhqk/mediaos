import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { SalaryProfileController } from "./salary-profile.controller";
import { SalaryProfileRepository } from "./salary-profile.repository";
import { SalaryProfileService } from "./salary-profile.service";

/**
 * PayrollModule (G12-1 — salary profile, CROWN JEWEL).
 * PermissionModule = permission stack + guards (sensitive gate). EventsModule = AuditService.
 * DatabaseModule = withTenant (RLS). KPI/bonus (G12-3) để sau khi G8 land — KHÔNG ở đây.
 */
@Module({
  imports: [DatabaseModule, EventsModule, PermissionModule],
  controllers: [SalaryProfileController],
  providers: [SalaryProfileService, SalaryProfileRepository],
  exports: [SalaryProfileService],
})
export class PayrollModule {}
