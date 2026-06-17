import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { PlatformModule } from "../platform/platform.module";
import { AuditReadController } from "./audit-read.controller";
import { AuditReadService } from "./audit-read.service";
import { QueueMonitorController } from "./queue-monitor.controller";
import { QueueMonitorService } from "./queue-monitor.service";

/**
 * ObservabilityModule (AC-8) — audit viewer (tenant self + operator cross-tenant) + queue monitor.
 *
 * Imports:
 *   - DatabaseModule (DatabaseService — withTenant + withPlatformReadContext GUC HẸP).
 *   - EventsModule (AuditService — recordOperatorAction tái dùng).
 *   - PlatformModule (OperatorActionAuditService + OperatorReauthService + OperatorReauthGuard step-up).
 *   - PermissionModule (PermissionGuard + ValkeyService cho guard).
 *   - forwardRef(AuthModule) (JwtAuthGuard pipeline @OperatorOnly — mirror PlatformModule).
 */
@Module({
  imports: [
    DatabaseModule,
    EventsModule,
    PermissionModule,
    PlatformModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [AuditReadController, QueueMonitorController],
  providers: [AuditReadService, QueueMonitorService],
})
export class ObservabilityModule {}
