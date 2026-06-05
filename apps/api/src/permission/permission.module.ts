import { Inject, Injectable, Logger, Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
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
        const { userId, companyId } = ctx.payload as { userId?: string; companyId?: string };
        if (!userId || !companyId) {
          this.logger.warn('permission.changed event missing userId/companyId', { eventId: ctx.eventId });
          return;
        }
        await this.cachedRepo.invalidateUser(companyId, userId);
        this.logger.debug('Permission cache invalidated', { companyId, userId });
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
    Reflector,
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
