import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import { users } from "../db/schema";
import { ValkeyService } from "../permission/valkey.service";
import { PasswordService } from "../auth/password.service";
import { LoginRateLimiter } from "../auth/login-rate-limiter";

/** Operator identity (platform-admin). companyId = home tenant (where the password lives). */
export interface OperatorUser {
  id: string;
  companyId: string;
}

/** Step-up factor — password re-auth ONLY (AC-0b: NOT TOTP). Mirrors platform-accounts reauth. */
export interface OperatorReauthFactor {
  password?: string;
}

/** Re-auth window TTL (AC-0b: 300s). Scope = (operator, targetTenant). */
const OPERATOR_REAUTH_TTL_SEC = 300;

/**
 * Valkey key for the operator step-up window. SCOPED to (operatorId, targetTenantId): a step-up for
 * tenant A CANNOT authorize a write to tenant B (different key). Exported so the guard reads the SAME
 * key the service writes (single source, no format drift) — mirrors platform-accounts `reauthKey`.
 */
export function operatorReauthKey(operatorId: string, targetTenantId: string): string {
  return `operator-reauth:${operatorId}:${targetTenantId}`;
}

/**
 * OperatorReauthService (🔒 AC-0b step-up) — password re-auth for a platform-admin before a sensitive
 * cross-tenant write. Reuses the established platform-accounts/payslip reauth pattern EXACTLY:
 *   verify password (home tenant) → mint a short Valkey window keyed (operator, targetTenant), TTL 300s,
 *   throttled per (operator, target). FAIL-CLOSED: a Valkey persist failure throws ServiceUnavailable —
 *   NEVER a false-success window (a swallowed write would make step-up look OK while the route denies).
 *
 * This lane PROVIDES the primitive (service + guard + one step-up route). It does NOT retrofit other
 * controllers. Enforcement of the window itself lives at the consuming route (the operator-action path).
 */
@Injectable()
export class OperatorReauthService {
  private readonly logger = new Logger(OperatorReauthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly valkey: ValkeyService,
    private readonly password: PasswordService,
    private readonly rateLimiter: LoginRateLimiter,
  ) {}

  /**
   * Verify the operator's password and mint a (operator, targetTenant) step-up window.
   * @throws UnauthorizedException missing/invalid password.
   * @throws HttpException(429) throttled.
   * @throws ServiceUnavailableException Valkey persist failure (fail-closed — no false success).
   */
  async stepUp(
    operator: OperatorUser,
    targetTenantId: string,
    factor: OperatorReauthFactor,
  ): Promise<{ reauthValidUntil: Date }> {
    if (!factor.password) {
      throw new UnauthorizedException("Re-authentication requires a password.");
    }
    // Throttle per (operator, targetTenant) — the cross-tenant write gate rides on THIS password check,
    // so an unthrottled endpoint is a brute-force path. Reuse the login limiter (mirror platform-accounts).
    const rlKey = `operator-reauth|${operator.id}|${targetTenantId}`;
    if (await this.rateLimiter.isLocked(rlKey)) {
      throw new HttpException(
        "Too many re-authentication attempts. Try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Password lives in the operator's HOME tenant — verify there (RLS-scoped).
    const verified = await this.db.withTenant(operator.companyId, async (tx) => {
      const [row] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, operator.id))
        .limit(1);
      if (!row) return false;
      return this.password.verify(row.passwordHash, factor.password as string);
    });
    if (!verified) {
      await this.rateLimiter.recordFailure(rlKey);
      throw new UnauthorizedException("Re-authentication failed.");
    }
    await this.rateLimiter.reset(rlKey);

    const reauthValidUntil = new Date(Date.now() + OPERATOR_REAUTH_TTL_SEC * 1000);
    // FAIL-CLOSED: surface a window-persist failure instead of a false success. set() returns true when
    // the cache is disabled (tests/no-URL) so this only fires on a real outage.
    const persisted = await this.valkey.set(
      operatorReauthKey(operator.id, targetTenantId),
      String(reauthValidUntil.getTime()),
      OPERATOR_REAUTH_TTL_SEC,
    );
    if (!persisted) {
      this.logger.warn("Operator step-up window failed to persist to Valkey — not durable", {
        operatorId: operator.id,
        targetTenantId,
      });
      throw new ServiceUnavailableException("Re-authentication temporarily unavailable. Please retry.");
    }
    return { reauthValidUntil };
  }

  /**
   * Resolve the (operator, targetTenant) step-up window. Returns the expiry Date when still valid,
   * else null (never stepped up, expired, or evicted). Used by the guard + by callers to gate a write.
   */
  async resolveWindow(operatorId: string, targetTenantId: string): Promise<Date | null> {
    const raw = await this.valkey.get(operatorReauthKey(operatorId, targetTenantId));
    if (raw == null) return null;
    const epoch = Number(raw);
    if (!Number.isFinite(epoch) || epoch <= Date.now()) return null;
    return new Date(epoch);
  }
}
