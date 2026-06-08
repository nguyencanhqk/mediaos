import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ENVELOPE_CIPHER,
  KMS_PROVIDER,
  type EncryptCtx,
  type EncryptedColumns,
  type EnvelopeCipher,
  type ISecretEncryptionService,
  type KmsProvider,
} from './secret-encryption.types';

const ALGO = 'AES-256-GCM';
const DEK_BYTES = 32; // AES-256 key

/**
 * AAD (pinned, §6a): utf8(companyId)‖0x00‖utf8(recordId)‖0x00‖utf8(encAlgo)‖0x00‖utf8(dekKeyVersion).
 * NUL-delimited so the four fields cannot ambiguously re-segment — a UUID, the algo token, and an
 * integer version never contain 0x00 — making the binding collision-free BY CONSTRUCTION rather than
 * relying on enc_algo staying a single literal (FULL-gate F1). Byte-identical between seal and open or
 * GCM verification fails — composition is frozen here.
 * `recordId` MUST be the app-generated platform_account id (passed in EncryptCtx), never the DB default.
 */
export function buildAad(companyId: string, recordId: string, encAlgo: string, dekKeyVersion: number): Buffer {
  return Buffer.from(`${companyId}\x00${recordId}\x00${encAlgo}\x00${dekKeyVersion}`, 'utf8');
}

/**
 * SecretEncryptionService — orchestrates envelope encryption (plan §6a/§6b):
 *   encrypt: fresh DEK per write → cipher.seal → kms.wrapDek → envelope columns; DEK zeroed in finally.
 *   decrypt: kms.unwrapDek → rebuild AAD from row+ctx → cipher.open; generic error on failure; DEK zeroed.
 * NEVER logs plaintext/DEK/ciphertext/tag (no logger calls here at all — enforced by RED 10).
 */
@Injectable()
export class SecretEncryptionService implements ISecretEncryptionService {
  constructor(
    @Inject(ENVELOPE_CIPHER) private readonly cipher: EnvelopeCipher,
    @Inject(KMS_PROVIDER) private readonly kms: KmsProvider,
  ) {}

  async encryptSecret(plaintext: string, ctx: EncryptCtx): Promise<EncryptedColumns> {
    // Fresh 32-byte DEK every write — CẤM tái dùng DEK (catastrophic GCM if (DEK,nonce) repeats).
    const dek = randomBytes(DEK_BYTES);
    try {
      // wrapDek wraps under the CURRENT KEK and reports its version → store + bind that exact version.
      const wrapped = await this.kms.wrapDek(dek, ctx.purpose);
      const aad = buildAad(ctx.companyId, ctx.recordId, ALGO, wrapped.keyVersion);
      const sealed = this.cipher.seal(plaintext, dek, aad);
      return {
        secretCiphertext: sealed.ciphertext,
        encryptedDek: wrapped.wrapped,
        dekKeyVersion: wrapped.keyVersion,
        kmsKeyId: wrapped.kmsKeyId,
        ivNonce: sealed.iv,
        authTag: sealed.authTag,
        encAlgo: sealed.algo,
      };
    } finally {
      dek.fill(0); // zero key material — do not leave the DEK on the heap
    }
  }

  async decryptSecret(row: EncryptedColumns, ctx: EncryptCtx): Promise<string> {
    let dek: Buffer | undefined;
    try {
      dek = await this.kms.unwrapDek(row.encryptedDek, row.kmsKeyId, row.dekKeyVersion);
      const aad = buildAad(ctx.companyId, ctx.recordId, row.encAlgo, row.dekKeyVersion);
      return this.cipher.open(
        { ciphertext: row.secretCiphertext, iv: row.ivNonce, authTag: row.authTag, algo: row.encAlgo },
        dek,
        aad,
      );
    } catch {
      // Generic — never surface tag/AAD/crypto internals or any plaintext to the caller.
      throw new Error('decrypt failed');
    } finally {
      if (dek) dek.fill(0);
    }
  }
}
