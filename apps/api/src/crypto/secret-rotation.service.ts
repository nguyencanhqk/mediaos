import { Injectable } from '@nestjs/common';
import type { KeyPurpose } from './secret-encryption.types';

/**
 * SecretRotationService — KEK rotation worker (plan §6d). Runs on the DIRECT pool as `mediaos_worker`
 * (ADR-0003): no app.current_company_id, so it relies on the `platform_accounts_worker_all` RLS policy
 * to see every row and the column-grant UPDATE(encrypted_dek,kms_key_id,dek_key_version,last_rotated_at)
 * to re-wrap WITHOUT touching secret_ciphertext.
 *
 * ⚠️ SKELETON (G6-2b): bodies throw. Implement in 2g:
 *   reWrapAccount: unwrapDek(old) → wrapDek(new) → UPDATE the 4 wrap columns. ciphertext bytes UNCHANGED.
 *   reWrapAll: iterate rows for `purpose`, resumable. Mark old key `revoked` when done.
 *
 * RED 13 proves: encrypted_dek/kms_key_id/dek_key_version change, ciphertext bytes do NOT, decryptSecret
 * still returns the original plaintext, and the worker can actually see the rows.
 */
@Injectable()
export class SecretRotationService {
  reWrapAccount(_accountId: string): Promise<void> {
    throw new Error('NOT_IMPLEMENTED:2g — SecretRotationService.reWrapAccount');
  }

  reWrapAll(_purpose: KeyPurpose): Promise<{ rotated: number }> {
    throw new Error('NOT_IMPLEMENTED:2g — SecretRotationService.reWrapAll');
  }
}
