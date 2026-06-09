import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../public.decorator';
import { REQUIRE_PERMISSION, type RequirePermissionMeta } from '../require-permission.decorator';
import { PermissionService } from '../permission.service';
import type { AuthRequest } from './jwt-auth.guard';

/**
 * Request shape the guard reads: the authenticated user (JwtAuthGuard) plus the route :id param and the
 * re-auth window populated upstream (ReauthGuard / reauth endpoint, 2e). All optional — the guard only
 * consumes resourceId/reauthContext for the reveal-secret class.
 */
type ReauthAwareRequest = Partial<AuthRequest> & {
  params?: Record<string, string>;
  reauthContext?: { reauthValidUntil?: Date | null };
  requestId?: string;
};

/**
 * PermissionGuard — checks @RequirePermission metadata and calls PermissionService.can().
 *
 * Fail-closed rules (plan §4 G3-4):
 *   - Route without @RequirePermission AND without @Public → 403 (not 200, not 404)
 *   - PermissionService.can() throws (DB/infra error) → 403 (never 500)
 *   - PERMISSION_GUARD_ENABLED=false → fail-open + WARN (emergency rollback only)
 *
 * Guard order: JwtAuthGuard → CompanyGuard → PermissionGuard.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly permission: PermissionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    // Emergency rollback kill-switch (plan §8): set PERMISSION_GUARD_ENABLED=false to fail-open temporarily.
    if (process.env['PERMISSION_GUARD_ENABLED'] === 'false') {
      const killMeta = this.reflector.getAllAndOverride<RequirePermissionMeta | undefined>(
        REQUIRE_PERMISSION,
        [ctx.getHandler(), ctx.getClass()],
      );
      this.logger.warn(
        'PermissionGuard disabled via PERMISSION_GUARD_ENABLED=false — fail-open (emergency only)',
        { handler: ctx.getHandler().name, hasPermissionDecorator: !!killMeta },
      );
      return true;
    }

    const meta = this.reflector.getAllAndOverride<RequirePermissionMeta | undefined>(
      REQUIRE_PERMISSION,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!meta) {
      // Fail-closed: route missing @RequirePermission decorator → 403 (not an unguarded free pass)
      this.logger.warn('Route missing @RequirePermission decorator — fail-closed 403', {
        handler: ctx.getHandler().name,
        class: ctx.getClass().name,
      });
      throw new ForbiddenException('Route is not decorated with @RequirePermission');
    }

    const req = ctx.switchToHttp().getRequest<ReauthAwareRequest>();
    const user = req.user;
    if (!user?.id || !user.companyId) {
      throw new ForbiddenException('User context missing — ensure JwtAuthGuard + CompanyGuard run first');
    }

    // 2e0: forward Tier-3 resource + re-auth window ONLY for the reveal-secret class
    // (isSensitive && requiresReauth). Other routes stay type-level (resourceId undefined) → no behaviour
    // change for G6-1/3/4. req.reauthContext is populated upstream (ReauthGuard / reauth endpoint, 2e),
    // keyed by (userId, platform_account_id) so account A's window cannot authorize account B (RED 7b).
    const isRevealClass = !!meta.isSensitive && !!meta.requiresReauth;
    const resourceId = isRevealClass ? (req.params?.id ?? null) : undefined;
    const reauthCtx = isRevealClass
      ? { reauthValidUntil: req.reauthContext?.reauthValidUntil ?? null, requestId: req.requestId }
      : undefined;

    try {
      const decision = await this.permission.can({
        userId: user.id,
        companyId: user.companyId,
        action: meta.action,
        resourceType: meta.resourceType,
        resourceId,
        isSensitive: meta.isSensitive,
        requiresReauth: meta.requiresReauth,
        ctx: reauthCtx,
      });

      if (!decision.allow) {
        throw new ForbiddenException(`Permission denied: ${decision.reason}`);
      }

      return true;
    } catch (err) {
      // Re-throw ForbiddenException (our own denies) as-is
      if (err instanceof ForbiddenException) throw err;

      // Any other error (DB down, unexpected) → fail-closed 403
      this.logger.error('PermissionGuard.can() error — fail-closed 403', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
        action: meta.action,
        resourceType: meta.resourceType,
      });
      throw new ForbiddenException('Permission check failed — access denied');
    }
  }
}
