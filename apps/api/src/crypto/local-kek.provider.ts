import { Injectable } from '@nestjs/common';
import type { KeyPurpose, KmsProvider, WrappedDek } from './secret-encryption.types';

/**
 * LocalKekProvider — DEV-ONLY KMS (plan §6d). KEK is a 32-byte key loaded from a file under `.secrets/`
 * (KMS_LOCAL_KEK_PATH); ADR-0004 forbids KEK-in-env-host for prod. Prod uses Vault transit (DI swap).
 *
 * ⚠️ SKELETON (G6-2b): bodies throw. Implement in 2c:
 *   - wrapDek/unwrapDek: AES-256-GCM wrap of the DEK under the file KEK (the KEK never leaves here).
 *   - currentKey: read active version from encryption_keys for `purpose`.
 */
@Injectable()
export class LocalKekProvider implements KmsProvider {
  wrapDek(_plaintextDek: Buffer, _purpose: KeyPurpose): Promise<WrappedDek> {
    throw new Error('NOT_IMPLEMENTED:2c — KmsProvider.wrapDek');
  }

  unwrapDek(_wrapped: Buffer, _kmsKeyId: string, _keyVersion: number): Promise<Buffer> {
    throw new Error('NOT_IMPLEMENTED:2c — KmsProvider.unwrapDek');
  }

  currentKey(_purpose: KeyPurpose): Promise<{ kmsKeyId: string; keyVersion: number }> {
    throw new Error('NOT_IMPLEMENTED:2c — KmsProvider.currentKey');
  }
}
