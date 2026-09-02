import { Module } from "@nestjs/common";
import { PermissionModule } from "../permission/permission.module";
import { BonusPenaltiesRepository } from "./bonus-penalties.repository";
import { BonusPenaltiesService } from "./bonus-penalties.service";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollApprovalService } from "./payroll-approval.service";
import { PayrollApproverReader } from "./payroll-approver.reader";
import { PayrollCalcRepository } from "./payroll-calc.repository";
import { PayrollCalcService } from "./payroll-calc.service";
import { PayrollExportService } from "./payroll-export.service";
import { PayrollInputsRepository } from "./payroll-inputs.repository";
import { PayrollPayslipsRepository } from "./payroll-payslips.repository";
import { PayrollPayslipsService } from "./payroll-payslips.service";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import { PayrollPeriodsRepository } from "./payroll-periods.repository";
import { PayrollPeriodsService } from "./payroll-periods.service";
import {
  BonusPenaltiesController,
  MePayslipsController,
  PayrollPeriodsController,
  PayrollPickersController,
  PayslipsController,
  SalaryProfilesController,
} from "./payroll.controllers";
import { SalaryProfilesRepository } from "./salary-profiles.repository";
import { SalaryProfilesService } from "./salary-profiles.service";

/**
 * `PayrollModule` (SPEC-11 · DB-13 · API-18) — **35/35 route** sau `S13-PAYROLL-BE-2`:
 * BE-1 nền (`001..006` · `019..028` · `034..035`) + BE-2 máy tính lương · duyệt four-eyes · phiếu
 * lương · export (`007..018` · `029..033`).
 *
 * imports: `PermissionModule` (PermissionGuard + DataScopeService — guard 2 tầng §11).
 * `AuditService` **và** `OutboxService` đến từ `EventsModule` @Global — KHÔNG import
 * `NotificationsModule` (giữ acyclic; registrar bridge sống bên `notifications/` và đọc NGƯỢC).
 *
 * ⚠️ Module `PAYROLL` trong bảng `modules` vẫn **`is_active = false`** (FE-1 mới bật cờ) — cờ đó là
 * chỉ báo HIỂN THỊ, **không phải cổng** (memory `module-is-active-is-not-a-gate`): route ở đây sống
 * bình thường và vẫn được gác bằng `PermissionGuard` + RLS. Đừng "sửa cho nhất quán".
 *
 * Export DUY NHẤT `PayrollCalcService` (S13-PAYROLL-DASH-1) — `DashboardModule` inject nó cho handler
 * widget `PAYROLL_COST` để dùng LẠI `summary()` (một công thức, một con số với PAYROLL-API-018; nó tự
 * `resolveActor` + ghi audit lượt đọc). DASH là leaf, PayrollModule KHÔNG import DASH ⇒ không circular-dep.
 * Người nhận NOTI-020 vẫn đi THEO PAYLOAD outbox (`PayrollApproverReader` chạy ở `submit`), nên registrar
 * KHÔNG đọc gì từ module này — export ở đây không mở thêm bề mặt nào cho NOTI.
 */
@Module({
  imports: [PermissionModule],
  controllers: [
    PayrollPeriodsController,
    SalaryProfilesController,
    BonusPenaltiesController,
    PayslipsController,
    MePayslipsController,
    PayrollPickersController,
  ],
  providers: [
    PayrollAccessService,
    PayrollPeopleRepository,
    PayrollInputsRepository,
    PayrollPeriodsRepository,
    SalaryProfilesRepository,
    BonusPenaltiesRepository,
    PayrollPeriodsService,
    SalaryProfilesService,
    BonusPenaltiesService,
    // ── S13-PAYROLL-BE-2 ──
    PayrollApproverReader,
    PayrollCalcRepository,
    PayrollPayslipsRepository,
    PayrollCalcService,
    PayrollApprovalService,
    PayrollPayslipsService,
    PayrollExportService,
  ],
  // S13-PAYROLL-DASH-1: chỉ PayrollCalcService — KHÔNG export repository (widget phải đi qua service để
  // giữ nguyên tầng guard THỨ HAI `resolveActor` + audit; export repository là mở đường vòng qua cả hai).
  exports: [PayrollCalcService],
})
export class PayrollModule {}
