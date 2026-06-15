/**
 * Crypto contracts for G6-2 envelope encryption (plan §6a/§6b).
 *
 * ⚠️ SKELETON (G6-2b RED phase): types are the FROZEN contract that the RED tests encode.
 * Implementations live in 2c — these are pinned here so tests compile and fail on BEHAVIOR,
 * not on missing modules. Do NOT add logic to the implementing classes during 2b.
 *
 * AAD (pinned composition, §6a): utf8(companyId) ‖ utf8(recordId) ‖ utf8(encAlgo) ‖ utf8(dekKeyVersion).
 * recordId MUST be app-generated (crypto.randomUUID()) BEFORE INSERT — never the DB gen_random_uuid()
 * default (CARRY-FORWARD 🔴 from FULL-gate 2a: id unknown at encrypt time → AAD cannot bind).
 */

export type KeyPurpose = 'platform_account' | 'auth_reset_token' | 'totp_secret';

/** A DEK wrapped by the KEK inside the KMS/Vault. `wrapped` is the only thing that touches the DB. */
export interface WrappedDek {
  wrapped: Buffer;
  kmsKeyId: string;
  keyVersion: number;
}

/** Raw AEAD output — no KMS/DB knowledge. */
export interface SealedSecret {
  ciphertext: Buffer;
  iv: Buffer; // 12 bytes (AES-256-GCM nonce)
  authTag: Buffer; // 16 bytes
  algo: string; // 'AES-256-GCM'
}

/** Context needed to (re)build the AAD and select the key. recordId = app-gen platform_account id. */
export interface EncryptCtx {
  companyId: string;
  recordId: string;
  purpose: KeyPurpose;
}

/** The 7 envelope columns written to platform_accounts (maps erd-v2 §2.1 / migration 0022). */
export interface EncryptedColumns {
  secretCiphertext: Buffer;
  encryptedDek: Buffer;
  dekKeyVersion: number;
  kmsKeyId: string;
  ivNonce: Buffer;
  authTag: Buffer;
  encAlgo: string;
}

/** KEK never leaves the provider. Dev = LocalKekProvider; prod = Vault transit (DI swap). */
export interface KmsProvider {
  wrapDek(plaintextDek: Buffer, purpose: KeyPurpose): Promise<WrappedDek>;
  unwrapDek(wrapped: Buffer, kmsKeyId: string, keyVersion: number): Promise<Buffer>;
  currentKey(purpose: KeyPurpose): Promise<{ kmsKeyId: string; keyVersion: number }>;
  /**
   * Rotation-only (2g): re-wrap an already-unwrapped DEK under the CURRENT KEK, binding the wrap-AAD to an
   * EXPLICIT (targetKmsKeyId, keyVersion). Unlike wrapDek (which derives both from currentKey), the caller
   * pins keyVersion to the row's existing dek_key_version so the FROZEN secret AAD — which binds that
   * version — keeps reconstructing and the unchanged ciphertext still opens (plan §6d, decision A). Returns
   * the new wrapped bytes only; the caller owns and zeroizes `dek`.
   */
  reWrapDek(dek: Buffer, targetKmsKeyId: string, keyVersion: number): Promise<Buffer>;
}

/** Pure AEAD — knows nothing about KMS or DB. `open` throws on wrong tag/AAD/key. */
export interface EnvelopeCipher {
  seal(plaintext: string, dek: Buffer, aad: Buffer): SealedSecret;
  open(sealed: SealedSecret, dek: Buffer, aad: Buffer): string;
}

/** Orchestrates: new DEK → seal → wrap → envelope columns. Decrypt only on the reveal path. */
export interface ISecretEncryptionService {
  encryptSecret(plaintext: string, ctx: EncryptCtx): Promise<EncryptedColumns>;
  decryptSecret(row: EncryptedColumns, ctx: EncryptCtx): Promise<string>;
}

/**
 * Result of provisioning a new key version (G6-2 PR-A): the freshly INSERTed 'active' version + the prior
 * version flipped to 'retiring' (null on the very first provision when no prior version existed). Carries NO
 * key material — only the version numbers + purpose (kms_key_id stays inside the provider/registry).
 */
export interface ProvisionKeyVersionResult {
  purpose: KeyPurpose;
  newKeyVersion: number;
  retiredKeyVersion: number | null;
}

/** DI token for the swappable KMS provider (local ↔ vault). */
export const KMS_PROVIDER = 'KMS_PROVIDER';

/** DI token for the AEAD cipher implementation. */
export const ENVELOPE_CIPHER = 'ENVELOPE_CIPHER';
