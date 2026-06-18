/**
 * AC-9 db-ops constants.
 *
 * Permission (catalog mig 0345, is_sensitive=TRUE):
 *   read:db-browser  — data browser read-only (P2).
 *   manage:db-ops    — export + break-glass grant lifecycle (P3/P4).
 *
 * Audit actions (object_type='company' REUSE — KHÔNG đổi audit CHECK):
 *   operator.db_read / operator.db_export / operator.db_grant_*.
 *
 * Step-up sentinel: data-browser/export tenant-scoped step-up theo target tenant id THẬT; all-tenant
 * (migration-status) theo sentinel (mirror PLATFORM_AUDIT_SCOPE all-zero UUID).
 */

// ── Permission ────────────────────────────────────────────────────────────────────────────────────
export const DB_BROWSER_RESOURCE = "db-browser";
export const DB_BROWSER_ACTION_READ = "read";
export const DB_OPS_RESOURCE = "db-ops";
export const DB_OPS_ACTION_MANAGE = "manage";
// WAVE 3 C1 (ADR-0021): all-tenant data browse — quyền RIÊNG, blast-radius cao hơn read:db-browser.
export const DB_ALL_TENANT_RESOURCE = "db-all-tenant";
export const DB_ALL_TENANT_ACTION_READ = "read";

// ── Audit actions (REUSE object_type='company') ──────────────────────────────────────────────────────
export const AUDIT_DB_READ = "operator.db_read";
export const AUDIT_DB_ALL_TENANT_READ = "operator.all_tenant_read";
export const AUDIT_DB_EXPORT = "operator.db_export";
export const AUDIT_DB_GRANT_REQUESTED = "operator.db_grant_requested";
export const AUDIT_DB_GRANT_APPROVED = "operator.db_grant_approved";
export const AUDIT_DB_GRANT_ACTIVATED = "operator.db_grant_activated";
export const AUDIT_DB_GRANT_REVOKED = "operator.db_grant_revoked";
export const AUDIT_DB_GRANT_DENIED = "operator.db_grant_denied";

// ── Step-up sentinel cho all-tenant ops (mirror PLATFORM_AUDIT_SCOPE) ────────────────────────────────
export const PLATFORM_DB_OPS_SCOPE = "00000000-0000-0000-0000-000000000000" as const;

export const PG_UNIQUE_VIOLATION = "23505";
