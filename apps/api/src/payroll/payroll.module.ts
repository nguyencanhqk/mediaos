import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { SalaryProfileController } from "./salary-profile.controller";
import { SalaryProfileRepository } from "./salary-profile.repository";
import { SalaryProfileService } from "./salary-profile.service";
import { PayrollPeriodController } from "./payroll-period.controller";
import { PayrollPeriodRepository } from "./payroll-period.repository";
import { PayrollPeriodService } from "./payroll-period.service";
import { PayslipController } from "./payslip.controller";
import { PayslipRepository } from "./payslip.repository";
import { PayslipService } from "./payslip.service";

/**
 * PayrollModule (G12 — CROWN JEWEL). PermissionModule = permission stack + guards (sensitive gate).
 * EventsModule = AuditService. DatabaseModule = withTenant (RLS).
 *  - G12-1 salary profile (mask + reveal⟹audit).
 *  - G12-2 payroll period (mutable draft→locked) + payslip snapshot (append-only, ADR-0005).
 * KPI/bonus/penalty logic (G8-4) = SLOT null — KHÔNG implement ở đây.
 */
@Module({
  imports: [DatabaseModule, EventsModule, PermissionModule],
  controllers: [SalaryProfileController, PayrollPeriodController, PayslipController],
  providers: [
    SalaryProfileService,
    SalaryProfileRepository,
    PayrollPeriodService,
    PayrollPeriodRepository,
    PayslipService,
    PayslipRepository,
  ],
  exports: [SalaryProfileService, PayrollPeriodService, PayslipService],
})
export class PayrollModule {}
