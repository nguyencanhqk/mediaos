/**
 * Types for the 4-tier permission engine (G3).
 * Algorithm spec: docs/plans/G3-permission-engine.md §3b
 * Permission matrix: docs/permission-matrix-spec.md
 */

export type PermissionReason =
  | 'allow'
  | 'deny-default' // no matching grants
  | 'deny-explicit' // explicit DENY in role_permissions or object_permissions
  | 'deny-scope' // action allowed but object is outside user's scope
  | 'deny-sensitive' // sensitive action without explicit non-wildcard ALLOW
  | 'deny-reauth-required'; // sensitive action requires re-auth, none provided/expired

export interface PermissionDecision {
  allow: boolean;
  reason: PermissionReason;
  /** true when action is reveal-secret type and re-auth is missing/expired */
  requiresReauth?: boolean;
  /** true when the action or result must be written to audit_logs */
  auditRequired: boolean;
}

export interface PermissionContext {
  /** If set, the timestamp until which a re-auth is valid (for reveal-secret). */
  reauthValidUntil?: Date | null;
  requestId?: string;
}

export interface CanInput {
  userId: string;
  companyId: string;
  action: string;
  resourceType: string;
  /**
   * null/undefined = type-level check ("may I do this in principle?") — skips Tier 3 object check.
   * When provided, full 4-tier check including object_permissions for this instance.
   */
  resourceId?: string | null;
  /**
   * True when this action is marked is_sensitive in the permissions catalog.
   * The guard/decorator sets this; service uses it to gate explicit-ALLOW requirement.
   * Wildcard (*:*) grants do NOT satisfy sensitive ALLOW.
   */
  isSensitive?: boolean;
  /**
   * True when this action requires a valid re-auth window (e.g. reveal-secret).
   * Service checks ctx.reauthValidUntil > now() before allowing.
   */
  requiresReauth?: boolean;
  ctx?: PermissionContext;
}

// ─── Repository types ────────────────────────────────────────────────────────

/**
 * A resolved grant from role_permissions (via JOIN user_roles → roles → role_permissions).
 * One row per (action, resourceType, effect, roleExpiry) tuple for a user+company.
 * action / resourceType may be '*' for wildcard grants.
 * expiresAt comes from user_roles.expires_at — service re-checks it on every can() call.
 */
export interface CompanyRoleGrant {
  action: string; // '*' = wildcard
  resourceType: string; // '*' = wildcard
  isSensitive: boolean; // from permissions.is_sensitive (false for wildcards)
  effect: 'ALLOW' | 'DENY';
  /** null = no expiry. Service MUST filter out grants where expiresAt <= now(). */
  expiresAt: Date | null;
}

/**
 * A resolved grant from object_permissions for a specific (resourceType, resourceId).
 * Object grants are always specific — no wildcards.
 */
export interface ObjectGrant {
  action: string;
  resourceType: string;
  isSensitive: boolean;
  effect: 'ALLOW' | 'DENY';
}

export interface IPermissionRepository {
  /**
   * Returns all role_permissions for all roles held by userId in companyId.
   * Includes expiresAt from user_roles — MAY include expired grants.
   * Service re-checks expiresAt (cache-hit safety for §3b expires_at rule).
   * Returns [] when user has no roles. Throws on DB/connection error.
   */
  getCompanyRoleGrants(userId: string, companyId: string): Promise<CompanyRoleGrant[]>;

  /**
   * Returns all object_permissions for userId (and user's roles) in companyId
   * scoped to the specific (resourceType, resourceId).
   * Returns [] when no object grants exist. Throws on DB/connection error.
   */
  getObjectGrants(
    userId: string,
    companyId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<ObjectGrant[]>;
}
