/**
 * FOUNDATION-BE-5 — Types for the file access-policy layer.
 *
 * Spec: BACKEND-04 §11.4 (FileOwnerPermissionResolver) · BACKEND-11 §11.10 (dispatch by
 * module_code/entity_type, deny-by-default). The policy layer decides ONLY access (allow/deny)
 * over file metadata — it never touches storage_path / checksum / binary content (CLAUDE.md §2.3).
 */

/** The four guarded file actions. Map 1:1 to FOUNDATION.FILE.{VIEW|DOWNLOAD|LINK|DELETE}. */
export enum FilePolicyAction {
  View = 'View',
  Download = 'Download',
  Link = 'Link',
  Delete = 'Delete',
}

/**
 * Input to a file-policy decision. Every decision branch is tenant-scoped — companyId + userId are
 * MANDATORY (CLAUDE.md §2.1: company_id in every query / decision). fileId is optional because a
 * pre-link / pre-upload check may run before a file row exists. moduleCode/entityType/entityId
 * identify the owning business entity used for resolver dispatch (BACKEND-11 §11.10).
 *
 * NOTE: This input carries ONLY permission metadata — no storage_path, checksum, or secret. The
 * policy layer must never receive nor log file content (CLAUDE.md §2.3).
 */
export interface FilePermissionInput {
  /** Tenant scope — required on every branch (no cross-tenant leak). */
  companyId: string;
  /** Acting user — required on every branch. */
  userId: string;
  /** The file under check (optional for pre-link/pre-upload decisions). */
  fileId?: string;
  /** Owning module, e.g. "HR", "LEAVE", "TASK", "FOUNDATION" — used for resolver dispatch. */
  moduleCode: string;
  /** Owning entity type, e.g. "EmployeeContract", "LeaveAttachment" — used for resolver dispatch. */
  entityType: string;
  /** Owning entity instance id. */
  entityId: string;
  /** The action being authorized. */
  action: FilePolicyAction;
  /** Optional correlation id for fail-closed logging (NOT sensitive). */
  requestId?: string;
}

/** Decision returned by the policy layer. Deny-by-default; reason aids logging/audit (BACKEND-11). */
export interface FilePolicyDecision {
  allow: boolean;
  /** Machine-readable reason — for log/audit only, never a privilege source. */
  reason: FilePolicyReason;
}

export type FilePolicyReason =
  | 'allow-resolver' // a registered module resolver granted access
  | 'allow-foundation' // fallback FOUNDATION.FILE.* permission granted access
  | 'deny-resolver' // a registered module resolver denied access (final, no escalation)
  | 'deny-foundation' // no resolver + FOUNDATION.FILE.* permission not granted
  | 'deny-tenant' // missing/invalid tenant scope (companyId/userId)
  | 'deny-error'; // exception while deciding — fail-closed

/**
 * Maps each FilePolicyAction to the (action, resourceType) tuple consumed by
 * PermissionService.can() for the FOUNDATION.FILE.* fallback. Centralized so the permission codes
 * are not hard-coded across the service (CLAUDE.md §5 — no scattered role/permission literals).
 *
 * Permission code convention is MODULE.RESOURCE.ACTION = FOUNDATION.FILE.{VIEW|DOWNLOAD|LINK|DELETE};
 * PermissionService stores them as (resourceType="foundation-file", action="view|download|link|delete").
 * NOTE: must match the seeded catalog resource_type 'foundation-file' (migration 0435) — exact-string
 * match in PermissionService.can(), so 'file' would silently never grant (deny-by-default over-restrict).
 */
export const FOUNDATION_FILE_PERMISSION: Readonly<
  Record<FilePolicyAction, { action: string; resourceType: string }>
> = Object.freeze({
  [FilePolicyAction.View]: { action: 'view', resourceType: 'foundation-file' },
  [FilePolicyAction.Download]: { action: 'download', resourceType: 'foundation-file' },
  [FilePolicyAction.Link]: { action: 'link', resourceType: 'foundation-file' },
  [FilePolicyAction.Delete]: { action: 'delete', resourceType: 'foundation-file' },
});
