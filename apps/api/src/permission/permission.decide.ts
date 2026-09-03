/**
 * HR-PERF-1 (beBatchPermHr) — pure 4-tier decision function, SHARED by can() and canBatch().
 *
 * Extracted verbatim from PermissionService.can() (§3b of G3-permission-engine.md) so there is
 * ONE source of truth for the decision semantics. can() and canBatch() differ ONLY in the FETCH
 * layer (single vs batched grant reads); the DECIDE layer is this function — they can never drift.
 *
 * Priority (lower number = higher authority):
 *   1. Object-level DENY  → deny-explicit (immediate)
 *   2. Object-level ALLOW → allow (beats company-level; object grants are always exact — no wildcards)
 *   3. Company-level DENY (any role DENY across all roles) → deny-explicit
 *   3b. F2 object-grant requirement (reveal-secret class) → deny-object-required
 *   4. Company-level ALLOW → allow (wildcards valid for non-sensitive only)
 *   5. Default            → deny-default
 *
 * Sensitive gate: wildcard grants (*:*) do NOT satisfy; requires exact non-wildcard ALLOW.
 * Defense-in-depth: effectivelySensitive = input.isSensitive OR any matching grant.isSensitive.
 * expires_at: re-checked here (cache-hit safety — the caller passes RAW grants, filter is applied here).
 * This function NEVER throws — the caller owns fail-closed error handling around the fetch.
 */
import { DATA_SCOPES, type DataScope } from "@mediaos/contracts";
import type {
  CanInput,
  CompanyRoleGrant,
  CompanyRoleGrantWithScope,
  ObjectGrant,
  PermissionDecision,
} from "./permission.types";

/**
 * Pure decision. `rawCompanyGrants` may include expired rows (cache scenario) — expiry is
 * re-checked here. `objectGrants` are the object_permissions for THIS (resourceType, resourceId);
 * pass [] for a type-level check (resourceId null/undefined) so the object-tier is skipped.
 */
export function decideCan(
  rawCompanyGrants: CompanyRoleGrant[],
  objectGrants: ObjectGrant[],
  input: CanInput,
  now: Date,
): PermissionDecision {
  const {
    action,
    resourceType,
    resourceId,
    isSensitive = false,
    requiresReauth = false,
    objectGrantRequired,
    ctx,
  } = input;

  // Re-check expiresAt here — expires_at safety rule from §3b (repository may hand us stale/cached rows).
  const companyGrants = rawCompanyGrants.filter((g) => isGrantActive(g.expiresAt, now));

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

    // Priority 2: object-level ALLOW. Object grants are inherently exact (no wildcards), so they
    // satisfy the sensitive gate — they ARE the explicit grant the sensitive gate requires.
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

  // ── Company-tier (priority 3) ─────────────────────────────────────────
  // Any company-level DENY from ANY role (deny-overrides-across-roles). Wildcard DENY also matches.
  if (companyGrants.some((g) => matchesCompanyGrant(g) && g.effect === "DENY")) {
    return { allow: false, reason: "deny-explicit", auditRequired: isSensitive };
  }

  // ── F2 object-grant requirement (crown-jewel, ADR-0010) ────────────────
  // reveal-secret class needs a per-object (Tier-3) ALLOW. Reaching here means NO object ALLOW matched.
  // Company-level ALLOW — even super-admin *:* — is NOT sufficient. Fail-closed DENY.
  const needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth);
  if (needsObjectGrant) {
    return { allow: false, reason: "deny-object-required", auditRequired: true };
  }

  const companyAllows = companyGrants.filter((g) => matchesCompanyGrant(g) && g.effect === "ALLOW");

  // Defense-in-depth: sensitive if EITHER the caller flags it OR any matching grant is is_sensitive.
  const effectivelySensitive = isSensitive || companyAllows.some((g) => g.isSensitive);

  if (effectivelySensitive) {
    // Sensitive gate: wildcards (*) do NOT satisfy — require exact (non-wildcard) ALLOW.
    const explicitAllows = companyAllows.filter((g) => g.action !== "*" && g.resourceType !== "*");
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
}

/** Scope strength order (BACKEND-03 §18.1): higher = wider visibility. */
const SCOPE_STRENGTH: Record<DataScope, number> = {
  Own: 1,
  Team: 2,
  Department: 3,
  Company: 4,
  System: 5,
};

/** Narrows an arbitrary string to a known DataScope, or null when it is not a recognised scope. */
function normalizeScope(value: string): DataScope | null {
  return (DATA_SCOPES as readonly string[]).includes(value) ? (value as DataScope) : null;
}

/** One (action, resourceType) question asked of a grant set. `isSensitive` is the CALLER hint. */
export interface ScopeRequest {
  action: string;
  resourceType: string;
  isSensitive?: boolean;
}

/**
 * S14-PERF-DASHACTOR-1 — pure strongest-scope resolver, SHARED by resolveStrongestScope() and
 * resolveStrongestScopes(). Body moved VERBATIM out of PermissionService.resolveStrongestScope so
 * there is ONE source of truth for the scope semantics — exactly the split decideCan() made for
 * can()/canBatch(): the two entry points differ ONLY in the FETCH layer (1 pair vs N pairs over the
 * SAME grant set), never in the DECIDE layer.
 *
 * Algorithm (PIN chống nới scope ngầm — BACKEND-03 §18, plan-review):
 *   1. DENY-overrides (wildcard-aware) khớp → null (chặn, ưu tiên cao nhất).
 *   2. Mỗi grant đóng góp ĐÚNG dataScope của chính nó — KHÔNG nâng cấp (vd: *:* mang 'Company' KHÔNG thành System).
 *   3. Sensitive (caller-hint HOẶC grant.isSensitive) → chỉ EXACT non-wildcard ALLOW đủ điều kiện (mirror can()).
 *   4. EXACT > WILDCARD: có exact ALLOW đủ điều kiện → mạnh nhất trong exact; else (non-sensitive) → mạnh nhất wildcard.
 *   5. Không đủ điều kiện → null.
 *
 * ⚠️ INTERNAL — như `decideCan`, hàm này NEVER throws và KHÔNG tự fail-closed: **người gọi sở hữu
 * try/catch**. Gọi thẳng hàm này thay vì đi qua PermissionService là bỏ mất vỏ fail-closed
 * (lỗi hạ tầng sẽ nổ ra ngoài thay vì thành `null` = deny).
 *
 * `rawGrants` có thể chứa hàng đã hết hạn (kịch bản cache) — expiry được lọc LẠI ở đây, mirror decideCan.
 */
export function decideStrongestScope(
  rawGrants: CompanyRoleGrantWithScope[],
  req: ScopeRequest,
  now: Date,
): DataScope | null {
  const { action, resourceType, isSensitive } = req;
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
    (isSensitive ?? false) || allowMatches.some((grant) => grant.isSensitive);

  let eligible: CompanyRoleGrantWithScope[];
  if (effectivelySensitive) {
    // Mirror can(): only exact (non-wildcard) ALLOW satisfies a sensitive pair.
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
}

/** Returns true when the grant is active (not expired). Treats malformed dates as expired. */
export function isGrantActive(expiresAt: Date | null, now: Date): boolean {
  if (expiresAt == null) return true;
  if (!(expiresAt instanceof Date) || isNaN(expiresAt.getTime())) return false;
  return expiresAt > now;
}

/** Returns true when the reauth window is still valid. */
export function isReauthValid(reauthValidUntil: Date | null | undefined, now: Date): boolean {
  if (reauthValidUntil == null) return false;
  if (!(reauthValidUntil instanceof Date) || isNaN(reauthValidUntil.getTime())) return false;
  return reauthValidUntil > now;
}
