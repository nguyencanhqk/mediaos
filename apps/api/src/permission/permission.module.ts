import { Inject, Injectable, Logger, Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { EventBus, type EventContext } from "../events/event-bus";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { AuthModule } from "../auth/auth.module";
import { PermissionService } from "./permission.service";
import { PermissionRepository } from "./permission.repository";
import { CachedPermissionRepository } from "./permission.cache";
import { ValkeyService } from "./valkey.service";
import { PermissionAdminController } from "./permission-admin.controller";
import { PermissionAdminService } from "./permission-admin.service";
import { PermissionAdminRepository } from "./permission-admin.repository";
// S2-AUTH-BE-3 (additive): read-only catalogs cho UI gán quyền (GET /auth/roles · /auth/permissions).
import { AuthRolesPermissionsController } from "./auth-roles-permissions.controller";
// S2-AUTH-BE-6 (additive): role WRITE (create/update, KHÔNG sửa system role) + assign/revoke permission
// cho role (POST/PATCH /auth/roles·/:id/permissions). KHÔNG đụng factory permission cũ (hot-file APPEND).
import { RoleAdminController } from "./role-admin.controller";
import { RoleAdminService } from "./role-admin.service";
import { RoleAdminRepository } from "./role-admin.repository";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { CompanyGuard } from "./guards/company.guard";
import { PermissionGuard } from "./guards/permission.guard";
import { SuperAdminBootstrapService } from "./super-admin-bootstrap.service";
import { SuperAdminBootstrapRepository } from "./super-admin-bootstrap.repository";
import { DataScopeService } from "./data-scope.service";
import { DataScopeRepository } from "./data-scope.repository";

const CACHED_REPO = "CACHED_PERMISSION_REPO";

/**
 * Subscribes to permission.changed events and invalidates Valkey cache for the affected user.
 * Idempotent: DEL is safe to call multiple times.
 *
 * ⚠️ CONTRACT (G3-4 DoD — re-review 2026-06-09, docs/reviews/g3-gates.md §4.1):
 * This invalidator only CONSUMES `permission.changed`. As of the G3 mutation-path lane it is EMITTED by
 * `PermissionAdminService` (assign/revoke role + set/remove object-permission) — each mutation, in the
 * SAME tx, (1) writes an audit_logs row and (2) enqueues `permission.changed { userId, companyId }`
 * (role-subject object-grant fans out one event per user holding the role). ANY future code that
 * mutates `user_roles` / `role_permissions` / `object_permissions` MUST keep the same contract,
 * otherwise capabilities stay stale for up to 300s (TTL) and the privilege change is unaudited.
 * The `grant-object-permission:permission` (0037) and `assign-role:user` (0140) guard permissions are
 * pre-seeded + granted to company-admin so the endpoints don't deny by default (F2/G4 catalog trap).
 */
@Injectable()
class PermissionCacheInvalidator implements OnModuleInit {
  private readonly logger = new Logger(PermissionCacheInvalidator.name);

  constructor(
    private readonly bus: EventBus,
    @Inject(CACHED_REPO) private readonly cachedRepo: CachedPermissionRepository,
  ) {}

  onModuleInit(): void {
    this.bus.register({
      consumerName: "permission-cache-invalidator",
      eventType: "permission.changed",
      handle: async (ctx: EventContext): Promise<void> => {
        const payload = ctx.payload;
        if (typeof payload !== "object" || payload === null) {
          this.logger.warn("permission.changed event has non-object payload", {
            eventId: ctx.eventId,
          });
          return;
        }
        const { userId, companyId } = payload as { userId?: string; companyId?: string };
        if (!userId || !companyId) {
          this.logger.warn("permission.changed event missing userId/companyId", {
            eventId: ctx.eventId,
          });
          return;
        }
        try {
          await this.cachedRepo.invalidateUser(companyId, userId);
          this.logger.debug("Permission cache invalidated", { companyId, userId });
        } catch (err) {
          this.logger.error(
            "Failed to invalidate permission cache — stale grants possible for up to 300s",
            {
              companyId,
              userId,
              eventId: ctx.eventId,
              error: err instanceof Error ? err.message : String(err),
            },
          );
          throw err;
        }
      },
    });
  }
}

/**
 * PermissionModule (G3-4) — full permission stack.
 *
 * Guard pipeline: JwtAuthGuard → CompanyGuard → PermissionGuard.
 * Cache: CachedPermissionRepository (Valkey, TTL 300s) wraps PermissionRepository (DB).
 * Invalidation: permission.changed event → PermissionCacheInvalidator → DEL cap key (<100ms target).
 */
@Module({
  imports: [DatabaseModule, EventsModule, forwardRef(() => AuthModule)],
  controllers: [PermissionAdminController, AuthRolesPermissionsController, RoleAdminController],
  providers: [
    ValkeyService,
    PermissionRepository,
    PermissionAdminRepository,
    PermissionAdminService,
    // S2-AUTH-BE-6 (additive): role WRITE stack.
    RoleAdminRepository,
    RoleAdminService,
    {
      provide: CACHED_REPO,
      useFactory: (repo: PermissionRepository, valkey: ValkeyService): CachedPermissionRepository =>
        new CachedPermissionRepository(repo, valkey),
      inject: [PermissionRepository, ValkeyService],
    },
    {
      provide: PermissionService,
      useFactory: (cachedRepo: CachedPermissionRepository): PermissionService =>
        new PermissionService(cachedRepo),
      inject: [CACHED_REPO],
    },
    PermissionCacheInvalidator,
    JwtAuthGuard,
    CompanyGuard,
    PermissionGuard,
    // S2-AUTH-SEED-1 / L2 (additive): seed super-admin company-scoped lúc khởi động (runtime, không migration).
    // PasswordService đến từ forwardRef(AuthModule); AuditService/OutboxService từ EventsModule (@Global);
    // DatabaseService từ DatabaseModule (@Global). KHÔNG đụng factory permission cũ (hot-file APPEND).
    SuperAdminBootstrapRepository,
    SuperAdminBootstrapService,
    // S2-AUTH-BE-2 (additive): shared data-scope resolver. DataScopeRepository injects DatabaseService
    // (@Global); DataScopeService injects PermissionService (provided above) + DataScopeRepository.
    // Exported so HR-BE-1 (and later ATT/LEAVE/TASK) can inject it. KHÔNG đụng factory cũ (hot-file APPEND).
    DataScopeRepository,
    DataScopeService,
  ],
  exports: [
    PermissionService,
    ValkeyService,
    JwtAuthGuard,
    CompanyGuard,
    PermissionGuard,
    DataScopeService,
  ],
})
export class PermissionModule {}
