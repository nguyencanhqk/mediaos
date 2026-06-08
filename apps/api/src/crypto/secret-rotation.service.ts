import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { workerDb } from '../db/index';
import { KMS_PROVIDER, type KeyPurpose, type KmsProvider } from './secret-encryption.types';

const PURPOSE: KeyPurpose = 'platform_account';

/**
 * SecretRotationService — KEK rotation worker (plan §6d, decision A). Runs on the WORKER pool (`mediaos_worker`,
 * direct, ADR-0003): no app.current_company_id, so it relies on the `platform_accounts_worker_all` RLS policy
 * to see every tenant's rows and on the column-grant UPDATE(encrypted_dek,kms_key_id,dek_key_version,
 * last_rotated_at) to re-wrap WITHOUT touching secret_ciphertext.
 *
 * Re-wrap = unwrap the DEK under its CURRENT (kms_key_id, dek_key_version) → re-wrap the SAME DEK under the new
 * active KEK identity → UPDATE encrypted_dek + kms_key_id + last_rotated_at. The DEK plaintext and the sealed
 * secret are unchanged, so:
 *   - `dek_key_version` STAYS PUT — the FROZEN secret AAD binds it; bumping it would break decrypt of the
 *     preserved ciphertext (see secret-rotation.int-spec RED 13f/13g).
 *   - `secret_ciphertext` / `iv_nonce` / `auth_tag` are never rewritten (and not in the worker column-grant).
 * Resumable: reWrapAll only touches rows not yet at the target key; re-running is safe and idempotent.
 *
 * NEVER logs the DEK or the secret (only role/role-safety warnings).
 */
@Injectable()
export class SecretRotationService {
  private readonly logger = new Logger(SecretRotationService.name);
  private roleChecked = false;

  constructor(@Inject(KMS_PROVIDER) private readonly kms: KmsProvider) {}

  /** Re-wrap a single account's DEK under the current active KEK. No-op if the account is gone/soft-deleted. */
  async reWrapAccount(accountId: string): Promise<void> {
    const dbw = this.requireWorkerDb();
    await this.assertWorkerRoleSafe(dbw);
    const { kmsKeyId } = await this.kms.currentKey(PURPOSE);
    await this.rewrapRow(dbw, kmsKeyId, accountId);
  }

  /** Re-wrap every live platform_account not yet wrapped under the current active KEK. Returns the count rotated. */
  async reWrapAll(purpose: KeyPurpose): Promise<{ rotated: number }> {
    if (purpose !== PURPOSE) {
      // auth_reset_token envelopes live in outbox payloads (short-lived, TTL reset) — they expire naturally
      // and are intentionally NOT rotated here (handoff §2g). Only platform_accounts (durable rows) rotate.
      throw new Error(`SecretRotationService.reWrapAll: purpose '${purpose}' không rotate (chỉ '${PURPOSE}').`);
    }
    const dbw = this.requireWorkerDb();
    await this.assertWorkerRoleSafe(dbw);
    const { kmsKeyId } = await this.kms.currentKey(purpose);

    // Resumable: skip rows already at the target key so a re-run only finishes the remainder.
    const res = await dbw.execute(sql`
      SELECT id FROM platform_accounts
      WHERE deleted_at IS NULL AND kms_key_id IS DISTINCT FROM ${kmsKeyId}
    `);
    const ids = res.rows.map((r) => (r as { id: string }).id);

    let rotated = 0;
    for (const id of ids) {
      if (await this.rewrapRow(dbw, kmsKeyId, id)) rotated += 1;
    }
    return { rotated };
  }

  /**
   * Re-wrap one row to `targetKmsKeyId`, PINNING the wrap-AAD version to the row's existing dek_key_version.
   * Returns false if the row vanished (concurrent delete) so reWrapAll's count stays accurate. The DEK is
   * zeroized in `finally` — it must never linger on the heap.
   */
  private async rewrapRow(
    dbw: NonNullable<typeof workerDb>,
    targetKmsKeyId: string,
    accountId: string,
  ): Promise<boolean> {
    const res = await dbw.execute(sql`
      SELECT encrypted_dek, kms_key_id, dek_key_version
      FROM platform_accounts WHERE id = ${accountId} AND deleted_at IS NULL
    `);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return false;

    let dek: Buffer | undefined;
    try {
      const version = Number(row.dek_key_version);
      dek = await this.kms.unwrapDek(row.encrypted_dek as Buffer, row.kms_key_id as string, version);
      const newWrapped = await this.kms.reWrapDek(dek, targetKmsKeyId, version);
      // UPDATE only the wrap columns in the worker grant — dek_key_version + secret_ciphertext stay untouched.
      await dbw.execute(sql`
        UPDATE platform_accounts
        SET encrypted_dek = ${newWrapped}, kms_key_id = ${targetKmsKeyId}, last_rotated_at = now()
        WHERE id = ${accountId}
      `);
      return true;
    } finally {
      if (dek) dek.fill(0);
    }
  }

  private requireWorkerDb(): NonNullable<typeof workerDb> {
    const dbw = workerDb;
    if (!dbw) {
      throw new Error('SecretRotationService: workerDb chưa cấu hình (DATABASE_WORKER_URL/DIRECT_URL).');
    }
    return dbw;
  }

  /**
   * Chặn worker chạy bằng role BYPASS RLS (mirror OutboxWorker). Role super/bypassrls bỏ qua CẢ column-grant
   * → có thể ghi đè secret_ciphertext. Prod: ném; dev: cảnh báo to. Chỉ kiểm 1 lần/instance.
   */
  private async assertWorkerRoleSafe(dbw: NonNullable<typeof workerDb>): Promise<void> {
    if (this.roleChecked) return;
    const res = await dbw.execute(sql`
      SELECT current_user AS role, rolsuper, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `);
    const row = res.rows[0] as { role: string; rolsuper: boolean; rolbypassrls: boolean } | undefined;
    if (row && (row.rolsuper || row.rolbypassrls)) {
      const msg =
        `SecretRotationService đang chạy bằng role '${row.role}' có BYPASS RLS ` +
        `(super=${row.rolsuper}, bypassrls=${row.rolbypassrls}) — đặt DATABASE_WORKER_URL trỏ mediaos_worker. ` +
        `Role này bypass cả column-grant → có thể ghi secret_ciphertext.`;
      if (process.env.NODE_ENV === 'production') throw new Error(msg);
      this.logger.warn(msg);
    }
    this.roleChecked = true;
  }
}
