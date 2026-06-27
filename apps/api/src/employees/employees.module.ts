import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { DatabaseModule } from "../db/db.module";
import { PasswordService } from "../auth/password.service";
import { PermissionModule } from "../permission/permission.module";
import { SecurityPolicyModule } from "../security-policy/security-policy.module";
import { SequenceModule } from "../foundation/sequences/sequence.module";
import { EmployeesController } from "./employees.controller";
import { EmployeesRepository } from "./employees.repository";
import { EmployeesService } from "./employees.service";
// S2-HR-BE-1 (additive): HR read core. PermissionModule (imported above) exports DataScopeService;
// AuditService comes from the @Global EventsModule (same source as EmployeesService).
import { HrReadController } from "./hr-read.controller";
import { HrReadRepository } from "./hr-read.repository";
import { HrReadService } from "./hr-read.service";
// S2-HR-BE-2 (additive): HR write core. SequenceModule provides SequenceService (employee-code gen).
import { HrWriteController } from "./hr-write.controller";
import { HrWriteRepository } from "./hr-write.repository";
import { HrWriteService } from "./hr-write.service";
// S2-HR-BE-4 (additive): profile change request skeleton.
import { ProfileChangeRequestController } from "./profile-change-request.controller";
import { ProfileChangeRequestRepository } from "./profile-change-request.repository";
import { ProfileChangeRequestService } from "./profile-change-request.service";

@Module({
  imports: [
    DatabaseModule,
    // PermissionModule exports ValkeyService (import session store) + the permission stack/guards.
    PermissionModule,
    // CS-9: SecurityPolicyService cho email-domain check ở tạo tài khoản (resolveUserId).
    SecurityPolicyModule,
    // S2-HR-BE-2: SequenceService cho auto-sinh employee_code (FOR UPDATE, 0-dup).
    SequenceModule,
    MulterModule.register({ limits: { fileSize: 5 * 1024 * 1024 } }),
  ],
  controllers: [
    EmployeesController,
    HrReadController,
    HrWriteController,
    ProfileChangeRequestController,
  ],
  // PasswordService is stateless (argon2) — provided locally to hash generated login passwords (F7).
  providers: [
    EmployeesService,
    EmployeesRepository,
    PasswordService,
    // S2-HR-BE-1 (additive): HR read core providers.
    HrReadService,
    HrReadRepository,
    // S2-HR-BE-2 (additive): HR write core providers.
    HrWriteService,
    HrWriteRepository,
    // S2-HR-BE-4 (additive): profile change request providers.
    ProfileChangeRequestService,
    ProfileChangeRequestRepository,
  ],
  exports: [EmployeesService, HrReadService, HrWriteService, ProfileChangeRequestService],
})
export class EmployeesModule {}
