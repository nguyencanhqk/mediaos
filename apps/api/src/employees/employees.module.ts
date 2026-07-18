import { Module, type OnModuleInit } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { DatabaseModule } from "../db/db.module";
import { PasswordService } from "../auth/password.service";
import { PermissionModule } from "../permission/permission.module";
import { SecurityPolicyModule } from "../security-policy/security-policy.module";
import { SequenceModule } from "../foundation/sequences/sequence.module";
import { FilesModule } from "../foundation/files/files.module";
import { FilePolicyService } from "../foundation/files/file-policy.service";
// S2-HR-BE-6 scope FIX (additive): SettingService for company-configurable contract expiry milestones.
import { SettingsModule } from "../foundation/settings/settings.module";
// S2-FND-SEED-2 (additive): SeedModule exports MasterDataSeederRegistry — HrSeedRegistrar registers
// HrMasterDataSeeder (job_levels/contract_types/employee_code_configs) at onModuleInit (mirror ATT/LEAVE).
import { SeedModule } from "../foundation/seed/seed.module";
import { HrMasterDataSeeder } from "./hr-master-data.seeder";
import { HrSeedRegistrar } from "./hr-seed.registrar";
import { EmployeesController } from "./employees.controller";
import { EmployeesRepository } from "./employees.repository";
import { EmployeesService } from "./employees.service";
// S2-HR-BE-1 (additive): HR read core. PermissionModule (imported above) exports DataScopeService;
// AuditService comes from the @Global EventsModule (same source as EmployeesService).
import { HrReadController } from "./hr-read.controller";
import { HrReadRepository } from "./hr-read.repository";
import { HrReadService } from "./hr-read.service";
// HR-PROFILE-UI-2 (additive): employee directory CSV export (export:employee, isSensitive). Reuses
// HrReadRepository + DataScopeService + PermissionService + AuditService (all already in this module).
import { HrExportService } from "./hr-export.service";
// S2-HR-BE-2 (additive): HR write core. SequenceModule provides SequenceService (employee-code gen).
import { HrWriteController } from "./hr-write.controller";
import { HrWriteRepository } from "./hr-write.repository";
import { HrWriteService } from "./hr-write.service";
// S5-HR-IMPORT-BE-1 (additive): HR bulk employee import — parse xlsx(exceljs)/csv, per-row validate +
// dup, dryRun preview no-write, apply per-row withTenant partial-success (UNLINKED, never-provision via
// HrWriteService.createFromImportTx) + one 'employee_import' session audit. Gate import:employee (mig 0496).
import { HrImportController } from "./hr-import.controller";
import { HrEmployeeImportService } from "./hr-employee-import.service";
import { HrEmployeeImportRepository } from "./hr-import.repository";
import { HrImportParser } from "./hr-import.parser";
// S2-HR-BE-4 (additive): profile change request skeleton.
import { ProfileChangeRequestController } from "./profile-change-request.controller";
import { ProfileChangeRequestRepository } from "./profile-change-request.repository";
import { ProfileChangeRequestService } from "./profile-change-request.service";
// S2-HR-BE-7 (additive): employee-code CONFIG admin (GET/PATCH config + POST preview via SequenceService).
import { EmployeeCodeConfigController } from "./employee-code-config.controller";
import { EmployeeCodeConfigRepository } from "./employee-code-config.repository";
import { EmployeeCodeConfigService } from "./employee-code-config.service";
// S2-HR-BE-6 (additive): employee contracts (hợp đồng lao động) CRUD + file link.
import { ContractController } from "./contract.controller";
import { ContractRepository } from "./contract.repository";
import { ContractService } from "./contract.service";
// S2-FND-BE-4 (additive): HR contract file-access resolver — registered into the shared FilePolicyService
// so contract-linked files (module='HR', entity='contract') no longer fail-closed to 'deny-no-resolver'.
import { HrContractFileResolver } from "./hr-contract-file.resolver";
// S2-HR-EMPFILE-1 (additive): employee file (hồ sơ đính kèm) — controller/service/repo + resolver
// (module='HR', entity='employee_profile') registered into the shared FilePolicyService in onModuleInit.
import { EmployeeFileController } from "./employee-file.controller";
import { EmployeeFileRepository } from "./employee-file.repository";
import { EmployeeFileService } from "./employee-file.service";
import { EmployeeFileResolver } from "./employee-file.resolver";
// S5-HR-ORGCHART-BE-1 (additive): org-chart cây nhân sự (GET /hr/org-chart/employees). Reuses
// DataScopeService (PermissionModule) + DatabaseService — no new module import needed.
import { HrOrgChartController } from "./hr-org-chart.controller";
import { HrOrgChartService } from "./hr-org-chart.service";
import { HrOrgChartRepository } from "./hr-org-chart.repository";

@Module({
  imports: [
    DatabaseModule,
    // PermissionModule exports ValkeyService (import session store) + the permission stack/guards.
    PermissionModule,
    // CS-9: SecurityPolicyService cho email-domain check ở tạo tài khoản (resolveUserId).
    SecurityPolicyModule,
    // S2-HR-BE-2: SequenceService cho auto-sinh employee_code (FOR UPDATE, 0-dup).
    SequenceModule,
    // S2-HR-BE-6: FileService cho link file hợp đồng (entity 'contract').
    FilesModule,
    // S2-HR-BE-6 scope FIX: SettingService cho ngưỡng cảnh báo hết hạn company-configurable.
    SettingsModule,
    // S2-FND-SEED-2: MasterDataSeederRegistry cho HrSeedRegistrar (đăng ký HrMasterDataSeeder).
    SeedModule,
    MulterModule.register({ limits: { fileSize: 5 * 1024 * 1024 } }),
  ],
  controllers: [
    EmployeesController,
    HrReadController,
    HrWriteController,
    ProfileChangeRequestController,
    // S2-HR-BE-7 (additive): employee-code config admin controller.
    EmployeeCodeConfigController,
    // S2-HR-BE-6 (additive): employee contracts controller.
    ContractController,
    // S2-HR-EMPFILE-1 (additive): employee file controller (/hr/employees/:id/files).
    EmployeeFileController,
    // S5-HR-IMPORT-BE-1 (additive): bulk employee import controller (/hr/employees/import + /template).
    HrImportController,
    // S5-HR-ORGCHART-BE-1 (additive): org-chart controller (/hr/org-chart/employees).
    HrOrgChartController,
  ],
  // PasswordService is stateless (argon2) — provided locally to hash generated login passwords (F7).
  providers: [
    EmployeesService,
    EmployeesRepository,
    PasswordService,
    // S2-HR-BE-1 (additive): HR read core providers.
    HrReadService,
    HrReadRepository,
    // HR-PROFILE-UI-2 (additive): employee directory CSV export service.
    HrExportService,
    // S2-HR-BE-2 (additive): HR write core providers.
    HrWriteService,
    HrWriteRepository,
    // S5-HR-IMPORT-BE-1 (additive): bulk employee import providers (reuse HrWriteService.createFromImportTx +
    // DataScopeService/PermissionModule + AuditService@Global — no new module import needed).
    HrEmployeeImportService,
    HrEmployeeImportRepository,
    HrImportParser,
    // S2-HR-BE-4 (additive): profile change request providers.
    ProfileChangeRequestService,
    ProfileChangeRequestRepository,
    // S2-HR-BE-7 (additive): employee-code config admin providers.
    EmployeeCodeConfigService,
    EmployeeCodeConfigRepository,
    // S2-HR-BE-6 (additive): employee contracts providers.
    ContractService,
    ContractRepository,
    // S2-FND-BE-4 (additive): HR contract file-access resolver (registered in onModuleInit below).
    HrContractFileResolver,
    // S2-HR-EMPFILE-1 (additive): employee file providers + resolver (registered in onModuleInit below).
    EmployeeFileService,
    EmployeeFileRepository,
    EmployeeFileResolver,
    // S2-FND-SEED-2 (additive): HR master-data seeder + self-registering registrar (mirror ATT/LEAVE).
    HrMasterDataSeeder,
    HrSeedRegistrar,
    // S5-HR-ORGCHART-BE-1 (additive): org-chart service + repo.
    HrOrgChartService,
    HrOrgChartRepository,
  ],
  exports: [
    EmployeesService,
    HrReadService,
    HrWriteService,
    ProfileChangeRequestService,
    ContractService,
  ],
})
export class EmployeesModule implements OnModuleInit {
  /**
   * S2-FND-BE-4 — register the HR contract file-access resolver into the shared singleton
   * FilePolicyService at bootstrap. FilePolicyService comes from FilesModule (imported above, same
   * container instance), so this governs view/download/link/delete/unlink for module='HR' entity='contract'
   * link rows. ADDITIVE — no app.module.ts touch, no rewrite of the FilePolicy registry (append-only wiring).
   */
  constructor(
    private readonly filePolicy: FilePolicyService,
    private readonly hrContractFileResolver: HrContractFileResolver,
    // S2-HR-EMPFILE-1 (additive): employee-file resolver for (HR, employee_profile).
    private readonly employeeFileResolver: EmployeeFileResolver,
  ) {}

  onModuleInit(): void {
    this.filePolicy.registerResolver(this.hrContractFileResolver);
    // S2-HR-EMPFILE-1 (additive): register (HR, employee_profile) — distinct entity_type from 'contract',
    // so no duplicate-key clash in FilePolicyService.registerResolver (append-only wiring).
    this.filePolicy.registerResolver(this.employeeFileResolver);
  }
}
