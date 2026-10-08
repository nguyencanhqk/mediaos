import { Injectable, Logger } from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ATTACHMENT_ALLOWED_CONTENT_TYPES, ATTACHMENT_MAX_BYTES } from "@mediaos/contracts";
import { resolveServeDirectives } from "./content-serving";
import {
  assertPresignedGetPinsContentType,
  assertPresignedPutSignsContentType,
} from "./presign-invariants";
import { assertKeyInTenant, validateKey } from "./storage-key";
import type { StorageStatResult } from "./storage-adapter.port";

/**
 * Thrown when object storage is not configured (S3_ENDPOINT/keys/bucket missing). Fail-CLOSED: the
 * attachment feature is unavailable rather than silently writing nowhere or fabricating an endpoint.
 */
export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Object storage chưa cấu hình (S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET).");
    this.name = "StorageNotConfiguredError";
  }
}

/** Which hard ceiling an upload failed — lets the caller map to the right HTTP status (415 vs 413). */
export type UnsupportedAttachmentKind = "content-type" | "size";

/** Thrown when a content type is not in the allowlist or the declared size exceeds the ceiling. */
export class UnsupportedAttachmentError extends Error {
  readonly kind: UnsupportedAttachmentKind;

  constructor(reason: string, kind: UnsupportedAttachmentKind) {
    super(reason);
    this.name = "UnsupportedAttachmentError";
    this.kind = kind;
  }
}

/**
 * Thrown when GetObjectCommand succeeds but the SDK response has no readable Body (malformed /
 * unexpected — fail-CLOSED rather than fabricating an empty buffer, per silent-failure-hunter guard).
 */
export class StorageObjectBodyMissingError extends Error {
  constructor(key: string) {
    super(`Object storage trả về response không có Body cho key: ${key}`);
    this.name = "StorageObjectBodyMissingError";
  }
}

/**
 * How a download must be SERVED (S16-SOCIAL-FILEDISPOSITION-1). Both values are REQUIRED and come from
 * the registered metadata row of the file — never from the object as stored, never a caller's guess.
 * There is deliberately no "unknown" variant: a caller that cannot name the registered type must not
 * be able to obtain a download URL.
 */
export interface DownloadServeAs {
  /** MIME type registered for the file (the row's value, verbatim — normalization happens here). */
  registeredMimeType: string;
  /** Original file name of the row (verbatim — sanitized here before it reaches a header). */
  fileName: string;
}

const ALLOWED_CONTENT_TYPES = new Set<string>(ATTACHMENT_ALLOWED_CONTENT_TYPES);

interface StorageConfig {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  forcePathStyle: boolean;
  presignTtlSec: number;
}

/**
 * ObjectStorageService — thin wrapper over the AWS S3 SDK (works against MinIO/R2). It owns:
 *  - lazy S3Client construction from validated env (fail-closed if storage unconfigured),
 *  - content-type allowlist + max-size enforcement (defense-in-depth alongside the DTO),
 *  - presigned PUT/GET URL generation scoped to a SERVER-validated key (no client-supplied path).
 *
 * Presigned URLs are EPHEMERAL and never persisted (BẤT BIẾN #3) — they are computed on demand and
 * returned straight to the caller.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly config: StorageConfig | null;
  private client: S3Client | null = null;

  constructor() {
    // Read straight from process.env (validated at boot by env.schema). NO constructor DI param —
    // Nest would try to resolve a provider token for it and fail (the default value is ignored by DI).
    const env = process.env;
    const endpoint = env.S3_ENDPOINT;
    const accessKey = env.S3_ACCESS_KEY;
    const secretKey = env.S3_SECRET_KEY;
    const bucket = env.S3_BUCKET;
    // All four are required to enable storage; absence is fail-soft at boot (config=null) and
    // fail-CLOSED at use (assertConfigured throws). We do NOT invent defaults (no fail-open).
    if (!endpoint || !accessKey || !secretKey || !bucket) {
      this.config = null;
      return;
    }
    this.config = {
      endpoint,
      region: env.S3_REGION ?? "us-east-1",
      accessKey,
      secretKey,
      bucket,
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
      presignTtlSec: Number.parseInt(env.S3_PRESIGN_TTL_SEC ?? "300", 10) || 300,
    };
  }

  /** Whether object storage is configured (used by callers to degrade gracefully). */
  isConfigured(): boolean {
    return this.config !== null;
  }

  private assertConfigured(): StorageConfig {
    if (!this.config) throw new StorageNotConfiguredError();
    return this.config;
  }

  private getClient(): S3Client {
    const config = this.assertConfigured();
    if (!this.client) {
      this.client = new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
      });
    }
    return this.client;
  }

  /**
   * Validate a declared upload against the allowlist + size ceiling (contracts = source of truth).
   * Called at the SERVICE boundary (not only the DTO) — defense-in-depth type-confusion guard.
   */
  assertUploadAllowed(contentType: string, sizeBytes: number): void {
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new UnsupportedAttachmentError(
        `Content-type không được phép: ${contentType}`,
        "content-type",
      );
    }
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
      throw new UnsupportedAttachmentError("Kích thước file không hợp lệ.", "size");
    }
    if (sizeBytes > ATTACHMENT_MAX_BYTES) {
      throw new UnsupportedAttachmentError(
        `File vượt giới hạn ${ATTACHMENT_MAX_BYTES} bytes.`,
        "size",
      );
    }
  }

  /**
   * Presigned PUT URL for uploading bytes to `key`. The key MUST be server-derived + validated; we
   * re-validate here so this method is a hard boundary (no caller can pass a traversal key).
   *
   * What the signature actually binds (S16-SOCIAL-FILEDISPOSITION-1):
   *  - `content-length` — signed by the presigner by default;
   *  - `content-type` — signed ONLY because we pass it in `signableHeaders` (the presigner leaves it
   *    unsigned otherwise). Storage then compares the header the client sends byte-for-byte against
   *    `contentType`, so the upload must declare exactly the type authorized at intent time.
   * `assertUploadAllowed` MUST stay before signing: with no ContentType on the command the SDK would
   * sign a default type instead of failing.
   * After signing we re-check the URL (fail-closed): if `content-type` is not among the signed headers
   * we log at error level and throw `StoragePresignInvariantError` — no URL is returned.
   */
  async createUploadUrl(
    key: string,
    contentType: string,
    sizeBytes: number,
    expiresInSec?: number,
  ): Promise<string> {
    const config = this.assertConfigured();
    validateKey(key);
    this.assertUploadAllowed(contentType, sizeBytes);
    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    const url = await getSignedUrl(this.getClient(), command, {
      expiresIn: expiresInSec ?? config.presignTtlSec,
      signableHeaders: new Set(["content-type"]),
    });
    this.verifyPresigned(() => assertPresignedPutSignsContentType(url));
    return url;
  }

  /**
   * Run a post-signing self-check. On failure: log at ERROR level HERE (several callers downgrade a
   * signing failure to a warning) and rethrow — the URL is never returned. The log line carries only
   * the error's own message (operation + reason); never the URL, the object key or the signature.
   */
  private verifyPresigned(check: () => void): void {
    try {
      check();
    } catch (err) {
      const name = err instanceof Error ? err.name : "UnknownError";
      const message = err instanceof Error ? err.message : "lỗi không xác định";
      this.logger.error(`${name}: ${message} — không phát URL.`);
      throw err;
    }
  }

  /**
   * Server-side upload of bytes to `key`. UNLIKE createUploadUrl (presigned, for a CLIENT to PUT), this PUTs
   * directly from the server process (S15-PAYROLL-BE-5B: payslip PDF/ZIP). Key MUST be server-derived and is
   * re-asserted inside `companyId`'s prefix here — same cross-tenant guard as createDownloadUrl.
   */
  async putObject(
    key: string,
    body: Uint8Array | string,
    contentType: string,
    companyId: string,
  ): Promise<void> {
    const config = this.assertConfigured();
    assertKeyInTenant(key, companyId);
    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });
    await this.getClient().send(command);
  }

  /**
   * Delete object at `key`. First production caller: TEMP_FILE_CLEANUP (S15-PAYROLL-BE-5B, owner O-3/O-6).
   * Key re-asserted inside `companyId`'s prefix — a cleanup run for tenant A can never delete B's object.
   * S3 DeleteObject on an absent key succeeds (idempotent) — callers may retry freely.
   */
  async deleteObject(key: string, companyId: string): Promise<void> {
    const config = this.assertConfigured();
    assertKeyInTenant(key, companyId);
    await this.getClient().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  }

  /**
   * Presigned GET URL for downloading `key`. Caller MUST have already resolved the metadata row via
   * RLS (tenant scope) and pass the owning companyId — we re-assert the key is inside that tenant's
   * prefix before signing (belt-and-suspenders on top of RLS).
   *
   * What the response carries is decided HERE from the registered metadata (`serveAs`), not from the
   * object as stored (S16-SOCIAL-FILEDISPOSITION-1): `resolveServeDirectives` yields the response
   * content type (always a normalized `type/subtype`) and, for every type outside the explicit inline
   * list, an `attachment` disposition. Both become `response-*` query parameters, which are part of
   * the signed query — storage answers with exactly these values and rejects a URL whose values were
   * edited. An inline type passes `undefined` for the disposition (an empty string would still emit an
   * empty parameter). `X-Content-Type-Options` cannot be set through a signed parameter.
   * After signing we re-check the URL (fail-closed): no `response-content-type` ⇒ log at error level
   * and throw `StoragePresignInvariantError` — no URL is returned.
   */
  async createDownloadUrl(
    key: string,
    companyId: string,
    serveAs: DownloadServeAs,
    expiresInSec?: number,
  ): Promise<string> {
    const config = this.assertConfigured();
    assertKeyInTenant(key, companyId);
    const directives = resolveServeDirectives(serveAs.registeredMimeType, serveAs.fileName);
    const command = new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ResponseContentType: directives.responseContentType,
      ResponseContentDisposition: directives.responseContentDisposition,
    });
    const url = await getSignedUrl(this.getClient(), command, {
      expiresIn: expiresInSec ?? config.presignTtlSec,
    });
    this.verifyPresigned(() => assertPresignedGetPinsContentType(url));
    return url;
  }

  /**
   * HEAD the object at `key` (S2-FND-FILE-2 confirm-upload flow) — verify a client's presigned-PUT
   * actually landed BEFORE the caller (FileService.confirm) marks the file row 'Uploaded'. Re-asserts
   * `key ∈ companyId` prefix (cross-tenant guard) BEFORE the SDK call — mirrors createDownloadUrl.
   * Never throws for a genuinely-absent object (404/NotFound): returns
   * `{ exists: false, sizeBytes: null, contentType: null }` so the caller can set
   * upload_status='Failed' instead of crashing. Any OTHER error (transport/auth) is rethrown — an
   * unknown failure is NEVER silently reinterpreted as "object missing" (silent-failure-hunter guard).
   * `contentType` is the STORED type exactly as storage reports it (no normalization, no guessed
   * default): absent or empty ⇒ `null`, which the caller must treat as "does not match".
   */
  async statObject(key: string, companyId: string): Promise<StorageStatResult> {
    const config = this.assertConfigured();
    assertKeyInTenant(key, companyId);
    try {
      const result = await this.getClient().send(
        new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      const sizeBytes = typeof result.ContentLength === "number" ? result.ContentLength : null;
      const contentType =
        typeof result.ContentType === "string" && result.ContentType !== ""
          ? result.ContentType
          : null;
      return { exists: true, sizeBytes, contentType };
    } catch (err) {
      if (this.isNotFoundError(err)) {
        return { exists: false, sizeBytes: null, contentType: null };
      }
      throw err;
    }
  }

  /**
   * Reads the full object body as bytes (S2-FND-FILE-2 confirm-upload flow) — used ONLY to compute a
   * server-side checksum (e.g. SHA-256) during confirm. Re-asserts `key ∈ companyId` prefix BEFORE
   * the SDK call. NOT for general download (downloads always go through the ephemeral presigned
   * `get` URL — see createDownloadUrl). Throws StorageObjectBodyMissingError if the SDK response has
   * no Body (malformed/unexpected — fail-closed rather than fabricating an empty buffer); other SDK
   * errors (e.g. NoSuchKey) propagate unchanged (NOT swallowed).
   */
  async getObjectBytes(key: string, companyId: string): Promise<Uint8Array> {
    const config = this.assertConfigured();
    assertKeyInTenant(key, companyId);
    const result = await this.getClient().send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    );
    if (!result.Body) {
      throw new StorageObjectBodyMissingError(key);
    }
    return result.Body.transformToByteArray();
  }

  /**
   * True when `err` represents an S3 "object not found" response (404 / NotFound / NoSuchKey).
   * Duck-typed (rather than a strict `instanceof NotFound`) so MinIO/R2 responses that surface a
   * differently-named error class but the same 404 semantics are still recognized. Any error that
   * does NOT match is treated as a genuine failure by the caller (rethrown, never swallowed).
   */
  private isNotFoundError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const name = (err as { name?: unknown }).name;
    if (name === "NotFound" || name === "NoSuchKey") return true;
    const metadata = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
    return metadata?.httpStatusCode === 404;
  }
}
