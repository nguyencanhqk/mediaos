/**
 * StorageAdapter PORT — the single boundary between FileService (and future modules) and the
 * underlying object-storage implementation (S3/MinIO/R2).
 *
 * BẤT BIẾN (CLAUDE.md §2.3):
 *   - `storage_path` (raw key) is NEVER returned to callers outside this module boundary.
 *   - `signedUrl` produces EPHEMERAL, short-lived URLs only (presign TTL configurable, default from env).
 *   - Server ALWAYS derives the key; callers supply only domain-level inputs (companyId, fileId, etc.).
 *   - `get` re-asserts cross-tenant key ownership before signing (belt-and-suspenders on top of RLS).
 *   - `stat`/`getBytes` (S2-FND-FILE-2 confirm-upload flow) ALSO re-assert cross-tenant key ownership
 *     before touching the SDK — same guard as `get`. Neither returns the raw key to the caller.
 *
 * Six methods (put / get / delete / signedUrl / stat / getBytes) are the only object-storage
 * operations exposed to upper layers. Implementations inject the token `STORAGE_ADAPTER` (see below).
 */

/** Default TTL for presigned URLs when no explicit override is passed. Must come from env — never a
 *  hard-coded magic number. A constant here means "used in tests and as the canonical default". */
export const DEFAULT_PRESIGN_TTL_SEC = 300; // 5 min — matches S3_PRESIGN_TTL_SEC default in env.schema

/** Injection token for the StorageAdapter provider. */
export const STORAGE_ADAPTER = Symbol("STORAGE_ADAPTER");

// ─── Port I/O types ──────────────────────────────────────────────────────────────────────────────

/** Input for a server-side direct PUT (e.g. export worker, thumbnail generator). */
export interface StoragePutInput {
  /** Tenant-scoped, server-derived key (e.g. from buildFileKey). */
  key: string;
  /** Binary or text body to upload. */
  body: Uint8Array | string;
  /** MIME content type for the stored object. */
  contentType: string;
}

/**
 * Input for a presigned GET (download intent). The adapter re-asserts key ∈ tenant prefix before
 * signing (CLAUDE.md §2.1 — company_id on every query).
 */
export interface StorageGetInput {
  /** Storage key for the object to download. */
  key: string;
  /** Owning company — used to assert the key is inside this tenant's prefix. */
  companyId: string;
  /** Optional TTL override in seconds (uses DEFAULT_PRESIGN_TTL_SEC when absent). */
  presignTtlSec?: number;
}

/** Result of a presigned URL operation. Callers MUST NOT persist `url` — it is ephemeral. */
export interface SignedUrlResult {
  /** The short-lived presigned URL. MUST NOT be stored; use only transiently. */
  url: string;
  /** UTC epoch ms at which the URL expires. Derived from request time + TTL. */
  expiresAt: Date;
}

/** Input for a presigned PUT (upload intent — client uploads directly to S3). */
export interface StorageSignedUploadInput {
  /** Server-derived, tenant-scoped key for the object. */
  key: string;
  /** Content type the client must declare on upload. */
  contentType: string;
  /** Expected byte size — S3 pins ContentLength to prevent oversized uploads. */
  sizeBytes: number;
  /** Optional TTL override in seconds (uses DEFAULT_PRESIGN_TTL_SEC when absent). */
  presignTtlSec?: number;
}

/** Input for a hard-delete of a stored object. */
export interface StorageDeleteInput {
  /** Tenant-scoped, server-derived key of the object to remove. */
  key: string;
}

/**
 * Input for a stat/HEAD check (S2-FND-FILE-2 confirm-upload flow) — verify an object landed in
 * storage after a client presigned-PUT, WITHOUT reading its bytes.
 */
export interface StorageStatInput {
  /** Storage key to check. */
  key: string;
  /** Owning company — used to assert the key is inside this tenant's prefix. */
  companyId: string;
}

/**
 * Result of a stat/HEAD check. `exists=false` ⇒ `sizeBytes` is `null` (object absent from storage —
 * e.g. the client never completed the presigned-PUT). Implementations MUST NOT throw for a missing
 * object; only genuine transport/auth errors should propagate.
 */
export interface StorageStatResult {
  /** Whether the object exists at `key`. */
  exists: boolean;
  /** Actual ContentLength reported by storage, or `null` when `exists` is `false`. */
  sizeBytes: number | null;
}

/**
 * Input for a byte-read (S2-FND-FILE-2 confirm-upload flow) — read the full object body so the
 * caller can compute a server-side checksum (e.g. SHA-256). NOT for general download: downloads
 * always go through the ephemeral presigned `get` URL, never a server-side byte-proxy.
 */
export interface StorageReadBytesInput {
  /** Storage key to read. */
  key: string;
  /** Owning company — used to assert the key is inside this tenant's prefix. */
  companyId: string;
}

// ─── Port interface ──────────────────────────────────────────────────────────────────────────────

/**
 * StorageAdapter — the PORT (abstraction) every caller must inject via `STORAGE_ADAPTER`.
 *
 * ```
 * @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter
 * ```
 *
 * Methods:
 *  - `put`        — server-side direct PUT (bytes already in server memory, e.g. export worker).
 *  - `get`        — presigned GET URL for client download (ephemeral, short-lived).
 *  - `delete`     — hard-delete the stored object (guarded by business-layer soft-delete logic).
 *  - `signedUrl`  — presigned PUT URL for direct client upload (ephemeral, short-lived).
 */
export interface StorageAdapter {
  /**
   * Direct server-side PUT. Uploads `body` to `key`. Validates key before touching the SDK.
   */
  put(input: StoragePutInput): Promise<void>;

  /**
   * Returns a presigned GET URL for `key`, scoped to `companyId`.
   * The adapter MUST re-assert `key` is inside the tenant prefix (cross-tenant guard).
   * Result URL is ephemeral — MUST NOT be persisted by the caller.
   */
  get(input: StorageGetInput): Promise<SignedUrlResult>;

  /**
   * Delete the object at `key`. Caller is responsible for business-layer soft-delete first
   * (the adapter performs the physical removal).
   */
  delete(input: StorageDeleteInput): Promise<void>;

  /**
   * Returns a presigned PUT URL for a client direct-upload to `key`.
   * Result URL is ephemeral — MUST NOT be persisted by the caller.
   */
  signedUrl(input: StorageSignedUploadInput): Promise<SignedUrlResult>;

  /**
   * HEAD the object at `key` — returns whether it exists and its actual ContentLength in storage
   * (S2-FND-FILE-2 confirm-upload flow: verify a client's presigned-PUT actually landed BEFORE the
   * caller marks a file row `Uploaded`). Re-asserts `key ∈ companyId` prefix before the SDK call.
   * Never throws for a missing object — returns `{ exists: false, sizeBytes: null }`.
   */
  stat(input: StorageStatInput): Promise<StorageStatResult>;

  /**
   * Reads the full object body as bytes — used ONLY to compute a server-side checksum during confirm
   * (S2-FND-FILE-2). Re-asserts `key ∈ companyId` prefix before the SDK call. NOT for general
   * download (downloads always go through the ephemeral presigned `get` URL).
   */
  getBytes(input: StorageReadBytesInput): Promise<Uint8Array>;
}
