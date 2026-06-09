import { Injectable } from '@nestjs/common';
import type { KeyPurpose, KmsProvider, WrappedDek } from './secret-encryption.types';

/**
 * VaultKekProvider — PROD KMS via HashiCorp Vault `transit` (plan §6d): KEK never leaves Vault, native
 * rotation + audit. Selected when KMS_PROVIDER='vault' (env-validated to require KMS_VAULT_ADDR/TOKEN).
 *
 * ⚠️ DI-STUB (2c): wired so the module compiles and selection works; the real Vault transit calls land in
 * 2g/prod. Constructor is intentionally inert (no Vault connection at boot) — only the methods throw.
 */
@Injectable()
export class VaultKekProvider implements KmsProvider {
  wrapDek(_plaintextDek: Buffer, _purpose: KeyPurpose): Promise<WrappedDek> {
    throw new Error('NOT_IMPLEMENTED:2g — VaultKekProvider.wrapDek (Vault transit)');
  }

  unwrapDek(_wrapped: Buffer, _kmsKeyId: string, _keyVersion: number): Promise<Buffer> {
    throw new Error('NOT_IMPLEMENTED:2g — VaultKekProvider.unwrapDek (Vault transit)');
  }

  currentKey(_purpose: KeyPurpose): Promise<{ kmsKeyId: string; keyVersion: number }> {
    throw new Error('NOT_IMPLEMENTED:2g — VaultKekProvider.currentKey (Vault transit)');
  }

  reWrapDek(_dek: Buffer, _targetKmsKeyId: string, _keyVersion: number): Promise<Buffer> {
    throw new Error('NOT_IMPLEMENTED:2g — VaultKekProvider.reWrapDek (Vault transit)');
  }
}
