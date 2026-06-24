/**
 * S3StorageAdapter — concrete implementation of StorageAdapter PORT backed by ObjectStorageService.
 *
 * Design: COMPOSITION (not inheritance) over ObjectStorageService. We do NOT modify object-storage.
 * service.ts. This adapter only maps PORT method signatures to the existing service API.
 *
 * BẤT BIẾN (CLAUDE.md §2.3):
 *   - `storage_path` / raw keys are NEVER returned from this class. Only SignedUrlResult is returned
 *     to the caller (url + expiresAt). Callers may not persist the URL.
 *   - `get` delegates to `createDownloadUrl` which re-asserts key ∈ tenant prefix (cross-tenant guard).
 *   - TTL for presigned URLs comes from config/env (S3_PRESIGN_TTL_SEC). Callers may override per-call;
 *     any provided TTL is clamped to MAX_PRESIGN_TTL_SEC to prevent accidentally long-lived URLs.
 *
 * Method mapping:
 *   PORT `put`        → ObjectStorageService.putObject(key, body, contentType)
 *   PORT `get`        → ObjectStorageService.createDownloadUrl(key, companyId)       [presigned GET]
 *   PORT `delete`     → ObjectStorageService.deleteObject(key)
 *   PORT `signedUrl`  → ObjectStorageService.createUploadUrl(key, contentType, size) [presigned PUT]
 *
 * NOTE: ObjectStorageService.createDownloadUrl uses config.presignTtlSec internally (no TTL param).
 * For the PORT's `get` method we therefore use the adapter's resolved TTL only to compute `expiresAt`;
 * the actual S3 TTL comes from the service (matches env S3_PRESIGN_TTL_SEC, same source of truth).
 * Similarly, createUploadUrl uses config.presignTtlSec for the signed expiry. Both expiresAt values
 * are computed as `now + presignTtlSec` using the same env value to keep them consistent.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ObjectStorageService } from "./object-storage.service";
import {
  StorageAdapter,
  StorageDeleteInput,
  StorageGetInput,
  StoragePutInput,
  StorageSignedUploadInput,
  SignedUrlResult,
  DEFAULT_PRESIGN_TTL_SEC,
} from "./storage-adapter.port";

/** Hard cap on presign TTL that callers may request. Prevents accidentally signing URLs for hours. */
const MAX_PRESIGN_TTL_SEC = 3600; // 1 hour absolute ceiling

@Injectable()
export class S3StorageAdapter implements StorageAdapter {
  private readonly logger = new Logger(S3StorageAdapter.name);

  constructor(private readonly objectStorage: ObjectStorageService) {}

  // ─── put ────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Server-side direct PUT. Delegates to ObjectStorageService.putObject after key is validated
   * (ObjectStorageService re-validates internally as a hard boundary — double-check is intentional).
   */
  async put(input: StoragePutInput): Promise<void> {
    await this.objectStorage.putObject(input.key, input.body, input.contentType);
  }

  // ─── get ────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Presigned GET URL for client download. ObjectStorageService.createDownloadUrl re-asserts
   * `key ∈ companyId prefix` (cross-tenant guard) before signing.
   *
   * `expiresAt` is computed from the effective TTL (env S3_PRESIGN_TTL_SEC or the per-call override,
   * clamped to MAX_PRESIGN_TTL_SEC).
   */
  async get(input: StorageGetInput): Promise<SignedUrlResult> {
    const ttlSec = this.resolveTtl(input.presignTtlSec);
    const url = await this.objectStorage.createDownloadUrl(input.key, input.companyId);
    return { url, expiresAt: this.expiresAt(ttlSec) };
  }

  // ─── delete ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * Hard-delete the object at `key`. Caller is responsible for business-layer soft-delete first.
   * Key is re-validated inside ObjectStorageService.deleteObject (hard boundary).
   */
  async delete(input: StorageDeleteInput): Promise<void> {
    await this.objectStorage.deleteObject(input.key);
  }

  // ─── signedUrl ───────────────────────────────────────────────────────────────────────────────────

  /**
   * Presigned PUT URL for direct client upload. ObjectStorageService.createUploadUrl re-validates
   * key + enforces content-type allowlist + size ceiling before signing.
   */
  async signedUrl(input: StorageSignedUploadInput): Promise<SignedUrlResult> {
    const ttlSec = this.resolveTtl(input.presignTtlSec);
    const url = await this.objectStorage.createUploadUrl(
      input.key,
      input.contentType,
      input.sizeBytes,
    );
    return { url, expiresAt: this.expiresAt(ttlSec) };
  }

  // ─── helpers ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * Resolve the effective presign TTL: per-call override (if valid) → env default →
   * DEFAULT_PRESIGN_TTL_SEC. Clamp to MAX_PRESIGN_TTL_SEC so a caller cannot request an
   * arbitrarily long-lived URL.
   */
  private resolveTtl(perCallTtl?: number): number {
    const envTtl = this.objectStorage.isConfigured()
      ? Number.parseInt(process.env.S3_PRESIGN_TTL_SEC ?? "0", 10) || DEFAULT_PRESIGN_TTL_SEC
      : DEFAULT_PRESIGN_TTL_SEC;

    const requested = typeof perCallTtl === "number" && perCallTtl > 0 ? perCallTtl : envTtl;
    const clamped = Math.min(requested, MAX_PRESIGN_TTL_SEC);

    if (clamped !== requested) {
      this.logger.warn(
        `S3StorageAdapter: presignTtlSec ${requested}s clamped to ${MAX_PRESIGN_TTL_SEC}s`,
      );
    }

    return clamped;
  }

  /** Compute the expiry Date from now + `ttlSec`. */
  private expiresAt(ttlSec: number): Date {
    return new Date(Date.now() + ttlSec * 1000);
  }
}
