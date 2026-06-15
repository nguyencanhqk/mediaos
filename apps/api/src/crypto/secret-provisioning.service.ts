import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { workerDb } from '../db/index';
import { assertWorkerRoleSafe as assertWorkerRoleSafeShared } from '../db/worker-role';
import {
  KMS_PROVIDER,
  type KeyPurpose,
  type KmsProvider,
  type ProvisionKeyVersionResult,
} from './secret-encryption.types';

/**
 * audit-of-record tag cho mọi thao tác key version (provision/rotate). encryption_keys là registry GLOBAL
 * (no-RLS, no tenant) → KHÔNG ghi vào `audit_logs` (bảng tenant-scoped: FK companies + RLS WITH CHECK
 * company_id + worker KHÔNG có GRANT INSERT — loosen sẽ phá BẤT BIẾN #1/#2). Mirror SecretRotationService:
 * audit qua structured Logger (monitorable, KHÔNG key material — chỉ purpose/version/kms path). 'encryption_key'
 * cũng được nạp vào audit-CHECK superset (mig 0150) để đường app-tenant-context tương lai dùng được.
 */
const AUDIT_TAG = 'audit[encryption_key]';

/**
 * SecretProvisioningService — G6-2 PR-A: provision a NEW encryption-key version (BẤT BIẾN #2/#3).
 *
 * provisionKeyVersion(purpose):
 *   1. read max(key_version) hiện tại cho `purpose` từ encryption_keys (GLOBAL registry, mig 0022).
 *   2. INSERT version+1 'active' (kms_key_id = đường dẫn key MỚI; dev = `${base}-v${n}`) — ON CONFLICT
 *      (purpose,key_version) DO NOTHING để idempotent khi chạy lại sau crash.
 *   3. flip version cũ → 'retiring' (UPDATE encryption_keys.status — KHÔNG bao giờ chạm platform_accounts:
 *      dek_key_version + secret_ciphertext của row cũ là BẤT BIẾN, frozen secret AAD; re-wrap (đổi kms_key_id/
 *      encrypted_dek/last_rotated_at) là việc của SecretRotationService, KHÔNG phải provisioning).
 *   4. ghi audit-of-record qua Logger CÙNG sau commit (append-only — chỉ purpose + version + kms_key_id path,
 *      KHÔNG key material/secret).
 *
 * Chạy WORKER pool (`mediaos_worker`, direct, ADR-0003) — encryption_keys là registry GLOBAL no-RLS nên KHÔNG
 * cần app.current_company_id. assertWorkerRoleSafe(mode='strict', overrideEnvVar='ALLOW_SUPERUSER_ROTATION'):
 * role BYPASS RLS bị NÉM trừ env-flag tường minh (mirror SecretRotationService — fail-closed mọi env, KHÔNG
 * dựa NODE_ENV). NEVER logs key material (chỉ version/role-safety warnings).
 */
@Injectable()
export class SecretProvisioningService {
  private readonly logger = new Logger(SecretProvisioningService.name);

  constructor(@Inject(KMS_PROVIDER) private readonly kms: KmsProvider) {}

  async provisionKeyVersion(purpose: KeyPurpose): Promise<ProvisionKeyVersionResult> {
    const dbw = this.requireWorkerDb();
    await this.assertWorkerRoleSafe(dbw);

    const result = await dbw.transaction(async (tx) => {
      // 1) version + kms_key_id của key 'active' hiện hành (nếu có) — base để derive path mới + đánh dấu retiring.
      //    FOR UPDATE: khoá hàng version cao nhất để hai provision đồng thời cùng purpose KHÔNG đọc cùng max
      //    rồi đua nhau INSERT/flip (mất một version hoặc bỏ flip). encryption_keys GLOBAL → khoá ở row-level.
      const curRes = await tx.execute(sql`
        SELECT key_version, kms_key_id, status
        FROM encryption_keys
        WHERE purpose = ${purpose}
        ORDER BY key_version DESC
        LIMIT 1
        FOR UPDATE
      `);
      const curRow = curRes.rows[0] as
        | { key_version: number; kms_key_id: string; status: string }
        | undefined;

      const maxVersion = curRow ? Number(curRow.key_version) : 0;
      if (curRow && (!Number.isInteger(maxVersion) || maxVersion < 1)) {
        // Registry hỏng (version rác) → NÉM thay vì sinh version chồng lấn im lặng.
        throw new Error(
          `provisionKeyVersion(${purpose}): key_version hiện tại không hợp lệ — chặn (fail-closed).`,
        );
      }
      const newKeyVersion = maxVersion + 1;
      // Dev: derive đường dẫn key mới từ base (Vault transit prod sẽ trả path riêng). Path != key material.
      const baseKmsKeyId = curRow?.kms_key_id ?? 'local-dev-kek';
      const newKmsKeyId = `${baseKmsKeyId.replace(/-v\d+$/, '')}-v${newKeyVersion}`;

      // 2) INSERT version mới 'active'. ON CONFLICT DO NOTHING: chạy lại sau crash không nhân đôi version.
      const ins = await tx.execute(sql`
        INSERT INTO encryption_keys (key_version, kms_key_id, purpose, status)
        VALUES (${newKeyVersion}, ${newKmsKeyId}, ${purpose}, 'active')
        ON CONFLICT (purpose, key_version) DO NOTHING
      `);
      // 0 row = version đã tồn tại (chạy lại sau crash đã land trước đó) → KHÔNG flip lại, báo loud để caller
      // biết đây là no-op idempotent, không phải provision mới. Tránh "thành công giả" khi không có gì đổi.
      const inserted = (ins.rowCount ?? 0) > 0;

      // 3) flip version active cũ → 'retiring' (KHÔNG chạm platform_accounts). Chỉ khi vừa INSERT version mới
      //    VÀ có version cũ đang 'active'.
      let retiredKeyVersion: number | null = null;
      if (inserted && curRow && curRow.status === 'active') {
        const upd = await tx.execute(sql`
          UPDATE encryption_keys
          SET status = 'retiring', retired_at = now()
          WHERE purpose = ${purpose} AND key_version = ${maxVersion} AND status = 'active'
        `);
        if ((upd.rowCount ?? 0) > 0) retiredKeyVersion = maxVersion;
      }

      return { purpose, newKeyVersion, retiredKeyVersion, inserted };
    });

    // 4) audit-of-record SAU khi tx commit thành công (append-only). Chỉ purpose + version + kms_key_id
    //    (Vault PATH) — KHÔNG key material/secret (BẤT BIẾN #3). Log sau commit ⇒ audit phản ánh state đã land.
    this.logger.log(
      `${AUDIT_TAG} provision purpose=${result.purpose} newVersion=${result.newKeyVersion} ` +
        `retiredVersion=${result.retiredKeyVersion ?? 'none'} inserted=${result.inserted}`,
    );
    return {
      purpose: result.purpose,
      newKeyVersion: result.newKeyVersion,
      retiredKeyVersion: result.retiredKeyVersion,
    };
  }

  private requireWorkerDb(): NonNullable<typeof workerDb> {
    const dbw = workerDb;
    if (!dbw) {
      throw new Error('SecretProvisioningService: workerDb chưa cấu hình (DATABASE_WORKER_URL/DIRECT_URL).');
    }
    return dbw;
  }

  /**
   * Chặn provisioning chạy bằng role BYPASS RLS (mirror SecretRotationService — fail-closed mode 'strict',
   * chỉ env-flag ALLOW_SUPERUSER_ROTATION='true' mới hạ warn-only). KHÔNG dựa NODE_ENV.
   */
  private assertWorkerRoleSafe(dbw: NonNullable<typeof workerDb>): Promise<void> {
    return assertWorkerRoleSafeShared(dbw, {
      context: 'SecretProvisioningService',
      mode: 'strict',
      overrideEnvVar: 'ALLOW_SUPERUSER_ROTATION',
      logger: this.logger,
    });
  }
}
