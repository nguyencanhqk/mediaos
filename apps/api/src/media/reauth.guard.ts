import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { ValkeyService } from '../permission/valkey.service';
import { reauthKey } from './platform-accounts.service';

/** Request after JwtAuthGuard: carries the user + route :id; we attach the resolved re-auth window. */
type ReauthGuardRequest = Request & {
  user?: { id?: string };
  params: Record<string, string>;
  reauthContext?: { reauthValidUntil?: Date | null };
};

/**
 * ReauthGuard (🔒 G6-2e) — populates `req.reauthContext` for the reveal-secret class ONLY.
 *
 * Reads the per-(userId, accountId) step-up window from Valkey (key written by
 * PlatformAccountsService.reauth) and, when still valid, sets `req.reauthContext.reauthValidUntil`
 * so the downstream PermissionGuard (and the service's own can()) can satisfy `requiresReauth`.
 *
 * This guard is NOT an authorization gate — it ALWAYS returns true. Enforcement is fail-closed at
 * PermissionGuard + the service. A missing/expired window simply leaves reauthContext unset, so the
 * reveal denies with 'deny-reauth-required'. Valkey is best-effort (fail-open cache): an outage
 * means no window → reveal denied, never a false-allow.
 *
 * MUST run BEFORE PermissionGuard — applied method-level on /:id/reveal as @UseGuards(ReauthGuard,
 * PermissionGuard) (NestJS runs guards left-to-right within a decorator; global JwtAuthGuard +
 * CompanyGuard still run first and set req.user).
 */
@Injectable()
export class ReauthGuard implements CanActivate {
  private readonly logger = new Logger(ReauthGuard.name);

  constructor(private readonly valkey: ValkeyService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ReauthGuardRequest>();
    const userId = req.user?.id;
    const accountId = req.params?.id;
    if (!userId || !accountId) return true; // No identity/target → no window to resolve; PermissionGuard decides.

    const raw = await this.valkey.get(reauthKey(userId, accountId));
    if (raw == null) return true; // No window (never stepped up, or expired/evicted) → reveal will deny.

    const epoch = Number(raw);
    if (!Number.isFinite(epoch)) {
      this.logger.warn('Re-auth window value is not a finite epoch — ignoring', { userId, accountId });
      return true;
    }
    if (epoch > Date.now()) {
      req.reauthContext = { reauthValidUntil: new Date(epoch) };
    }
    return true;
  }
}
