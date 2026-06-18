import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { PlatformModule } from "../platform/platform.module";
import { AllTenantBrowserService } from "./all-tenant-browser.service";
import { DataBrowserService } from "./data-browser.service";
import { DbExportJobRepository } from "./db-export-job.repository";
import { DbExportJobService } from "./db-export-job.service";
import { DbOpsController } from "./db-ops.controller";
import { DbOpsGrantRepository } from "./db-ops-grant.repository";
import { DbOpsGrantService } from "./db-ops-grant.service";
import { MigrationStatusService } from "./migration-status.service";

/**
 * DbOpsModule (🔴 AC-9 — LANE CUỐI Admin Control Plane) — operator data-ops read-only.
 *
 * Imports (mirror ObservabilityModule AC-8):
 *   - DatabaseModule (withTenant / withTransaction / runRaw).
 *   - EventsModule (AuditService).
 *   - PlatformModule (OperatorActionAuditService + OperatorReauthService + OperatorReauthGuard step-up).
 *   - PermissionModule (PermissionGuard + PermissionService).
 *   - forwardRef(AuthModule) (JwtAuthGuard pipeline @OperatorOnly).
 */
@Module({
  imports: [
    DatabaseModule,
    EventsModule,
    PermissionModule,
    PlatformModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [DbOpsController],
  providers: [
    MigrationStatusService,
    DataBrowserService,
    AllTenantBrowserService,
    DbOpsGrantService,
    DbOpsGrantRepository,
    DbExportJobService,
    DbExportJobRepository,
  ],
})
export class DbOpsModule {}
