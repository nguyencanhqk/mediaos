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

/** Thrown when a content type is not in the allowlist or the declared size exceeds the ceiling. */
export class UnsupportedAttachmentError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnsupportedAttachmentError";
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
      throw new UnsupportedAttachmentError(`Content-type không được phép: ${contentType}`);
    }
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
      throw new UnsupportedAttachmentError("Kích thước file không hợp lệ.");
    }
    if (sizeBytes > ATTACHMENT_MAX_BYTES) {
      throw new UnsupportedAttachmentError(`File vượt giới hạn ${ATTACHMENT_MAX_BYTES} bytes.`);
    }
  }

  /**
   * Presigned PUT URL for uploading bytes to `key`. The key MUST be server-derived + validated; we
   * re-validate here so this method is a hard boundary (no caller can pass a traversal key).
   * The presigned request pins content-type and content-length so the client cannot upload a
   * different type or an oversized object than was authorized at intent time.
   */
  async createUploadUrl(key: string, contentType: string, sizeBytes: number): Promise<string> {
    const config = this.assertConfigured();
    validateKey(key);
    this.assertUploadAllowed(contentType, sizeBytes);
    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    return getSignedUrl(this.getClient(), command, { expiresIn: config.presignTtlSec });
  }

  /**
   * Server-side upload of bytes to `key` (WAVE 3 C2 export-worker). UNLIKE createUploadUrl (presigned, for
   * a CLIENT to PUT), this PUTs directly from the server process — used by the export worker which generates
   * the CSV in-process. Key MUST be server-derived + validated (re-validated here as a hard boundary).
   */
  async putObject(key: string, body: Uint8Array | string, contentType: string): Promise<void> {
    const config = this.assertConfigured();
    validateKey(key);
    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });
    await this.getClient().send(command);
  }

  /**
   * Delete object at `key` (WAVE 3 C2 compensation). Used to clean up an export object whose job failed to
   * finalize AFTER a successful upload (avoid orphaned objects). Key re-validated as a hard boundary.
   */
  async deleteObject(key: string): Promise<void> {
    const config = this.assertConfigured();
    validateKey(key);
    await this.getClient().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  }

  /**
   * Presigned GET URL for downloading `key`. Caller MUST have already resolved the metadata row via
   * RLS (tenant scope) and pass the owning companyId — we re-assert the key is inside that tenant's
   * prefix before signing (belt-and-suspenders on top of RLS).
   */
  async createDownloadUrl(key: string, companyId: string): Promise<string> {
    const config = this.assertConfigured();
    assertKeyInTenant(key, companyId);
    const command = new GetObjectCommand({ Bucket: config.bucket, Key: key });
    return getSignedUrl(this.getClient(), command, { expiresIn: config.presignTtlSec });
  }

  /**
   * HEAD the object at `key` (S2-FND-FILE-2 confirm-upload flow) — verify a client's presigned-PUT
   * actually landed BEFORE the caller (FileService.confirm) marks the file row 'Uploaded'. Re-asserts
   * `key ∈ companyId` prefix (cross-tenant guard) BEFORE the SDK call — mirrors createDownloadUrl.
   * Never throws for a genuinely-absent object (404/NotFound): returns
   * `{ exists: false, sizeBytes: null }` so the caller can set upload_status='Failed' instead of
   * crashing. Any OTHER error (transport/auth) is rethrown — an unknown failure is NEVER silently
   * reinterpreted as "object missing" (silent-failure-hunter guard).
   */
  async statObject(key: string, companyId: string): Promise<StorageStatResult> {
    const config = this.assertConfigured();
    assertKeyInTenant(key, companyId);
    try {
      const result = await this.getClient().send(
        new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      const sizeBytes = typeof result.ContentLength === "number" ? result.ContentLength : null;
      return { exists: true, sizeBytes };
    } catch (err) {
      if (this.isNotFoundError(err)) {
        return { exists: false, sizeBytes: null };
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
