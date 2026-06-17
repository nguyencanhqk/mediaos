import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { SaasModule } from "../saas/saas.module";
import { TemplatesModule } from "../templates/templates.module";
import { PlatformCompanyController } from "./platform-company.controller";
import { PlatformCompanyService } from "./platform-company.service";
import { PlatformCompanyRepository } from "./platform-company.repository";
import { OperatorReauthService } from "./operator-reauth.service";
import { OperatorReauthGuard } from "./operator-reauth.guard";
import { OperatorActionAuditService } from "./operator-action-audit.service";
import { OperatorStepUpController } from "./operator-step-up.controller";
// AC-7 module-registry (lớp module trên feature-flag — reuse SaasModule FeatureFlagService/SaasRepository)
import { ModuleRegistryController } from "./module-registry.controller";
import { ModuleRegistryService } from "./module-registry.service";
import { ModuleRegistryRepository } from "./module-registry.repository";

/**
 * PlatformModule (G16-3 + AC-0b) — tầng platform-admin quản vòng đời tenant (ADR-0017).
 * Imports SaasModule (SubscriptionService — gán gói) + TemplatesModule (TemplateCloneService — provision).
 * AC-0b: + AuthModule (PasswordService + LoginRateLimiter cho operator step-up); PermissionModule export
 * ValkeyService (step-up window). forwardRef(AuthModule) vì AuthModule ⇄ PermissionModule đã forwardRef.
 */
@Module({
  imports: [
    DatabaseModule,
    EventsModule,
    PermissionModule,
    SaasModule,
    TemplatesModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [PlatformCompanyController, OperatorStepUpController, ModuleRegistryController],
  providers: [
    PlatformCompanyService,
    PlatformCompanyRepository,
    OperatorReauthService,
    OperatorReauthGuard,
    OperatorActionAuditService,
    ModuleRegistryService,
    ModuleRegistryRepository,
  ],
  exports: [PlatformCompanyService, OperatorReauthService, OperatorActionAuditService],
})
export class PlatformModule {}
