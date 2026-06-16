import { Injectable, Logger } from "@nestjs/common";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ATTACHMENT_ALLOWED_CONTENT_TYPES, ATTACHMENT_MAX_BYTES } from "@mediaos/contracts";
import { assertKeyInTenant, validateKey } from "./storage-key";

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
}
