import { Module, type OnModuleInit } from "@nestjs/common";
import { SeedModule } from "../foundation/seed/seed.module";
import { PermissionModule } from "../permission/permission.module";
import { BonusPenaltiesRepository } from "./bonus-penalties.repository";
import { BonusPenaltiesService } from "./bonus-penalties.service";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollApprovalService } from "./payroll-approval.service";
import { PayrollApproverReader } from "./payroll-approver.reader";
import { PayrollCalcInputsRepository } from "./payroll-calc-inputs.repository";
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
// ── S15-PAYROLL-BE-2 (track B · PAYROLL-API-044..058) ──
import {
  PayrollSalaryComponentsController,
  PayrollStatutoryRatesController,
  PayrollTemplatesController,
} from "./payroll-catalog.controllers";
import { PayrollTemplatesRepository } from "./payroll-templates.repository";
import { PayrollTemplatesService } from "./payroll-templates.service";
import { SalaryComponentsRepository } from "./salary-components.repository";
import { SalaryComponentsService } from "./salary-components.service";
import { StatutoryRatesRepository } from "./statutory-rates.repository";
import { StatutoryRatesService } from "./statutory-rates.service";
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
// ── S15-PAYROLL-BE-4 (track C · PAYROLL-API-059..077) ──
import {
  MePayrollAdvancesController,
  PayrollAdvancesController,
} from "./payroll-advances.controllers";
import { PayrollAdvancesRepository } from "./payroll-advances.repository";
import { PayrollAdvancesService } from "./payroll-advances.service";
import { PayrollAdjustmentImportRepository } from "./payroll-adjustments-import.repository";
import { PayrollAdjustmentImportService } from "./payroll-adjustments-import.service";
import { PayrollBudgetsRepository } from "./payroll-budgets.repository";
import { PayrollBudgetsService } from "./payroll-budgets.service";
import { PayrollImportParser } from "./payroll-import.parser";
import { PayrollPairHoldersReader } from "./payroll-pair-holders.reader";
import {
  PayrollAdjustmentImportsController,
  PayrollBudgetsController,
  PayrollPaymentBatchesController,
} from "./payroll-payment.controllers";
import { PayrollPaymentBatchesRepository } from "./payroll-payment-batches.repository";
import { PayrollPaymentBatchesService } from "./payroll-payment-batches.service";
import { PayrollPaymentExportService } from "./payroll-payment-export.service";
import { PayrollOverviewRepository } from "./payroll-overview.repository";
import { PayrollOverviewService } from "./payroll-overview.service";
import { PayrollReportExportService } from "./payroll-report-export.service";
import { PayrollReportsController } from "./payroll-reports.controllers";
import { PayrollReportsRepository } from "./payroll-reports.repository";
import { PayrollReportsService } from "./payroll-reports.service";
// ── S15-PAYROLL-BE-5B (additive) ──
import { FilesModule } from "../foundation/files/files.module";
import { FilePolicyService } from "../foundation/files/file-policy.service";
import { PayslipPdfRenderer } from "./payslip-pdf.renderer";
import { PayrollExportFileResolver } from "./payroll-export-file.resolver";
import {
  MePayslipPdfController,
  PayrollPayslipPdfBatchController,
  PayrollPayslipPdfController,
} from "./payroll-pdf.controllers";
import { PayrollPayslipPdfBatchConsumer } from "./payroll-payslip-pdf-batch.consumer";
import {
  DEFAULT_PAYSLIP_PDF_BATCH_LIMITS,
  PAYSLIP_PDF_BATCH_LIMITS,
  PayrollPayslipPdfBatchService,
} from "./payroll-payslip-pdf-batch.service";
import { PayrollPayslipPdfRepository } from "./payroll-payslip-pdf.repository";
import { PayrollPayslipPdfService } from "./payroll-payslip-pdf.service";

/**
 * `PayrollModule` (SPEC-11 · DB-13 · API-18) — **58/58 route** sau `S15-PAYROLL-BE-2`:
 * v1 BE-1 nền (`001..006` · `019..028` · `034..035`) + v1 BE-2 máy tính lương · duyệt four-eyes ·
 * phiếu lương · export (`007..018` · `029..033`) + **v2 track A** nhân sự hưởng lương · thiết lập
 * BH/công đoàn/TK ngân hàng · người phụ thuộc · bảng công kỳ (`036..043`) + **v2 track B** catalog thành phần
 * lương · mẫu bảng lương · tỉ lệ luật định (`044..058`) trên máy công thức `src/payroll/formula/`.
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
  // S15-PAYROLL-BE-5B (additive): + FilesModule (ServerFileService + FilePolicyService — PDF/ZIP phiếu lương tạm).
  imports: [PermissionModule, SeedModule, FilesModule],
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
    // ── S15-PAYROLL-BE-2 ──
    PayrollSalaryComponentsController,
    PayrollTemplatesController,
    PayrollStatutoryRatesController,
    // ── S15-PAYROLL-BE-4 ──
    PayrollAdvancesController,
    MePayrollAdvancesController,
    PayrollPaymentBatchesController,
    PayrollBudgetsController,
    PayrollAdjustmentImportsController,
    // ── S15-PAYROLL-BE-5 ──
    PayrollReportsController,
    // ── S15-PAYROLL-BE-5B ──
    PayrollPayslipPdfController,
    MePayslipPdfController,
    PayrollPayslipPdfBatchController,
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
    PayrollCalcInputsRepository,
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
    // ── S15-PAYROLL-BE-2 (track B) ──
    SalaryComponentsRepository,
    PayrollTemplatesRepository,
    StatutoryRatesRepository,
    SalaryComponentsService,
    PayrollTemplatesService,
    StatutoryRatesService,
    // ── S15-PAYROLL-BE-4 (track C) ──
    PayrollPairHoldersReader,
    PayrollAdvancesRepository,
    PayrollAdvancesService,
    PayrollPaymentBatchesRepository,
    PayrollPaymentBatchesService,
    PayrollPaymentExportService,
    PayrollBudgetsRepository,
    PayrollBudgetsService,
    PayrollImportParser,
    PayrollAdjustmentImportRepository,
    PayrollAdjustmentImportService,
    // ── S15-PAYROLL-BE-5 (track D phần 1) ──
    PayrollReportsRepository,
    PayrollOverviewRepository,
    PayrollReportsService,
    PayrollReportExportService,
    PayrollOverviewService,
    // ── S15-PAYROLL-BE-5B (track D phần 2 — PDF) ──
    PayslipPdfRenderer,
    PayrollPayslipPdfRepository,
    PayrollPayslipPdfService,
    PayrollPayslipPdfBatchService,
    PayrollPayslipPdfBatchConsumer,
    PayrollExportFileResolver,
    { provide: PAYSLIP_PDF_BATCH_LIMITS, useValue: DEFAULT_PAYSLIP_PDF_BATCH_LIMITS },
  ],
  // S13-PAYROLL-DASH-1: chỉ PayrollCalcService — KHÔNG export repository (widget phải đi qua service để
  // giữ nguyên tầng guard THỨ HAI `resolveActor` + audit; export repository là mở đường vòng qua cả hai).
  // S15-PAYROLL-DASH-1 (additive): DASH cần 2 nguồn widget v2. Export SERVICE (đã gate + audit),
  // KHÔNG repository — widget đi qua đúng cổng của route 073/059.
  exports: [PayrollCalcService, PayrollBudgetsService, PayrollAdvancesService],
})
export class PayrollModule implements OnModuleInit {
  constructor(
    private readonly filePolicy: FilePolicyService,
    private readonly exportFileResolver: PayrollExportFileResolver,
  ) {}

  /**
   * S15-PAYROLL-BE-5B — tệp PDF/ZIP phiếu lương có link `PAYROLL`; resolver từ chối mọi thao tác trên route file
   * chung (plan E-5). `registerResolver` NÉM khi trùng khoá ⇒ đăng ký đúng một lần ở đây.
   */
  onModuleInit(): void {
    this.filePolicy.registerResolver(this.exportFileResolver);
  }
}
