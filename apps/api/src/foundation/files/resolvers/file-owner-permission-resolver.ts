/**
 * FOUNDATION-BE-5 — Module-owned file access resolver contract.
 *
 * Spec: BACKEND-04 §11.4 (FileOwnerPermissionResolver) · BACKEND-11 §11.10 (dispatch by
 * module_code/entity_type). A business module (HR / LEAVE / TASK / …) implements this to decide
 * whether the acting user may view/download/link/delete a file attached to one of its entities.
 *
 * The resolver receives ONLY permission metadata (FilePermissionInput) — it never sees storage_path,
 * checksum, or binary content (CLAUDE.md §2.3). Every method is tenant-scoped via input.companyId.
 *
 * Dispatch contract (registry in FilePolicyService):
 *   - `moduleCode` selects the owning module (case/whitespace-insensitive match against
 *     FilePermissionInput.moduleCode).
 *   - `entityTypes`:
 *       • `undefined` (or empty)  → the resolver matches EVERY entity_type of that module
 *         (module-wildcard).
 *       • `[...]`                 → the resolver matches ONLY the listed entity_types
 *         (case/whitespace-insensitive).
 *
 * Fail-closed: a method that returns `false` is FINAL — the policy layer does NOT escalate to the
 * FOUNDATION.FILE.* fallback. A thrown exception is treated as DENY (never a false-ALLOW).
 */

import type { FilePermissionInput } from "../file-policy.types";

export interface FileOwnerPermissionResolver {
  /** Owning module code, e.g. "HR", "LEAVE", "TASK" (case/whitespace-insensitive). */
  readonly moduleCode: string;

  /**
   * Entity types this resolver answers for. `undefined`/empty ⇒ module-wildcard (every entity of the
   * module). A non-empty list restricts dispatch to exactly those entity types
   * (case/whitespace-insensitive).
   */
  readonly entityTypes?: readonly string[];

  /** May the user VIEW this file's metadata? */
  canViewFile(input: FilePermissionInput): Promise<boolean>;

  /** May the user DOWNLOAD this file's content? */
  canDownloadFile(input: FilePermissionInput): Promise<boolean>;

  /** May the user LINK this file to the owning entity? */
  canLinkFile(input: FilePermissionInput): Promise<boolean>;

  /**
   * May the user UNLINK (soft-delete the link of) this file from the owning entity?
   *
   * OPTIONAL — added with the Unlink action (S1-FND-FILE-1). Resolvers written before Unlink existed do
   * not implement it; the policy layer treats a missing method as "no resolver verdict for Unlink" and
   * falls back to FOUNDATION.FILE.UNLINK (deny-by-default unless granted). A resolver that DOES implement
   * it takes precedence (final verdict, no escalation) exactly like the other methods.
   */
  canUnlinkFile?(input: FilePermissionInput): Promise<boolean>;

  /** May the user DELETE (soft) this file? */
  canDeleteFile(input: FilePermissionInput): Promise<boolean>;
}
