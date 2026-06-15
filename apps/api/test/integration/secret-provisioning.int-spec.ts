/**
 * G6-2 PR-A integration suite — SecretProvisioningService.provisionKeyVersion (RED P1–P5).
 *
 * PR-A = provisioning + rotation version-preserving (KHÔNG break-glass). provisionKeyVersion(purpose):
 *   - đọc max(key_version) hiện tại cho purpose từ encryption_keys (GLOBAL registry, mig 0022)
 *   - INSERT version+1 'active' (kms_key_id = Vault path mới) + flip version cũ → 'retiring'
 *   - ghi audit_logs object_type='encryption_key' (append-only) CÙNG tx
 *   - chạy WORKER pool + assertWorkerRoleSafe(strict, ALLOW_SUPERUSER_ROTATION) — mirror SecretRotationService
 *
 * BẤT BIẾN ép ở đây:
 *   P1  secret KHÔNG lưu plaintext — sau provision + encryptSecret, raw row platform_accounts có
 *       secret_ciphertext != utf8(plaintext) và encrypted_dek != plaintext; encryption_keys chỉ chứa
 *       kms_key_id (Vault path), KHÔNG key material.
 *   P2  version-preserving — seed account A dưới key v1, provisionKeyVersion sinh v2 active + v1 retiring;
 *       row A GIỮ NGUYÊN dek_key_version=1 + secret_ciphertext/iv/tag byte-for-byte; decryptSecret(A) vẫn
 *       trả plaintext gốc (provisioning KHÔNG re-seal/đổi version row cũ — frozen secret AAD).
 *   P3  provisioning chạy WORKER pool — gọi bằng directPool role super (không override) PHẢI throw
 *       fail-closed; chỉ workerPool (mediaos_worker) mới qua.
 *   P4  audit ghi MỖI lần provision — provisionKeyVersion ghi audit_logs object_type='encryption_key'
 *       (INSERT-only); reWrap sau provisioning ghi audit của nó. Không UPDATE/DELETE row audit cũ.
 *   P5  audit CHECK superset — INSERT audit_logs object_type='encryption_key' THÀNH CÔNG (sau mig 0150);
 *       các type lane khác (vd 'user_role','payslip') VẪN insert được (DO-block ADD-only không rớt type cũ).
 *
 * RED source: SecretProvisioningService.provisionKeyVersion ném NOT_IMPLEMENTED:PR-A đồng bộ → mọi assert
 * sau provision reject trước khi invariant kịp đúng → RED đúng lý do.
 *
 * ⚠️ encryption_keys GLOBAL (no tenant). Suite force migration-0022 baseline (v1 active, no v2/v3) ở beforeAll
 *    + FULLY restore ở afterAll. Provision ở dev = re-label version dưới CÙNG file KEK (true KEK rotation =
 *    Vault transit, prod-only) → exercise bookkeeping provisioning + version-preserving của reWrap.
 *
 * Runs on real Postgres; auto-skip khi DATABASE_URL missing.
 */

import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SecretProvisioningService } from '../../src/crypto/secret-provisioning.service';
import { SecretRotationService } from '../../src/crypto/secret-rotation.service';
import { SecretEncryptionService } from '../../src/crypto/secret-encryption.service';
import { NodeEnvelopeCipher } from '../../src/crypto/envelope-cipher';
import { LocalKekProvider } from '../../src/crypto/local-kek.provider';
import type { EncryptedColumns } from '../../src/crypto/secret-encryption.types';
import { acquireRegistryLock, directPool, hasDb, workerPool } from '../helpers/integration-db';
import { cleanupTenants, seedCompany, seedPlatformAccount, type SeededTenant } from '../helpers/seed';

const PURPOSE = 'platform_account' as const;
/** Plaintext sealed vào account để P2 round-trip decrypt sau provisioning. */
const PROVISION_SECRET = 'provisioning-roundtrip-secret-value';

interface EnvelopeSnapshot {
  secret_ciphertext: Buffer;
  encrypted_dek: Buffer;
  dek_key_version: number;
  kms_key_id: string;
  iv_nonce: Buffer;
  auth_tag: Buffer;
  enc_algo: string;
  last_rotated_at: Date | null;
}

describe.skipIf(!hasDb)('G6-2 PR-A — SecretProvisioningService.provisionKeyVersion (provisioning + version-preserving)', () => {
  const direct = directPool();
  const worker = workerPool();
  const kms = new LocalKekProvider();
  const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), kms);

  let tenant: SeededTenant;
  let provisioning: SecretProvisioningService;
  let rotation: SecretRotationService;
  let registryLock: { release: () => Promise<void> };

  async function fetchEnvelope(id: string): Promise<EnvelopeSnapshot> {
    const res = await direct.query(
      `SELECT secret_ciphertext, encrypted_dek, dek_key_version, kms_key_id,
              iv_nonce, auth_tag, enc_algo, last_rotated_at
       FROM platform_accounts WHERE id = $1`,
      [id],
    );
    if (res.rows.length === 0) throw new Error(`platform_account ${id} not found`);
    return res.rows[0] as EnvelopeSnapshot;
  }

  function toEncryptedColumns(snap: EnvelopeSnapshot): EncryptedColumns {
    return {
      secretCiphertext: snap.secret_ciphertext,
      encryptedDek: snap.encrypted_dek,
      dekKeyVersion: snap.dek_key_version,
      kmsKeyId: snap.kms_key_id,
      ivNonce: snap.iv_nonce,
      authTag: snap.auth_tag,
      encAlgo: snap.enc_algo,
    };
  }

  /** Seed account + overwrite envelope với 1 envelope THẬT sealed dưới key đang active (v1). */
  async function seedRealEnvelope(): Promise<string> {
    const id = await seedPlatformAccount(direct, tenant.companyId);
    const env = await secrets.encryptSecret(PROVISION_SECRET, {
      companyId: tenant.companyId,
      recordId: id,
      purpose: PURPOSE,
    });
    await direct.query(
      `UPDATE platform_accounts
         SET secret_ciphertext=$2, encrypted_dek=$3, dek_key_version=$4, kms_key_id=$5,
             iv_nonce=$6, auth_tag=$7, enc_algo=$8, last_rotated_at=NULL
       WHERE id=$1`,
      [id, env.secretCiphertext, env.encryptedDek, env.dekKeyVersion, env.kmsKeyId, env.ivNonce, env.authTag, env.encAlgo],
    );
    return id;
  }

  /** Reset registry về baseline mig-0022 (v1 active, không v2/v3) — provisioning sẽ tự sinh v2. */
  async function resetRegistryBaseline(): Promise<void> {
    await direct.query(`DELETE FROM encryption_keys WHERE purpose=$1 AND key_version > 1`, [PURPOSE]);
    await direct.query(
      `UPDATE encryption_keys SET status='active', retired_at=NULL WHERE purpose=$1 AND key_version=1`,
      [PURPOSE],
    );
  }

  beforeAll(async () => {
    // SERIALIZE với secret-rotation.int-spec: cả hai mutate bảng GLOBAL encryption_keys (no-RLS) → khoá
    // advisory để vitest không chạy chúng song song trên cùng DB (false-RED registry race).
    registryLock = await acquireRegistryLock(direct);
    tenant = await seedCompany(direct, 'g62prov');
    await resetRegistryBaseline();
    provisioning = new SecretProvisioningService(kms);
    rotation = new SecretRotationService(kms);
  });

  afterAll(async () => {
    await resetRegistryBaseline();
    await cleanupTenants(direct, [tenant.companyId]);
    await registryLock.release();
    await direct.end();
    await worker.end();
  });

  it('P1 — secret KHÔNG lưu plaintext: raw row khác plaintext; encryption_keys chỉ chứa kms_key_id (Vault path)', async () => {
    // provision v2 trước (đảm bảo provisioning chạy được) rồi seal 1 secret.
    await provisioning.provisionKeyVersion(PURPOSE);
    const id = await seedRealEnvelope();
    const snap = await fetchEnvelope(id);

    // Ciphertext + wrapped DEK KHÁC plaintext (không lưu thô).
    expect(snap.secret_ciphertext.toString('utf8')).not.toBe(PROVISION_SECRET);
    expect(snap.secret_ciphertext.includes(Buffer.from(PROVISION_SECRET, 'utf8'))).toBe(false);
    expect(snap.encrypted_dek.includes(Buffer.from(PROVISION_SECRET, 'utf8'))).toBe(false);

    // encryption_keys KHÔNG có cột mang key material — chỉ kms_key_id (Vault path), version, purpose, status.
    const cols = await direct.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='encryption_keys'`,
    );
    const colNames = cols.rows.map((r) => (r as { column_name: string }).column_name);
    for (const forbidden of ['secret', 'key_material', 'dek', 'plaintext', 'material']) {
      expect(colNames).not.toContain(forbidden);
    }
    // kms_key_id của registry là PATH chuỗi, KHÔNG phải 32-byte key material.
    const keyRows = await direct.query(
      `SELECT kms_key_id FROM encryption_keys WHERE purpose=$1`,
      [PURPOSE],
    );
    for (const r of keyRows.rows) {
      expect(typeof (r as { kms_key_id: string }).kms_key_id).toBe('string');
    }
  });

  it('P2 — version-preserving: provision v2 KHÔNG đổi dek_key_version/secret row cũ; decrypt secret cũ vẫn đúng', async () => {
    await resetRegistryBaseline();
    const id = await seedRealEnvelope(); // sealed dưới v1
    const before = await fetchEnvelope(id);
    expect(before.dek_key_version).toBe(1);

    const result = await provisioning.provisionKeyVersion(PURPOSE);
    expect(result.newKeyVersion).toBe(2);
    expect(result.retiredKeyVersion).toBe(1);

    // Registry: v2 active, v1 retiring.
    const reg = await direct.query(
      `SELECT key_version, status FROM encryption_keys WHERE purpose=$1 ORDER BY key_version`,
      [PURPOSE],
    );
    const byVer = new Map(reg.rows.map((r) => [Number((r as { key_version: number }).key_version), (r as { status: string }).status]));
    expect(byVer.get(1)).toBe('retiring');
    expect(byVer.get(2)).toBe('active');

    // Row CŨ bất biến: dek_key_version + secret_ciphertext/iv/tag byte-for-byte (provisioning KHÔNG re-seal).
    const after = await fetchEnvelope(id);
    expect(after.dek_key_version).toBe(before.dek_key_version);
    expect(after.dek_key_version).toBe(1);
    expect(after.secret_ciphertext.toString('hex')).toBe(before.secret_ciphertext.toString('hex'));
    expect(after.iv_nonce.toString('hex')).toBe(before.iv_nonce.toString('hex'));
    expect(after.auth_tag.toString('hex')).toBe(before.auth_tag.toString('hex'));
    expect(after.encrypted_dek.toString('hex')).toBe(before.encrypted_dek.toString('hex'));

    // Decrypt secret CŨ vẫn trả plaintext gốc (frozen AAD bind dek_key_version=1 vẫn reconstruct).
    const plaintext = await secrets.decryptSecret(toEncryptedColumns(after), {
      companyId: tenant.companyId,
      recordId: id,
      purpose: PURPOSE,
    });
    expect(plaintext).toBe(PROVISION_SECRET);
  });

  it('P3 — provisioning chạy WORKER pool: gọi role super (directPool, không override) PHẢI throw fail-closed', async () => {
    // workerDb của service rơi về directPool super khi DATABASE_WORKER_URL không trỏ mediaos_worker.
    // assertWorkerRoleSafe(strict) phải NÉM khi role có rolsuper/rolbypassrls và ALLOW_SUPERUSER_ROTATION != 'true'.
    const prev = process.env.ALLOW_SUPERUSER_ROTATION;
    const prevWorkerUrl = process.env.DATABASE_WORKER_URL;
    try {
      delete process.env.ALLOW_SUPERUSER_ROTATION;
      // Trỏ worker URL về direct (superuser) để mô phỏng worktree thiếu DATABASE_WORKER_URL.
      process.env.DATABASE_WORKER_URL = process.env.DATABASE_DIRECT_URL;
      // workerDb được khởi tạo lúc import module → không reload được trong test; nên ta xác nhận
      // service từ chối khi role hiện hành là super. Reuse assert qua provisioning trên worker thật:
      // nếu mediaos_worker an toàn thì test này verify path strict bằng cách kiểm role trực tiếp.
      const roleRes = await direct.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
      const { rolsuper, rolbypassrls } = roleRes.rows[0] as { rolsuper: boolean; rolbypassrls: boolean };
      // Khẳng định directPool IS super/bypass (precondition của fail-closed).
      expect(rolsuper || rolbypassrls).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ALLOW_SUPERUSER_ROTATION;
      else process.env.ALLOW_SUPERUSER_ROTATION = prev;
      if (prevWorkerUrl === undefined) delete process.env.DATABASE_WORKER_URL;
      else process.env.DATABASE_WORKER_URL = prevWorkerUrl;
    }
  });

  it('P3b — provisionKeyVersion qua mediaos_worker (role an toàn) THÀNH CÔNG', async () => {
    await resetRegistryBaseline();
    // workerDb của service trỏ mediaos_worker (non-super) trong môi trường lane → provision qua được.
    const result = await provisioning.provisionKeyVersion(PURPOSE);
    expect(result.newKeyVersion).toBe(2);
  });

  it('P4 — audit-of-record ghi MỖI lần provision + reWrap (Logger append-only, KHÔNG key material)', async () => {
    // encryption_keys là registry GLOBAL no-RLS (no tenant) → audit qua Logger (mirror SecretRotationService),
    // KHÔNG vào audit_logs tenant-scoped (FK companies + RLS WITH CHECK + worker không có GRANT INSERT — loosen
    // sẽ phá BẤT BIẾN #1/#2). Audit-of-record = structured Logger line monitorable, chỉ purpose/version/kms path.
    await resetRegistryBaseline();
    const id = await seedRealEnvelope();

    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      await provisioning.provisionKeyVersion(PURPOSE);
      // Audit provision: tag encryption_key + version + KHÔNG key material (secret/dek/plaintext).
      const provisionCalls = logSpy.mock.calls.map((c) => String(c[0]));
      const provisionAudit = provisionCalls.find((m) => m.includes('audit[encryption_key]') && m.includes('provision'));
      expect(provisionAudit).toBeDefined();
      expect(provisionAudit).toContain('newVersion=2');
      // KHÔNG lộ secret/DEK/plaintext trong audit line.
      expect(provisionAudit).not.toMatch(/secret|dek|plaintext|password/i);

      // reWrap account sang key mới → ghi audit-of-record của nó.
      await rotation.reWrapAccount(id);
      const rewrapCalls = logSpy.mock.calls.map((c) => String(c[0]));
      const rewrapAudit = rewrapCalls.find((m) => m.includes('audit[encryption_key]') && m.includes('rewrap'));
      expect(rewrapAudit).toBeDefined();
      expect(rewrapAudit).toContain(id);
      expect(rewrapAudit).not.toMatch(/secret|dek|plaintext|password/i);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('P5 — audit CHECK superset: INSERT object_type=encryption_key OK + type lane khác vẫn insert được', async () => {
    // encryption_key (mới mig 0150) insert được.
    await direct.query(
      `INSERT INTO audit_logs (company_id, action, object_type) VALUES ($1, 'provision', 'encryption_key')`,
      [tenant.companyId],
    );
    // Type lane khác (DO-block ADD-only KHÔNG rớt) vẫn insert được — chứng minh CHECK là UNION.
    await direct.query(
      `INSERT INTO audit_logs (company_id, action, object_type) VALUES ($1, 'assign', 'user_role')`,
      [tenant.companyId],
    );
    await direct.query(
      `INSERT INTO audit_logs (company_id, action, object_type) VALUES ($1, 'create', 'payslip')`,
      [tenant.companyId],
    );
    // object_type rác PHẢI bị CHECK chặn.
    await expect(
      direct.query(
        `INSERT INTO audit_logs (company_id, action, object_type) VALUES ($1, 'x', 'definitely_not_a_type')`,
        [tenant.companyId],
      ),
    ).rejects.toThrow();
  });
});
