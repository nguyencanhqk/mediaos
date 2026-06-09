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

  constructor(@Inject(KMS_PROVIDER) private readonly kms: KmsProvider) {}

  /**
   * Re-wrap a single account's DEK under the current active KEK. THROWS if the account is gone/soft-deleted:
   * a caller that named a specific account expects it to rotate, so a 0-row result must fail loud — NOT
   * resolve silently and let the caller believe a rotation landed when it did not.
   */
  async reWrapAccount(accountId: string): Promise<void> {
    const dbw = this.requireWorkerDb();
    await this.assertWorkerRoleSafe(dbw);
    const { kmsKeyId } = await this.kms.currentKey(PURPOSE);
    const rotated = await this.rewrapRow(dbw, kmsKeyId, accountId);
    if (!rotated) {
      throw new Error(
        `reWrapAccount(${accountId}): account không tồn tại / đã xoá — không có gì để rotate (0 row).`,
      );
    }
  }

  /**
   * Re-wrap every live platform_account not yet wrapped under the current active KEK.
   * Returns the count rotated + per-account failures (a single corrupt row must not abort the batch).
   */
  async reWrapAll(
    purpose: KeyPurpose,
  ): Promise<{ rotated: number; failed: Array<{ id: string; error: string }> }> {
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
    const failed: Array<{ id: string; error: string }> = [];
    for (const id of ids) {
      try {
        if (await this.rewrapRow(dbw, kmsKeyId, id)) rotated += 1;
      } catch (err) {
        // One corrupt/un-decryptable row must NOT abort the whole batch (a single bad row would otherwise
        // DoS the rotation). Record the account id (UUID — not secret) + a SANITIZED tag (never the raw
        // provider message, which a KMS/Vault error can carry transit paths/token fragments in; never the
        // DEK/secret) and continue; the caller alerts/retries on `failed`.
        const tag = safeFailureTag(err);
        this.logger.error(`reWrapAll: account ${id} re-wrap thất bại — bỏ qua, tiếp tục batch. reason=${tag}`);
        failed.push({ id, error: tag });
      }
    }
    if (failed.length > 0) {
      // AGGREGATE alert — a single corrupt row must not fail in the dark. One structured line that monitoring
      // can fire on (UUIDs + counts ONLY — no DEK/secret/provider detail). The non-empty `failed[]` is the
      // caller's hard contract: it MUST inspect + alert/retry, never discard the result.
      this.logger.error(
        `reWrapAll[${purpose}]: ${failed.length}/${ids.length} account re-wrap THẤT BẠI ` +
          `(rotated=${rotated}) — caller PHẢI xử lý failed[]. failedIds=[${failed.map((f) => f.id).join(',')}]`,
      );
    }
    return { rotated, failed };
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

    // Validate envelope columns BEFORE crypto: a wrong driver type (bytea arriving as hex/base64 string) or a
    // null/garbage version would otherwise fail deep inside AES-GCM with an error that hides the real cause.
    const wrappedDek = row.encrypted_dek;
    if (!Buffer.isBuffer(wrappedDek)) {
      throw new Error(`rewrapRow(${accountId}): encrypted_dek không phải Buffer (driver trả kiểu lạ).`);
    }
    const currentKmsKeyId = row.kms_key_id;
    if (typeof currentKmsKeyId !== 'string') {
      throw new Error(`rewrapRow(${accountId}): kms_key_id không hợp lệ.`);
    }
    const version = Number(row.dek_key_version);
    if (!Number.isInteger(version) || version < 0) {
      throw new Error(`rewrapRow(${accountId}): dek_key_version không hợp lệ.`);
    }

    let dek: Buffer | undefined;
    try {
      dek = await this.kms.unwrapDek(wrappedDek, currentKmsKeyId, version);
      const newWrapped = await this.kms.reWrapDek(dek, targetKmsKeyId, version);
      // UPDATE only the wrap columns in the worker grant — dek_key_version + secret_ciphertext stay untouched.
      // NO kms_key_id predicate (re-wrapping an already-target row is intentional: fresh IV + last_rotated_at
      // bump — RED 13b/13g pin this), but DO re-check `deleted_at IS NULL`: a soft-delete (sets deleted_at, row
      // still present) between SELECT and UPDATE must NOT get a phantom rotation stamp. Symmetric with the SELECT
      // and với bất biến #2 (không thao tác trên hàng đã soft-delete như thể còn sống).
      const upd = await dbw.execute(sql`
        UPDATE platform_accounts
        SET encrypted_dek = ${newWrapped}, kms_key_id = ${targetKmsKeyId}, last_rotated_at = now()
        WHERE id = ${accountId} AND deleted_at IS NULL
      `);
      // 0 rows = the row vanished/soft-deleted between SELECT and UPDATE (concurrent delete or lost privilege).
      // Report it as "not rotated" so reWrapAll's count never over-reports a rotation that did not actually land.
      return (upd.rowCount ?? 0) > 0;
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
   * → có thể ghi đè secret_ciphertext. FAIL CLOSED mặc định ở MỌI env: chỉ một env-flag TƯỜNG MINH
   * `ALLOW_SUPERUSER_ROTATION='true'` mới hạ xuống warn-only (cho harness seed/teardown bằng superuser).
   * KHÔNG dựa `NODE_ENV` — staging/CI cũng mirror prod, không được nới lỏng ngầm theo môi trường. Kiểm mỗi
   * lần gọi (không cache — tránh bỏ sót khi connection/role đổi).
   */
  private async assertWorkerRoleSafe(dbw: NonNullable<typeof workerDb>): Promise<void> {
    const res = await dbw.execute(sql`
      SELECT current_user AS role, rolsuper, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `);
    const row = res.rows[0] as { role: string; rolsuper: boolean; rolbypassrls: boolean } | undefined;
    if (!row) {
      // Fail-closed: không xác minh được role (current_user không có trong pg_roles — role bị drop giữa session
      // / connection lỗi) → KHÔNG cho rotation chạy mù qua một guard bị bỏ qua im lặng. Thà chặn.
      throw new Error('assertWorkerRoleSafe: không đọc được role của current_user từ pg_roles — chặn rotation.');
    }
    if (row.rolsuper || row.rolbypassrls) {
      // Chi tiết role (tên + cờ super/bypassrls) CHỈ nằm trong message của throw (không bao giờ tới log).
      const msg =
        `SecretRotationService đang chạy bằng role '${row.role}' có BYPASS RLS ` +
        `(super=${row.rolsuper}, bypassrls=${row.rolbypassrls}) — đặt DATABASE_WORKER_URL trỏ mediaos_worker. ` +
        `Role này bypass cả column-grant → có thể ghi secret_ciphertext.`;
      // Fail-closed: chỉ chính xác chuỗi 'true' mới warn-only; mọi giá trị khác (kể cả unset) → NÉM.
      if (process.env.ALLOW_SUPERUSER_ROTATION !== 'true') throw new Error(msg);
      // Warn-path KHÔNG in tên role / cờ ra log: tránh lộ topology role + quảng cáo bề mặt bypass cho ai đọc log.
      this.logger.warn(
        "SecretRotationService: role BYPASS RLS được cho qua vì ALLOW_SUPERUSER_ROTATION='true' — " +
          'chỉ dùng cho harness seed/teardown, KHÔNG đặt ở staging/prod.',
      );
    }
  }
}

/**
 * Sanitize a re-wrap failure into a SAFE, leak-free tag for `failed[]` + logs. NEVER echoes the raw error
 * message — a KMS/Vault error can carry transit paths or token fragments, and the DEK/secret must never reach
 * a log line. Only the curated, constant Node GCM-auth message is mapped (it carries no secret); everything
 * else collapses to a generic tag.
 */
function safeFailureTag(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  // GCM tag/AAD mismatch — corrupt/tampered envelope or wrong key. Node/OpenSSL KHÔNG cam kết ổn định chuỗi
  // message; nếu đổi, rơi về REWRAP_FAILED (an toàn — chỉ mất nhãn mịn, không lộ secret).
  if (/unable to authenticate data|bad decrypt/i.test(raw)) return 'DEK_UNWRAP_AUTH_FAILED';
  // Envelope column sai kiểu/giá trị (driver trả kiểu lạ / version rác) — lỗi TOÀN VẸN DỮ LIỆU, không phải crypto.
  if (/không phải Buffer|kms_key_id không hợp lệ|dek_key_version không hợp lệ/i.test(raw)) {
    return 'DEK_ENVELOPE_INVALID';
  }
  // KMS/DB không kết nối được (Vault/Postgres) — lỗi HẠ TẦNG; tách khỏi corrupt-row để chẩn đoán đúng hướng.
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|connect.*timeout/i.test(raw)) return 'KMS_CONNECT_ERROR';
  return 'REWRAP_FAILED';
}
