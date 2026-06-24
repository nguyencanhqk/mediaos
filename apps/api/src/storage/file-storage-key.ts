/**
 * File-module storage key derivation — tenant-scoped path builder for the FILE module.
 *
 * BẤT BIẾN (CLAUDE.md §2.1 + §2.3):
 *   - The CLIENT never supplies a storage key. Server derives `{companyId}/files/{fileId}` from
 *     validated UUIDs. originalName (if supplied) is stored ONLY as metadata — it NEVER affects the
 *     key (no filename injection / path-traversal via user input).
 *   - Every key produced here passes through `validateKey` + `assertKeyInTenant` (re-validation) so
 *     a future refactor cannot accidentally skip the traversal check.
 *
 * Pattern mirrors `buildAttachmentKey` / `buildExportKey` in storage-key.ts.
 * Pure module (no I/O) — fully unit-testable without network or DB.
 */

import { assertKeyInTenant, validateKey, InvalidStorageKeyError } from "./storage-key";

/** Re-export so callers can import error type from the file-storage-key namespace if preferred. */
export { InvalidStorageKeyError } from "./storage-key";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The URL-path segment that namespaces all file-module objects inside a tenant prefix. */
const FILES_SEGMENT = "files";

export interface BuildFileKeyInput {
  /** UUID of the owning company — from the authenticated request context (never free-form input). */
  companyId: string;
  /**
   * UUID of the file row — server-generated before calling this function (the actual file record id).
   * MUST be a UUID so it is safe as an S3 key segment.
   */
  fileId: string;
  /**
   * Optional human-readable original filename (e.g. "report Q1.pdf").
   * This field is INTENTIONALLY IGNORED when building the key — it is documented here only so callers
   * understand it must be stored as metadata (in the `files` table), not embedded in the object key.
   * Supplying it here does NOT cause it to appear in the key. Any path-traversal attempt via
   * originalName is therefore inert.
   */
  originalName?: string;
}

/**
 * Build the object key for a file-module attachment: `{companyId}/files/{fileId}`.
 *
 * - Both companyId and fileId are validated as UUIDs before use (NEVER accept free-form strings for
 *   key segments).
 * - originalName is deliberately ignored in key construction (no user-controlled suffix).
 * - The produced key passes `validateKey` (traversal-free) and `assertKeyInTenant` (inside prefix).
 *
 * @throws {InvalidStorageKeyError} if companyId or fileId is not a valid UUID, or if the produced
 *   key fails any traversal / format check.
 */
export function buildFileKey(input: BuildFileKeyInput): string {
  const { companyId, fileId } = input;

  if (!UUID_RE.test(companyId)) {
    throw new InvalidStorageKeyError("companyId is not a uuid");
  }
  if (!UUID_RE.test(fileId)) {
    throw new InvalidStorageKeyError("fileId is not a uuid");
  }

  const key = `${companyId}/${FILES_SEGMENT}/${fileId}`;

  // Self-check: validate + assert tenant-scoped (belt-and-suspenders).
  validateKey(key);
  assertKeyInTenant(key, companyId);

  return key;
}

/**
 * Return the tenant-scoped prefix for all file objects owned by `companyId`.
 * Useful for list/enumerate operations or bulk-delete guards.
 *
 * @throws {InvalidStorageKeyError} if companyId is not a valid UUID.
 */
export function filePrefix(companyId: string): string {
  if (!UUID_RE.test(companyId)) {
    throw new InvalidStorageKeyError("companyId is not a uuid");
  }
  return `${companyId}/${FILES_SEGMENT}`;
}
