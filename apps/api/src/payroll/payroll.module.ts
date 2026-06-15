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
import { BonusPenaltyController } from "./bonus-penalty.controller";
import { BonusPenaltyRepository } from "./bonus-penalty.repository";
import { BonusPenaltyService } from "./bonus-penalty.service";

/**
 * PayrollModule (G12 — CROWN JEWEL). PermissionModule = permission stack + guards (sensitive gate).
 * EventsModule = AuditService. DatabaseModule = withTenant (RLS).
 *  - G12-1 salary profile (mask + reveal⟹audit).
 *  - G12-2 payroll period (mutable draft→locked) + payslip snapshot (append-only, ADR-0005).
 *  - G12-3 bonus/penalty (mutable draft→approved/rejected, có duyệt) → gộp vào payslip khi runPayroll.
 */
@Module({
  imports: [DatabaseModule, EventsModule, PermissionModule],
  controllers: [
    SalaryProfileController,
    PayrollPeriodController,
    PayslipController,
    BonusPenaltyController,
  ],
  providers: [
    SalaryProfileService,
    SalaryProfileRepository,
    PayrollPeriodService,
    PayrollPeriodRepository,
    PayslipService,
    PayslipRepository,
    BonusPenaltyService,
    BonusPenaltyRepository,
  ],
  exports: [SalaryProfileService, PayrollPeriodService, PayslipService, BonusPenaltyService],
})
export class PayrollModule {}
