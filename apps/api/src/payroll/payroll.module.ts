import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { AuthModule } from "../auth/auth.module";
import { SalaryProfileController } from "./salary-profile.controller";
import { SalaryProfileRepository } from "./salary-profile.repository";
import { SalaryProfileService } from "./salary-profile.service";
import { PayrollPeriodController } from "./payroll-period.controller";
import { PayrollPeriodRepository } from "./payroll-period.repository";
import { PayrollPeriodService } from "./payroll-period.service";
import { PayslipController } from "./payslip.controller";
import { PayslipRepository } from "./payslip.repository";
import { PayslipService } from "./payslip.service";
import { PayslipReauthService } from "./payslip-reauth.service";
import { PayslipReauthGuard } from "./payslip-reauth.guard";
import { PayslipAcknowledgementController } from "./payslip-acknowledgement.controller";
import { PayslipAcknowledgementRepository } from "./payslip-acknowledgement.repository";
import { PayslipAcknowledgementService } from "./payslip-acknowledgement.service";
import { BonusPenaltyController } from "./bonus-penalty.controller";
import { BonusPenaltyRepository } from "./bonus-penalty.repository";
import { BonusPenaltyService } from "./bonus-penalty.service";

/**
 * PayrollModule (G12 — CROWN JEWEL). PermissionModule = permission stack + guards + ValkeyService.
 * EventsModule = AuditService. DatabaseModule = withTenant (RLS). AuthModule = PasswordService +
 * LoginRateLimiter (G12-4 re-auth step-up xem payslip).
 *  - G12-1 salary profile (mask + reveal⟹audit).
 *  - G12-2 payroll period + payslip snapshot (append-only, ADR-0005).
 *  - G12-3 bonus/penalty (mutable draft→approved/rejected, có duyệt) → gộp vào payslip khi runPayroll.
 *  - G12-4 duyệt bảng lương (draft→approved→published) + nhân viên xác nhận/khiếu nại + re-auth xem payslip.
 */
@Module({
  imports: [DatabaseModule, EventsModule, PermissionModule, AuthModule],
  controllers: [
    SalaryProfileController,
    PayrollPeriodController,
    PayslipController,
    PayslipAcknowledgementController,
    BonusPenaltyController,
  ],
  providers: [
    SalaryProfileService,
    SalaryProfileRepository,
    PayrollPeriodService,
    PayrollPeriodRepository,
    PayslipService,
    PayslipRepository,
    PayslipReauthService,
    PayslipReauthGuard,
    PayslipAcknowledgementService,
    PayslipAcknowledgementRepository,
    BonusPenaltyService,
    BonusPenaltyRepository,
  ],
  exports: [
    SalaryProfileService,
    PayrollPeriodService,
    PayslipService,
    PayslipReauthService,
    PayslipAcknowledgementService,
    BonusPenaltyService,
  ],
})
export class PayrollModule {}
