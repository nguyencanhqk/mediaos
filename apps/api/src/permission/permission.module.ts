import { Inject, Injectable, Logger, Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../db/db.module';
import { EventsModule } from '../events/events.module';
import { EventBus, type EventContext } from '../events/event-bus';
import { AuditService } from '../events/audit.service';
import { OutboxService } from '../events/outbox.service';
import { AuthModule } from '../auth/auth.module';
import { PermissionService } from './permission.service';
import { PermissionRepository } from './permission.repository';
import { CachedPermissionRepository } from './permission.cache';
import { ValkeyService } from './valkey.service';
import { PermissionAdminController } from './permission-admin.controller';
import { PermissionAdminService } from './permission-admin.service';
import { PermissionAdminRepository } from './permission-admin.repository';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CompanyGuard } from './guards/company.guard';
import { PermissionGuard } from './guards/permission.guard';

const CACHED_REPO = 'CACHED_PERMISSION_REPO';

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
      consumerName: 'permission-cache-invalidator',
      eventType: 'permission.changed',
      handle: async (ctx: EventContext): Promise<void> => {
        const payload = ctx.payload;
        if (typeof payload !== 'object' || payload === null) {
          this.logger.warn('permission.changed event has non-object payload', { eventId: ctx.eventId });
          return;
        }
        const { userId, companyId } = payload as { userId?: string; companyId?: string };
        if (!userId || !companyId) {
          this.logger.warn('permission.changed event missing userId/companyId', { eventId: ctx.eventId });
          return;
        }
        try {
          await this.cachedRepo.invalidateUser(companyId, userId);
          this.logger.debug('Permission cache invalidated', { companyId, userId });
        } catch (err) {
          this.logger.error('Failed to invalidate permission cache — stale grants possible for up to 300s', {
            companyId,
            userId,
            eventId: ctx.eventId,
            error: err instanceof Error ? err.message : String(err),
          });
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
  controllers: [PermissionAdminController],
  providers: [
    ValkeyService,
    PermissionRepository,
    PermissionAdminRepository,
    PermissionAdminService,
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
  ],
  exports: [
    PermissionService,
    ValkeyService,
    JwtAuthGuard,
    CompanyGuard,
    PermissionGuard,
  ],
})
export class PermissionModule {}
