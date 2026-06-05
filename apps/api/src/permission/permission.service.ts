import { Injectable, Logger } from '@nestjs/common';
import type {
  CanInput,
  CompanyRoleGrant,
  IPermissionRepository,
  PermissionDecision,
} from './permission.types';

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);

  constructor(private readonly repo: IPermissionRepository) {}

  /**
   * 4-tier permission check (§3b of G3-permission-engine.md).
   *
   * Priority (lower number = higher authority):
   *   1. Object-level DENY  → deny-explicit (immediate)
   *   2. Object-level ALLOW → allow (beats company-level; object grants are always exact — no wildcards)
   *   3. Company-level DENY (any role DENY across all roles) → deny-explicit
   *   4. Company-level ALLOW → allow (wildcards valid for non-sensitive only)
   *   5. Default            → deny-default
   *
   * Sensitive gate: wildcard grants (*:*) do NOT satisfy; requires exact non-wildcard ALLOW.
   * Defense-in-depth: effectivelySensitive = input.isSensitive OR any matching grant.isSensitive.
   *
   * expires_at: re-checked per call (cache-hit safety — not delegated to repository).
   * fail-closed: any DB/infrastructure error → DENY, logged, never false-ALLOW.
   */
  async can(input: CanInput): Promise<PermissionDecision> {
    const {
      userId,
      companyId,
      action,
      resourceType,
      resourceId,
      isSensitive = false,
      requiresReauth = false,
      ctx,
    } = input;

    try {
      const now = new Date();

      // ── Company-level grants ──────────────────────────────────────────────
      // Repository may include stale/expired rows (cache scenario).
      // We re-check expiresAt here — expires_at safety rule from §3b.
      const rawCompanyGrants = await this.repo.getCompanyRoleGrants(userId, companyId);
      const companyGrants = rawCompanyGrants.filter((g) => isGrantActive(g.expiresAt, now));

      // ── Object-level grants ───────────────────────────────────────────────
      // Only queried when a specific resource instance is identified.
      // null/undefined resourceId = type-level check (Tầng 1+4 only, Tầng 3 skipped).
      const objectGrants =
        resourceId != null
          ? await this.repo.getObjectGrants(userId, companyId, resourceType, resourceId)
          : [];

      // ── Helpers ───────────────────────────────────────────────────────────
      // Company grants support wildcards: action='*' matches any action, resourceType='*' any type.
      // Object grants are always specific (no wildcards).
      const matchesCompanyGrant = (g: CompanyRoleGrant): boolean =>
        (g.action === action || g.action === '*') &&
        (g.resourceType === resourceType || g.resourceType === '*');

      // ── Object-tier (priority 1–2) ────────────────────────────────────────
      if (resourceId != null) {
        const forAction = objectGrants.filter(
          (g) => g.action === action && g.resourceType === resourceType,
        );

        // Priority 1: any object-level DENY → immediate deny
        if (forAction.some((g) => g.effect === 'DENY')) {
          return { allow: false, reason: 'deny-explicit', auditRequired: isSensitive };
        }

        // Priority 2: object-level ALLOW
        // Object grants are inherently exact (no wildcards), so they satisfy the sensitive gate.
        // The isSensitive wildcard guard is intentionally not applied here — exact object grants
        // ARE the explicit grant that the sensitive gate requires.
        if (forAction.some((g) => g.effect === 'ALLOW')) {
          if (requiresReauth && !isReauthValid(ctx?.reauthValidUntil, now)) {
            return {
              allow: false,
              reason: 'deny-reauth-required',
              requiresReauth: true,
              auditRequired: true,
            };
          }
          return { allow: true, reason: 'allow', auditRequired: isSensitive };
        }
      }

      // ── Company-tier (priority 3–4) ───────────────────────────────────────
      // Priority 3: any company-level DENY from ANY role (deny-overrides-across-roles).
      // Wildcard (*:*) DENY also matches — it blocks all actions.
      if (companyGrants.some((g) => matchesCompanyGrant(g) && g.effect === 'DENY')) {
        return { allow: false, reason: 'deny-explicit', auditRequired: isSensitive };
      }

      const companyAllows = companyGrants.filter(
        (g) => matchesCompanyGrant(g) && g.effect === 'ALLOW',
      );

      // Defense-in-depth: treat as sensitive if EITHER the caller flags it (from @RequirePermission
      // decorator) OR any matching grant carries is_sensitive from the permissions catalog.
      // This prevents a misconfigured guard from bypassing the sensitive gate.
      const effectivelySensitive = isSensitive || companyAllows.some((g) => g.isSensitive);

      if (effectivelySensitive) {
        // Sensitive gate: wildcards (*) do NOT satisfy — require exact (non-wildcard) ALLOW.
        // Plan §3b: "Wildcard (*:* hoặc resource:*) KHÔNG match — chỉ exact ALLOW mới được tính."
        const explicitAllows = companyAllows.filter(
          (g) => g.action !== '*' && g.resourceType !== '*',
        );
        if (explicitAllows.length === 0) {
          return { allow: false, reason: 'deny-sensitive', auditRequired: true };
        }
        if (requiresReauth && !isReauthValid(ctx?.reauthValidUntil, now)) {
          return {
            allow: false,
            reason: 'deny-reauth-required',
            requiresReauth: true,
            auditRequired: true,
          };
        }
        return { allow: true, reason: 'allow', auditRequired: true };
      }

      // Priority 4: non-sensitive ALLOW (wildcards valid here)
      if (companyAllows.length > 0) {
        if (requiresReauth && !isReauthValid(ctx?.reauthValidUntil, now)) {
          return {
            allow: false,
            reason: 'deny-reauth-required',
            requiresReauth: true,
            auditRequired: false,
          };
        }
        return { allow: true, reason: 'allow', auditRequired: false };
      }

      // ── Default deny ──────────────────────────────────────────────────────
      return { allow: false, reason: 'deny-default', auditRequired: isSensitive };
    } catch (error: unknown) {
      // Fail-closed: DB/cache/network error → DENY. Never false-ALLOW on exception.
      // Log with full context so infra failures are distinguishable from legitimate denies.
      this.logger.error('permission.can() infrastructure error — fail-closed deny', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
        action,
        resourceType,
        resourceId,
        requestId: ctx?.requestId,
      });
      return { allow: false, reason: 'deny-default', auditRequired: isSensitive };
    }
  }

  /**
   * Returns a flat map of non-sensitive capabilities for the given user.
   * Key format: "${action}:${resourceType}" — wildcards included as-is (FE handles multi-key lookup).
   * Only non-sensitive grants; sensitive permissions require explicit per-resource checks.
   * Deny-overrides-across-roles applied: any DENY removes the key entirely.
   * On error → empty map (fail-safe for UI hints, never fail-closed like can()).
   */
  async getCapabilities(userId: string, companyId: string): Promise<Record<string, boolean>> {
    try {
      const now = new Date();
      const rawGrants = await this.repo.getCompanyRoleGrants(userId, companyId);
      const grants = rawGrants.filter((g) => isGrantActive(g.expiresAt, now) && !g.isSensitive);

      const denyKeys = new Set<string>();
      for (const g of grants) {
        if (g.effect === 'DENY') denyKeys.add(`${g.action}:${g.resourceType}`);
      }

      // Wildcard-aware deny check: a DENY on *:T or A:* or *:* suppresses matching ALLOW keys.
      const isDenied = (action: string, resourceType: string): boolean =>
        denyKeys.has(`${action}:${resourceType}`) ||
        denyKeys.has(`*:${resourceType}`) ||
        denyKeys.has(`${action}:*`) ||
        denyKeys.has('*:*');

      const caps: Record<string, boolean> = {};
      for (const g of grants) {
        if (g.effect === 'ALLOW' && !isDenied(g.action, g.resourceType)) {
          caps[`${g.action}:${g.resourceType}`] = true;
        }
      }
      return caps;
    } catch (error: unknown) {
      this.logger.error('getCapabilities() infrastructure error — returning empty map', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
      });
      return {};
    }
  }
}

/** Returns true when the grant is active (not expired). Treats malformed dates as expired. */
function isGrantActive(expiresAt: Date | null, now: Date): boolean {
  if (expiresAt == null) return true;
  if (!(expiresAt instanceof Date) || isNaN(expiresAt.getTime())) return false;
  return expiresAt > now;
}

/** Returns true when the reauth window is still valid. */
function isReauthValid(reauthValidUntil: Date | null | undefined, now: Date): boolean {
  if (reauthValidUntil == null) return false;
  if (!(reauthValidUntil instanceof Date) || isNaN(reauthValidUntil.getTime())) return false;
  return reauthValidUntil > now;
}
