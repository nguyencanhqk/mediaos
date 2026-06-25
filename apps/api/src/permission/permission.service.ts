import { Injectable, Logger } from "@nestjs/common";
import type { DataScope } from "@mediaos/contracts";
import type {
  CanInput,
  CompanyRoleGrant,
  IPermissionRepository,
  PermissionDecision,
} from "./permission.types";

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
      objectGrantRequired,
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
        (g.action === action || g.action === "*") &&
        (g.resourceType === resourceType || g.resourceType === "*");

      // ── Object-tier (priority 1–2) ────────────────────────────────────────
      if (resourceId != null) {
        const forAction = objectGrants.filter(
          (g) => g.action === action && g.resourceType === resourceType,
        );

        // Priority 1: any object-level DENY → immediate deny
        if (forAction.some((g) => g.effect === "DENY")) {
          return { allow: false, reason: "deny-explicit", auditRequired: isSensitive };
        }

        // Priority 2: object-level ALLOW
        // Object grants are inherently exact (no wildcards), so they satisfy the sensitive gate.
        // The isSensitive wildcard guard is intentionally not applied here — exact object grants
        // ARE the explicit grant that the sensitive gate requires.
        if (forAction.some((g) => g.effect === "ALLOW")) {
          if (requiresReauth && !isReauthValid(ctx?.reauthValidUntil, now)) {
            return {
              allow: false,
              reason: "deny-reauth-required",
              requiresReauth: true,
              auditRequired: true,
            };
          }
          return { allow: true, reason: "allow", auditRequired: isSensitive };
        }
      }

      // ── Company-tier (priority 3–4) ───────────────────────────────────────
      // Priority 3: any company-level DENY from ANY role (deny-overrides-across-roles).
      // Wildcard (*:*) DENY also matches — it blocks all actions.
      if (companyGrants.some((g) => matchesCompanyGrant(g) && g.effect === "DENY")) {
        return { allow: false, reason: "deny-explicit", auditRequired: isSensitive };
      }

      // ── F2 object-grant requirement (crown-jewel, ADR-0010) ────────────────
      // The reveal-secret class needs a per-object (Tier-3) ALLOW. Reaching here means NO object ALLOW
      // matched (resourceId was null → object-tier skipped above, OR object grants had no ALLOW for this
      // action). Company-level ALLOW — even an exact non-wildcard grant, even super-admin *:* — is NOT
      // sufficient. Fail-closed DENY. Derived from (isSensitive && requiresReauth) unless caller overrides.
      const needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth);
      if (needsObjectGrant) {
        return { allow: false, reason: "deny-object-required", auditRequired: true };
      }

      const companyAllows = companyGrants.filter(
        (g) => matchesCompanyGrant(g) && g.effect === "ALLOW",
      );

      // Defense-in-depth: treat as sensitive if EITHER the caller flags it (from @RequirePermission
      // decorator) OR any matching grant carries is_sensitive from the permissions catalog.
      // This prevents a misconfigured guard from bypassing the sensitive gate.
      const effectivelySensitive = isSensitive || companyAllows.some((g) => g.isSensitive);

      if (effectivelySensitive) {
        // Sensitive gate: wildcards (*) do NOT satisfy — require exact (non-wildcard) ALLOW.
        // Plan §3b: "Wildcard (*:* hoặc resource:*) KHÔNG match — chỉ exact ALLOW mới được tính."
        const explicitAllows = companyAllows.filter(
          (g) => g.action !== "*" && g.resourceType !== "*",
        );
        if (explicitAllows.length === 0) {
          return { allow: false, reason: "deny-sensitive", auditRequired: true };
        }
        if (requiresReauth && !isReauthValid(ctx?.reauthValidUntil, now)) {
          return {
            allow: false,
            reason: "deny-reauth-required",
            requiresReauth: true,
            auditRequired: true,
          };
        }
        return { allow: true, reason: "allow", auditRequired: true };
      }

      // Priority 4: non-sensitive ALLOW (wildcards valid here)
      if (companyAllows.length > 0) {
        if (requiresReauth && !isReauthValid(ctx?.reauthValidUntil, now)) {
          return {
            allow: false,
            reason: "deny-reauth-required",
            requiresReauth: true,
            auditRequired: false,
          };
        }
        return { allow: true, reason: "allow", auditRequired: false };
      }

      // ── Default deny ──────────────────────────────────────────────────────
      return { allow: false, reason: "deny-default", auditRequired: isSensitive };
    } catch (error: unknown) {
      // Fail-closed: DB/cache/network error → DENY. Never false-ALLOW on exception.
      // Log with full context so infra failures are distinguishable from legitimate denies.
      this.logger.error("permission.can() infrastructure error — fail-closed deny", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
        action,
        resourceType,
        resourceId,
        requestId: ctx?.requestId,
      });
      return { allow: false, reason: "deny-default", auditRequired: isSensitive };
    }
  }

  /**
   * AC-5 — danh sách scope (catalog entry) actor được phép gán cho PAT = toàn catalog ∩ grant THỰC actor.
   * Dùng dựng bộ chọn scope FE. Lỗi DB → [] (fail-safe cho UI hint; create vẫn ép lại scope ⊆ grant).
   */
  async listGrantableScopes(
    userId: string,
    companyId: string,
  ): Promise<Array<{ id: string; action: string; resourceType: string; isSensitive: boolean }>> {
    try {
      const catalog = await this.repo.getAllPermissions();
      if (catalog.length === 0) return [];
      const grantedIds = await this.userGrantsPermissionIds(
        userId,
        companyId,
        catalog.map((p) => p.id),
      );
      const grantedSet = new Set(grantedIds);
      return catalog.filter((p) => grantedSet.has(p.id));
    } catch (error: unknown) {
      this.logger.error("listGrantableScopes() infrastructure error — returning empty", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
      });
      return [];
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
        if (g.effect === "DENY") denyKeys.add(`${g.action}:${g.resourceType}`);
      }

      // Wildcard-aware deny check: a DENY on *:T or A:* or *:* suppresses matching ALLOW keys.
      const isDenied = (action: string, resourceType: string): boolean =>
        denyKeys.has(`${action}:${resourceType}`) ||
        denyKeys.has(`*:${resourceType}`) ||
        denyKeys.has(`${action}:*`) ||
        denyKeys.has("*:*");

      const caps: Record<string, boolean> = {};
      for (const g of grants) {
        if (g.effect === "ALLOW" && !isDenied(g.action, g.resourceType)) {
          caps[`${g.action}:${g.resourceType}`] = true;
        }
      }
      return caps;
    } catch (error: unknown) {
      this.logger.error("getCapabilities() infrastructure error — returning empty map", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
      });
      return {};
    }
  }

  /**
   * S2-AUTH-BE-1 — union data_scope cho từng cặp ALLOW non-sensitive (cho /auth/me `scopes`, BACKEND-03 §15.3
   * rule 6). KEYSET Y HỆT getCapabilities: chỉ ALLOW non-sensitive; cặp bị DENY-override (wildcard-aware) bị
   * LOẠI hoàn toàn (KHÔNG union). Mảng scope đã DEDUPE. Lỗi hạ tầng → {} (fail-safe UI hint; guard BE-2 là cổng
   * thật). Độc lập getCapabilities: nếu method này lỗi mà getCapabilities ok, /me trả caps không kèm scope —
   * chấp nhận (chỉ là gợi ý FE).
   */
  async getCapabilityScopes(
    userId: string,
    companyId: string,
  ): Promise<Record<string, DataScope[]>> {
    try {
      const now = new Date();
      const rawGrants = await this.repo.getCompanyRoleGrantsWithScope(userId, companyId);
      const grants = rawGrants.filter((g) => isGrantActive(g.expiresAt, now) && !g.isSensitive);

      const denyKeys = new Set<string>();
      for (const g of grants) {
        if (g.effect === "DENY") denyKeys.add(`${g.action}:${g.resourceType}`);
      }
      const isDenied = (action: string, resourceType: string): boolean =>
        denyKeys.has(`${action}:${resourceType}`) ||
        denyKeys.has(`*:${resourceType}`) ||
        denyKeys.has(`${action}:*`) ||
        denyKeys.has("*:*");

      const scopeSets = new Map<string, Set<DataScope>>();
      for (const g of grants) {
        if (g.effect !== "ALLOW" || isDenied(g.action, g.resourceType)) continue;
        const key = `${g.action}:${g.resourceType}`;
        const set = scopeSets.get(key) ?? new Set<DataScope>();
        set.add(g.dataScope as DataScope);
        scopeSets.set(key, set);
      }

      const out: Record<string, DataScope[]> = {};
      for (const [key, set] of scopeSets) out[key] = [...set];
      return out;
    } catch (error: unknown) {
      this.logger.error("getCapabilityScopes() infrastructure error — returning empty map", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
      });
      return {};
    }
  }

  /**
   * AC-5 — filter `permissionIds` xuống tập user THỰC SỰ được phép (effective ALLOW, đã trừ DENY-overrides
   * + bỏ wildcard). Dùng lúc TẠO PAT: scope của key PHẢI ⊆ tập này (PAT KHÔNG vượt quyền user, fail-closed).
   *
   * Cách tính: với mỗi permission id → (action, resourceType, isSensitive) qua catalog; user "có" nếu một
   * company-grant ALLOW khớp (exact với sensitive — wildcard KHÔNG thoả gate nhạy cảm, mirror can()) VÀ
   * KHÔNG bị DENY khớp (deny-overrides). Trả tập con của `permissionIds`. Lỗi DB → [] (fail-closed: không
   * giao id nào → caller từ chối tạo key vượt quyền). KHÔNG xét object-grant (PAT là company-tier capability).
   */
  async userGrantsPermissionIds(
    userId: string,
    companyId: string,
    permissionIds: string[],
  ): Promise<string[]> {
    if (permissionIds.length === 0) return [];
    try {
      const now = new Date();
      const catalog = await this.repo.getPermissionsByIds(permissionIds);
      const rawGrants = await this.repo.getCompanyRoleGrants(userId, companyId);
      const grants = rawGrants.filter((g) => isGrantActive(g.expiresAt, now));

      const matches = (g: CompanyRoleGrant, action: string, resourceType: string): boolean =>
        (g.action === action || g.action === "*") &&
        (g.resourceType === resourceType || g.resourceType === "*");

      return catalog
        .filter((p) => {
          const denied = grants.some(
            (g) => g.effect === "DENY" && matches(g, p.action, p.resourceType),
          );
          if (denied) return false;
          const allows = grants.filter(
            (g) => g.effect === "ALLOW" && matches(g, p.action, p.resourceType),
          );
          if (allows.length === 0) return false;
          // Sensitive gate: wildcard KHÔNG thoả — cần exact non-wildcard ALLOW (mirror can()).
          if (p.isSensitive) {
            return allows.some((g) => g.action !== "*" && g.resourceType !== "*");
          }
          return true;
        })
        .map((p) => p.id);
    } catch (error: unknown) {
      this.logger.error(
        "userGrantsPermissionIds() infrastructure error — fail-closed (empty set)",
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
          companyId,
        },
      );
      return [];
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
