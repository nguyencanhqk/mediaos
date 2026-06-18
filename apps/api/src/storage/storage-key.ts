/**
 * Storage key derivation + validation (B4 task attachments).
 *
 * BẤT BIẾN: the client NEVER supplies a storage key/path. The server derives a tenant-scoped key
 * `{companyId}/tasks/{taskId}/{uuid}` and validates it against path-traversal BEFORE it ever reaches
 * the S3 SDK. This is the single choke-point that prevents writing/reading outside a tenant's prefix.
 *
 * Pure module (no I/O) → fully unit-testable without network.
 */

/** Thrown when a storage key is malformed or attempts path traversal. */
export class InvalidStorageKeyError extends Error {
  constructor(reason: string) {
    super(`Invalid storage key: ${reason}`);
    this.name = "InvalidStorageKeyError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Each path SEGMENT must contain only safe chars (hyphen/underscore + alphanumerics — covers a UUID).
// No dots, no slashes inside a segment, no whitespace. Strict because every segment we generate is a UUID.
const SEGMENT_RE = /^[0-9a-zA-Z_-]+$/;

/**
 * Tenant prefix for a task's attachments. SERVER-derived; companyId/taskId are validated UUIDs from
 * the authenticated request context, never free-form client input.
 */
export function attachmentPrefix(companyId: string, taskId: string): string {
  if (!UUID_RE.test(companyId)) throw new InvalidStorageKeyError("companyId is not a uuid");
  if (!UUID_RE.test(taskId)) throw new InvalidStorageKeyError("taskId is not a uuid");
  return `${companyId}/tasks/${taskId}`;
}

/**
 * Build the full object key for a new attachment. `objectId` is a server-generated UUID (the
 * attachment row id) — it is NOT derived from the client filename, so the filename can never affect
 * the key (the human filename is stored only as metadata).
 */
export function buildAttachmentKey(companyId: string, taskId: string, objectId: string): string {
  if (!UUID_RE.test(objectId)) throw new InvalidStorageKeyError("objectId is not a uuid");
  const key = `${attachmentPrefix(companyId, taskId)}/${objectId}`;
  // Self-check: the key we just built must pass the same validator the SDK boundary uses.
  return validateKey(key);
}

/** True if the string contains a NUL byte or any ASCII control character (0x00–0x1F or 0x7F). */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Reject any key that could escape its intended prefix or smuggle control characters.
 * Returns the key unchanged when valid; throws InvalidStorageKeyError otherwise.
 *
 * Rejected: empty; absolute (leading '/'); Windows drive (C:\) / UNC (\\); backslashes; '..' or '.'
 * segments; null bytes; ASCII control chars; empty segments (e.g. 'a//b' or trailing '/'); segments
 * with characters outside the safe allowlist.
 */
export function validateKey(key: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new InvalidStorageKeyError("empty");
  }
  // Null byte / ASCII control characters anywhere → reject (truncation / log-forging / smuggling).
  if (hasControlChar(key)) {
    throw new InvalidStorageKeyError("control character");
  }
  // Backslash → reject (Windows path / UNC share smuggling). S3 keys use forward slashes only.
  if (key.includes("\\")) {
    throw new InvalidStorageKeyError("backslash");
  }
  // Absolute path / leading slash.
  if (key.startsWith("/")) {
    throw new InvalidStorageKeyError("absolute path");
  }
  // Windows drive-letter absolute (C:, d:…).
  if (/^[a-zA-Z]:/.test(key)) {
    throw new InvalidStorageKeyError("drive-letter absolute");
  }
  if (key.endsWith("/")) {
    throw new InvalidStorageKeyError("trailing slash");
  }

  const segments = key.split("/");
  for (const seg of segments) {
    if (seg.length === 0) {
      throw new InvalidStorageKeyError("empty segment");
    }
    if (seg === "." || seg === "..") {
      throw new InvalidStorageKeyError("traversal segment");
    }
    if (!SEGMENT_RE.test(seg)) {
      throw new InvalidStorageKeyError(`illegal segment: ${seg}`);
    }
  }
  return key;
}

/**
 * Guard that a metadata-resolved key actually belongs to the current tenant before a presigned GET is
 * signed (defense-in-depth on top of RLS: the metadata row is already RLS-scoped, but we re-assert the
 * key prefix so a future code path can never sign a URL outside the tenant prefix).
 */
export function assertKeyInTenant(key: string, companyId: string): void {
  validateKey(key);
  if (!UUID_RE.test(companyId)) throw new InvalidStorageKeyError("companyId is not a uuid");
  if (!key.startsWith(`${companyId}/`)) {
    throw new InvalidStorageKeyError("key outside tenant prefix");
  }
}

/**
 * Build the object key for a db-ops export (WAVE 3 C2). Tenant-scoped prefix `{targetTenantId}/db-exports/
 * {jobId}` — both are server-side validated UUIDs (target from the job row, jobId the export job id), never
 * client free-form. No file extension (SEGMENT_RE forbids '.'); content-type is set on PUT instead. The key
 * shares the tenant prefix so assertKeyInTenant(key, targetTenantId) gates the presigned download.
 */
export function buildExportKey(targetTenantId: string, jobId: string): string {
  if (!UUID_RE.test(targetTenantId)) throw new InvalidStorageKeyError("targetTenantId is not a uuid");
  if (!UUID_RE.test(jobId)) throw new InvalidStorageKeyError("jobId is not a uuid");
  return validateKey(`${targetTenantId}/db-exports/${jobId}`);
}
