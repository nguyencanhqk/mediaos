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
import type {
  CanInput,
  CompanyRoleGrant,
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
