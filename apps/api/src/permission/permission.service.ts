import { Injectable, Logger } from "@nestjs/common";
import { DATA_SCOPES, type DataScope } from "@mediaos/contracts";
import type {
  CanInput,
  CompanyRoleGrant,
  CompanyRoleGrantWithScope,
  IPermissionRepository,
  PermissionDecision,
} from "./permission.types";

/** Scope strength order (BACKEND-03 §18.1): higher = wider visibility. */
const SCOPE_STRENGTH: Record<DataScope, number> = {
  Own: 1,
  Team: 2,
  Department: 3,
  Company: 4,
  System: 5,
};

/**
 * FIX-1-CAP-EXPOSE (S2-AUTH-BE-5) — ALLOWLIST cặp quyền NHẠY CẢM được phép PHƠI vào /auth/me `capabilities`
 * dưới dạng GỢI Ý UI (FE render/ẩn entry điều hướng, vd trang Audit-log viewer). getCapabilities() CỐ Ý lọc bỏ
 * MỌI grant sensitive (FE không được suy quyền nhạy cảm từ map gợi ý) ⇒ FE useCan() trên cặp nhạy cảm luôn
 * false. Allowlist này TÁI MỞ có kiểm soát ĐÚNG các cặp view-only ĐỌC — KHÔNG nới enforcement (cổng thật vẫn là
 * can()/PermissionGuard per-resource). Cặp = "action:resourceType" khớp SEED THẬT (mig 0340: view:audit-log
 * is_sensitive=true), KHÔNG theo mã FE. Wildcard *:* KHÔNG nằm trong allowlist ⇒ KHÔNG kế thừa (mirror sensitive
 * gate của can(): wildcard không thoả cặp nhạy cảm). Thêm cặp mới ⇒ thêm dòng ở đây (curated, append-only).
 */
const SENSITIVE_CAPABILITY_ALLOWLIST: ReadonlySet<string> = new Set<string>(["view:audit-log"]);

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
   * FIX-1-CAP-EXPOSE (S2-AUTH-BE-5) — map cờ cho các cặp NHẠY CẢM trong SENSITIVE_CAPABILITY_ALLOWLIST mà user
   * THỰC SỰ được ALLOW ở cấp-role (company-tier). getCapabilities() lọc bỏ TẤT CẢ sensitive ⇒ FE useCan() trên
   * cặp nhạy cảm luôn false (vd viewer audit-log không bao giờ render được). Method này surface CÓ KIỂM SOÁT ĐÚNG
   * cặp allowlist để FE render entry/nav. KHÔNG đổi semantics getCapabilities() (caller module-catalog giữ
   * nguyên) và KHÔNG phải cổng enforcement — can()/PermissionGuard per-resource vẫn là cổng THẬT.
   *
   * Thuật toán = Y HỆT getCapabilities (đọc getCompanyRoleGrants, isGrantActive, deny-override wildcard-aware) +
   * 2 ràng buộc:
   *   - chỉ thêm key khi cặp LITERAL "action:resourceType" ∈ allowlist ⇒ wildcard (*:* / view:*) KHÔNG khớp
   *     allowlist ⇒ KHÔNG kế thừa (mirror sensitive gate can(): wildcard không thoả cặp nhạy cảm).
   *   - deny-override tính trên TẤT CẢ active grants (DENY trên cặp nhạy cảm HOẶC wildcard *:* đều suppress) —
   *     an toàn hơn getCapabilities (vốn chỉ tính deny trên tập non-sensitive).
   * Lỗi hạ tầng → {} (fail-safe UI hint — KHÔNG fail-closed như can()).
   */
  async getAllowlistedSensitiveCapabilities(
    userId: string,
    companyId: string,
  ): Promise<Record<string, boolean>> {
    try {
      const now = new Date();
      const rawGrants = await this.repo.getCompanyRoleGrants(userId, companyId);
      const active = rawGrants.filter((g) => isGrantActive(g.expiresAt, now));

      const denyKeys = new Set<string>();
      for (const g of active) {
        if (g.effect === "DENY") denyKeys.add(`${g.action}:${g.resourceType}`);
      }
      const isDenied = (action: string, resourceType: string): boolean =>
        denyKeys.has(`${action}:${resourceType}`) ||
        denyKeys.has(`*:${resourceType}`) ||
        denyKeys.has(`${action}:*`) ||
        denyKeys.has("*:*");

      const caps: Record<string, boolean> = {};
      for (const g of active) {
        if (g.effect !== "ALLOW") continue;
        const key = `${g.action}:${g.resourceType}`;
        // Allowlist gate: chỉ cặp LITERAL nhạy cảm được phép (wildcard không có trong allowlist ⇒ loại bỏ ⇒
        // sensitive KHÔNG kế thừa qua *:*). Sau đó áp deny-override wildcard-aware (mirror getCapabilities).
        if (!SENSITIVE_CAPABILITY_ALLOWLIST.has(key)) continue;
        if (isDenied(g.action, g.resourceType)) continue;
        caps[key] = true;
      }
      return caps;
    } catch (error: unknown) {
      this.logger.error(
        "getAllowlistedSensitiveCapabilities() infrastructure error — returning empty map",
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
          companyId,
        },
      );
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
   * S2-AUTH-BE-2 — effective (strongest) data_scope cho 1 cặp (action,resourceType) ĐÃ được phép.
   * Đây là phần "scope" của cổng cuối: consumer (HR list/detail) dùng để dịch sang điều kiện query.
   *
   * Thuật toán (PIN chống nới scope ngầm — BACKEND-03 §18, plan-review):
   *   1. DENY-overrides (wildcard-aware) khớp → null (chặn, ưu tiên cao nhất).
   *   2. Mỗi grant đóng góp ĐÚNG dataScope của chính nó — KHÔNG nâng cấp (vd: *:* mang 'Company' KHÔNG thành System).
   *   3. Sensitive (caller-hint HOẶC grant.isSensitive) → chỉ EXACT non-wildcard ALLOW đủ điều kiện (mirror can()).
   *   4. EXACT > WILDCARD: có exact ALLOW đủ điều kiện → mạnh nhất trong exact; else (non-sensitive) → mạnh nhất wildcard.
   *   5. Không đủ điều kiện → null. Lỗi hạ tầng → fail-closed null (KHÁC getCapabilityScopes fail-safe {} cho UI).
   * KHÔNG đụng can() hot-path; method độc lập, read-only.
   */
  async resolveStrongestScope(
    userId: string,
    companyId: string,
    action: string,
    resourceType: string,
    opts?: { isSensitive?: boolean },
  ): Promise<DataScope | null> {
    try {
      const now = new Date();
      const rawGrants = await this.repo.getCompanyRoleGrantsWithScope(userId, companyId);
      const grants = rawGrants.filter((grant) => isGrantActive(grant.expiresAt, now));

      const matches = (grant: CompanyRoleGrantWithScope): boolean =>
        (grant.action === action || grant.action === "*") &&
        (grant.resourceType === resourceType || grant.resourceType === "*");

      // Deny-overrides-across-roles (wildcard-aware) — any matching DENY blocks all scope.
      if (grants.some((grant) => grant.effect === "DENY" && matches(grant))) return null;

      const allowMatches = grants.filter((grant) => grant.effect === "ALLOW" && matches(grant));
      if (allowMatches.length === 0) return null;

      const isExact = (grant: CompanyRoleGrantWithScope): boolean =>
        grant.action === action && grant.resourceType === resourceType;

      // Sensitive gate (mirror can() §3b): wildcard ALLOW does NOT satisfy a sensitive pair.
      const effectivelySensitive =
        (opts?.isSensitive ?? false) || allowMatches.some((grant) => grant.isSensitive);

      let eligible: CompanyRoleGrantWithScope[];
      if (effectivelySensitive) {
        // Mirror can() (:124-131): only exact (non-wildcard) ALLOW satisfies a sensitive pair.
        eligible = allowMatches.filter(isExact);
      } else {
        const exact = allowMatches.filter(isExact);
        eligible = exact.length > 0 ? exact : allowMatches;
      }
      if (eligible.length === 0) return null;

      // Strongest scope among eligible; each grant contributes its own scope (no upgrade).
      let best: DataScope | null = null;
      let bestStrength = 0;
      for (const grant of eligible) {
        const scope = normalizeScope(grant.dataScope);
        if (scope == null) continue;
        const strength = SCOPE_STRENGTH[scope];
        if (strength > bestStrength) {
          bestStrength = strength;
          best = scope;
        }
      }
      return best;
    } catch (error: unknown) {
      this.logger.error("resolveStrongestScope() infrastructure error — fail-closed null", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
        action,
        resourceType,
      });
      return null;
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

/** Narrows an arbitrary string to a known DataScope, or null when it is not a recognised scope. */
function normalizeScope(value: string): DataScope | null {
  return (DATA_SCOPES as readonly string[]).includes(value) ? (value as DataScope) : null;
}
