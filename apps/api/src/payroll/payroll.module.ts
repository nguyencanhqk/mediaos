import { Module } from "@nestjs/common";
import { SeedModule } from "../foundation/seed/seed.module";
import { PermissionModule } from "../permission/permission.module";
import { BonusPenaltiesRepository } from "./bonus-penalties.repository";
import { BonusPenaltiesService } from "./bonus-penalties.service";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollApprovalService } from "./payroll-approval.service";
import { PayrollApproverReader } from "./payroll-approver.reader";
import { PayrollCalcRepository } from "./payroll-calc.repository";
import { PayrollCalcService } from "./payroll-calc.service";
import { PayrollExportService } from "./payroll-export.service";
import { PayrollMasterDataSeeder } from "./payroll-master-data.seeder";
import { PayrollInputsRepository } from "./payroll-inputs.repository";
import { PayrollPayslipsRepository } from "./payroll-payslips.repository";
import { PayrollPayslipsService } from "./payroll-payslips.service";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import { PayrollPeriodsRepository } from "./payroll-periods.repository";
import { PayrollPeriodsService } from "./payroll-periods.service";
import { PayrollSeedRegistrar } from "./payroll-seed.registrar";
// ── S15-PAYROLL-BE-1 (track A · PAYROLL-API-036..043) ──
import {
  PayrollDependentsController,
  PayrollEmployeesController,
} from "./payroll-employees.controllers";
import { PayrollDependentsRepository } from "./payroll-dependents.repository";
import { PayrollDependentsService } from "./payroll-dependents.service";
import { PayrollEmployeeSettingsRepository } from "./payroll-employee-settings.repository";
import { PayrollEmployeeSettingsService } from "./payroll-employee-settings.service";
import { PayrollEmployeesRepository } from "./payroll-employees.repository";
import { PayrollEmployeesService } from "./payroll-employees.service";
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
 * `PayrollModule` (SPEC-11 · DB-13 · API-18) — **43/43 route** sau `S15-PAYROLL-BE-1`:
 * v1 BE-1 nền (`001..006` · `019..028` · `034..035`) + v1 BE-2 máy tính lương · duyệt four-eyes ·
 * phiếu lương · export (`007..018` · `029..033`) + **v2 track A** nhân sự hưởng lương · thiết lập
 * BH/công đoàn/TK ngân hàng · người phụ thuộc · bảng công kỳ (`036..043`).
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
  // S15-PAYROLL-DB-1 (additive): + SeedModule (exports MasterDataSeederRegistry) → PayrollSeedRegistrar
  // (OnModuleInit) đăng ký PayrollMasterDataSeeder để runner RUNTIME per-company seed catalog thành
  // phần lương + tỉ lệ luật định + mẫu mặc định. Seed company-scoped KHÔNG ĐƯỢC nằm trong migration
  // (mig 0445 + master-data-seeder.types.ts) — xem docblock của seeder.
  imports: [PermissionModule, SeedModule],
  controllers: [
    PayrollPeriodsController,
    SalaryProfilesController,
    BonusPenaltiesController,
    PayslipsController,
    MePayslipsController,
    PayrollPickersController,
    // ── S15-PAYROLL-BE-1 ──
    PayrollEmployeesController,
    PayrollDependentsController,
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
    // ── S15-PAYROLL-DB-1 (seed master-data runtime) ──
    PayrollMasterDataSeeder,
    PayrollSeedRegistrar,
    // ── S15-PAYROLL-BE-1 (track A) ──
    PayrollEmployeesRepository,
    PayrollEmployeeSettingsRepository,
    PayrollDependentsRepository,
    PayrollEmployeesService,
    PayrollEmployeeSettingsService,
    PayrollDependentsService,
  ],
  // S13-PAYROLL-DASH-1: chỉ PayrollCalcService — KHÔNG export repository (widget phải đi qua service để
  // giữ nguyên tầng guard THỨ HAI `resolveActor` + audit; export repository là mở đường vòng qua cả hai).
  exports: [PayrollCalcService],
})
export class PayrollModule {}
