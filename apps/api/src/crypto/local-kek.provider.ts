import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { loadEnv } from '../config/env.schema';
import { db } from '../db';
import type { KeyPurpose, KmsProvider, WrappedDek } from './secret-encryption.types';

const KEK_BYTES = 32; // AES-256 KEK
const WRAP_ALGO = 'aes-256-gcm';
const WRAP_IV_BYTES = 12; // GCM nonce
const WRAP_TAG_BYTES = 16; // GCM auth tag

/**
 * LocalKekProvider — DEV-ONLY KMS (plan §6d). The KEK is a 32-byte key read from a file under `.secrets/`
 * (KMS_LOCAL_KEK_PATH); ADR-0004 forbids KEK-in-env-host for prod. Prod uses Vault transit (VaultKekProvider,
 * DI swap). The KEK never leaves this provider — only the WRAPPED DEK touches the DB.
 *
 * - wrapDek/unwrapDek: AES-256-GCM wrap of the DEK under the file KEK. `wrapped` = iv(12)‖tag(16)‖ciphertext.
 *   AAD binds `kmsKeyId‖0x00‖keyVersion` so a wrapped DEK cannot be replayed under a different key identity.
 * - currentKey: reads the active row from `encryption_keys` (GLOBAL registry, migration 0022).
 */
@Injectable()
export class LocalKekProvider implements KmsProvider, OnApplicationShutdown {
  /**
   * Cached KEK material — loaded lazily on first use so app-boot does not require `.secrets/` to exist.
   * ⚠️ The cache is NOT invalidated: rotating the KEK file requires a process restart (dev-only — prod
   * uses Vault transit where rotation/versioning is native). Zeroized on shutdown so it does not linger.
   */
  private kek?: Buffer;

  /** Zero the cached KEK on graceful shutdown (defense-in-depth — per-op DEKs are already zeroed). */
  onApplicationShutdown(): void {
    this.kek?.fill(0);
    this.kek = undefined;
  }

  async wrapDek(plaintextDek: Buffer, purpose: KeyPurpose): Promise<WrappedDek> {
    // Pin the version the DEK is wrapped under — SecretEncryptionService binds this into the AAD + stores it.
    const { kmsKeyId, keyVersion } = await this.currentKey(purpose);
    const kek = this.loadKek();
    const iv = randomBytes(WRAP_IV_BYTES);
    const cipher = createCipheriv(WRAP_ALGO, kek, iv, { authTagLength: WRAP_TAG_BYTES });
    cipher.setAAD(wrapAad(kmsKeyId, keyVersion));
    const ciphertext = Buffer.concat([cipher.update(plaintextDek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { wrapped: Buffer.concat([iv, tag, ciphertext]), kmsKeyId, keyVersion };
  }

  async unwrapDek(wrapped: Buffer, kmsKeyId: string, keyVersion: number): Promise<Buffer> {
    // Local dev has a single KEK file; multi-version KEK selection (rotation) is a 2g/Vault concern.
    const kek = this.loadKek();
    const iv = wrapped.subarray(0, WRAP_IV_BYTES);
    const tag = wrapped.subarray(WRAP_IV_BYTES, WRAP_IV_BYTES + WRAP_TAG_BYTES);
    const ciphertext = wrapped.subarray(WRAP_IV_BYTES + WRAP_TAG_BYTES);
    const decipher = createDecipheriv(WRAP_ALGO, kek, iv, { authTagLength: WRAP_TAG_BYTES });
    decipher.setAAD(wrapAad(kmsKeyId, keyVersion));
    decipher.setAuthTag(tag);
    // .final() throws on tag/AAD mismatch — Node's GCM error is generic (no key/plaintext leak).
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  async currentKey(purpose: KeyPurpose): Promise<{ kmsKeyId: string; keyVersion: number }> {
    if (!db) {
      throw new Error('LocalKekProvider: DATABASE_URL chưa cấu hình — không thể đọc encryption_keys.');
    }
    // encryption_keys is GLOBAL (no company_id / no RLS — migration 0022): a legitimate non-tenant registry
    // read, NOT business data, so it does NOT go through withTenant. (guard-tenant.mjs WARN here is expected.)
    const res = await db.execute(
      sql`SELECT kms_key_id, key_version FROM encryption_keys
          WHERE purpose = ${purpose} AND status = 'active'
          ORDER BY key_version DESC
          LIMIT 1`,
    );
    const row = res.rows[0] as { kms_key_id: string; key_version: number } | undefined;
    if (!row) {
      throw new Error(`LocalKekProvider: không có encryption key 'active' cho purpose '${purpose}'.`);
    }
    return { kmsKeyId: row.kms_key_id, keyVersion: Number(row.key_version) };
  }

  /** Lazy-load + cache the 32-byte KEK. Fail-fast (clear error, never logs key bytes) on missing/short file. */
  private loadKek(): Buffer {
    if (this.kek) return this.kek;
    const { KMS_LOCAL_KEK_PATH } = loadEnv();
    let raw: Buffer;
    try {
      raw = readFileSync(KMS_LOCAL_KEK_PATH);
    } catch {
      throw new Error(
        `LocalKekProvider: không đọc được file KEK tại KMS_LOCAL_KEK_PATH ('${KMS_LOCAL_KEK_PATH}').`,
      );
    }
    if (raw.length !== KEK_BYTES) {
      throw new Error(
        `LocalKekProvider: KEK phải đúng ${KEK_BYTES} byte (đọc được ${raw.length}).`,
      );
    }
    this.kek = raw;
    return raw;
  }
}

/**
 * AAD for DEK-wrap — reconstructable at unwrap from (kmsKeyId, keyVersion) alone; binds wrap to key identity.
 * NUL-delimited (F1b) so a kmsKeyId containing ':' or '/' (e.g. a Vault transit path in 2g) cannot
 * ambiguously re-segment against the version — collision-free by construction, mirror of the envelope AAD.
 */
function wrapAad(kmsKeyId: string, keyVersion: number): Buffer {
  return Buffer.from(`${kmsKeyId}\x00${keyVersion}`, 'utf8');
}
