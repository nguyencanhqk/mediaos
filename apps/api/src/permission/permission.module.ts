import { Inject, Injectable, Logger, Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../db/db.module';
import { EventsModule } from '../events/events.module';
import { EventBus, type EventContext } from '../events/event-bus';
import { AuthModule } from '../auth/auth.module';
import { PermissionService } from './permission.service';
import { PermissionRepository } from './permission.repository';
import { CachedPermissionRepository } from './permission.cache';
import { ValkeyService } from './valkey.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CompanyGuard } from './guards/company.guard';
import { PermissionGuard } from './guards/permission.guard';

const CACHED_REPO = 'CACHED_PERMISSION_REPO';

/**
 * Subscribes to permission.changed events and invalidates Valkey cache for the affected user.
 * Idempotent: DEL is safe to call multiple times.
 *
 * ⚠️ CONTRACT (G3-4 DoD — re-review 2026-06-09, docs/reviews/g3-gates.md §4.1):
 * This invalidator only CONSUMES `permission.changed`. As of MVP-0 NOTHING emits it — there is no
 * role grant/revoke nor `PATCH /permissions/object` endpoint yet, so the cache relies solely on the
 * 300s TTL. ANY future code that mutates `user_roles` / `role_permissions` / `object_permissions`
 * (G5 personnel role assignment, G7 object-permission UI) MUST, in the same transaction/outbox:
 *   1. write an audit_logs row (CLAUDE.md §8 — "audit log nếu hành động quan trọng"), and
 *   2. emit a `permission.changed` event with payload `{ userId, companyId }`,
 * otherwise capabilities stay stale for up to 300s and the privilege change is unaudited.
 * The `grant-object-permission:permission` guard permission is pre-seeded (migration 0031) so that
 * endpoint, when added, will not deny company-admin by default (avoids the F2/G4 catalog trap).
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
  providers: [
    ValkeyService,
    PermissionRepository,
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
