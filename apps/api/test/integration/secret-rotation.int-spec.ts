/**
 * G6-2g integration suite — SecretRotationService re-wrap (RED 13).
 *
 * Rewritten from the 2b skeleton-RED. Seeds a REAL envelope (via SecretEncryptionService) so a faithful
 * reWrapAccount can unwrap→re-wrap the DEK, then asserts the FULL post-rotation contract (plan §6d,
 * DECISION A — rotate the KEK identity, NOT the seal version):
 *   13a  reWrapAccount resolves (void)
 *   13b  encrypted_dek changes; kms_key_id becomes the new active key; ciphertext/iv/tag bytes UNCHANGED
 *   13c  worker pool (mediaos_worker) can SELECT the row (platform_accounts_worker_all policy)
 *   13d  reWrapAll returns { rotated: number } and rotates the not-yet-rotated rows
 *   13e  reWrapAccount is idempotent — two calls keep the row valid (ciphertext unchanged, still decrypts)
 *   13f  decryptSecret STILL returns the original plaintext after rotation (round-trip survives) ⟵ forcing guard
 *   13g  dek_key_version is UNCHANGED (frozen secret AAD) and last_rotated_at is set
 *
 * RED source (2g not implemented): SecretRotationService.reWrapAccount/reWrapAll throw NOT_IMPLEMENTED:2g
 * synchronously, so every reWrap call rejects before the invariants can hold → RED for the right reason.
 *
 * ⚠️ Why 13f matters: the secret AAD (FROZEN, secret-encryption.service.ts:24) binds dek_key_version, and
 *    the reveal path rebuilds it from the persisted column. If rotation changed dek_key_version, the
 *    unchanged ciphertext would fail to open on the next reveal — a silent crown-jewel break the prior
 *    skeleton tests (no decrypt call) could not catch. 13f + 13g pin the version-preserving design.
 *
 * ⚠️ encryption_keys is GLOBAL (no tenant). This suite seeds key_version=2 'active' + flips v1 'retiring'
 *    in beforeAll, and FULLY restores it (delete v2, v1→active) in afterAll. Dev uses ONE file KEK, so the
 *    v2 label re-wraps the DEK under the same material — this exercises the rotation bookkeeping + the
 *    wrap-AAD re-bind path (true KEK rotation = Vault transit, prod-only). Existing rows in other suites
 *    are unaffected: decrypt reads each row's own (kms_key_id, dek_key_version) + the file KEK, never the
 *    registry. Parallel test forks may briefly observe v2 active — benign for the same reason.
 *
 * Runs on real Postgres; auto-skip when DATABASE_URL missing.
 */

import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SecretRotationService } from '../../src/crypto/secret-rotation.service';
import { SecretEncryptionService } from '../../src/crypto/secret-encryption.service';
import { NodeEnvelopeCipher } from '../../src/crypto/envelope-cipher';
import { LocalKekProvider } from '../../src/crypto/local-kek.provider';
import type { EncryptedColumns } from '../../src/crypto/secret-encryption.types';
import { directPool, hasDb, workerPool } from '../helpers/integration-db';
import {
  cleanupTenants,
  seedCompany,
  seedPlatformAccount,
  type SeededTenant,
} from '../helpers/seed';

const PURPOSE = 'platform_account' as const;
/** Plaintext sealed into every seeded account so RED 13f can round-trip a successful decrypt after rotation. */
const ROTATE_SECRET = 'rotation-roundtrip-secret-value';
/** kms_key_id of the seeded key_version=2 — the rotation TARGET every row must end up wrapped under. */
const TARGET_KMS_KEY_ID = 'local-dev-kek-v2';

/** Raw envelope columns (direct read, superuser — bypasses RLS). */
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

describe.skipIf(!hasDb)('G6-2g RED 13 — SecretRotationService re-wrap (decision A: rotate KEK identity, pin seal version)', () => {
  const direct = directPool();
  const worker = workerPool();
  const kms = new LocalKekProvider();
  const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), kms);

  let tenant: SeededTenant;
  let acctInvariants: string; // 13a/13b/13g
  let acctRoundTrip: string;  // 13f
  let acctIdem: string;       // 13e
  let acctBulk: string;       // 13d
  let rotationSvc: SecretRotationService;

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

  /** Seed an account and overwrite its envelope with a REAL one sealed under the CURRENTLY active key. */
  async function seedRealEnvelope(): Promise<string> {
    const id = await seedPlatformAccount(direct, tenant.companyId);
    const env = await secrets.encryptSecret(ROTATE_SECRET, {
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

  beforeAll(async () => {
    tenant = await seedCompany(direct, 'g62rot');

    // 0) Defensive baseline: a prior CRASHED run may have left v2 'active' (afterAll is skipped on a hard
    //    fork crash). Force the migration-0022 state (v1 active, no v2) so accounts seal under v1 — the
    //    suite is then self-healing and version-pin assertions (13g) are deterministic regardless of history.
    await direct.query(`DELETE FROM encryption_keys WHERE purpose=$1 AND key_version=2`, [PURPOSE]);
    await direct.query(
      `UPDATE encryption_keys SET status='active', retired_at=NULL WHERE purpose=$1 AND key_version=1`,
      [PURPOSE],
    );

    // 1) Seal all accounts under v1 (the migration-0022 active key 'local-dev-kek') BEFORE flipping.
    acctInvariants = await seedRealEnvelope();
    acctRoundTrip = await seedRealEnvelope();
    acctIdem = await seedRealEnvelope();
    acctBulk = await seedRealEnvelope();

    // 2) Flip the GLOBAL registry: introduce v2 as the new active key, mark v1 retiring. currentKey() now
    //    returns ('local-dev-kek-v2', 2) → the rotation target. Idempotent so a crashed prior run is safe.
    await direct.query(
      `INSERT INTO encryption_keys (key_version, kms_key_id, purpose, status)
       VALUES (2, $1, $2, 'active')
       ON CONFLICT (purpose, key_version) DO UPDATE SET kms_key_id = EXCLUDED.kms_key_id, status = 'active'`,
      [TARGET_KMS_KEY_ID, PURPOSE],
    );
    await direct.query(
      `UPDATE encryption_keys SET status='retiring' WHERE purpose=$1 AND key_version=1`,
      [PURPOSE],
    );

    rotationSvc = new SecretRotationService(kms);
  });

  afterAll(async () => {
    // Restore the GLOBAL registry to its migration-0022 baseline so other suites/runs see v1 active.
    await direct.query(`DELETE FROM encryption_keys WHERE purpose=$1 AND key_version=2`, [PURPOSE]);
    await direct.query(
      `UPDATE encryption_keys SET status='active', retired_at=NULL WHERE purpose=$1 AND key_version=1`,
      [PURPOSE],
    );
    await cleanupTenants(direct, [tenant.companyId]);
    await direct.end();
    await worker.end();
  });

  it('RED 13a — reWrapAccount resolves (void) — currently throws NOT_IMPLEMENTED:2g', async () => {
    await expect(rotationSvc.reWrapAccount(acctInvariants)).resolves.toBeUndefined();
  });

  it('RED 13b — encrypted_dek changes, kms_key_id → new active key, ciphertext/iv/tag bytes UNCHANGED', async () => {
    const before = await fetchEnvelope(acctInvariants);
    await rotationSvc.reWrapAccount(acctInvariants);
    const after = await fetchEnvelope(acctInvariants);

    // DEK re-wrapped under the new KEK identity (fresh GCM IV → bytes differ even under the same material).
    expect(after.encrypted_dek.toString('hex')).not.toBe(before.encrypted_dek.toString('hex'));
    // Rotation TARGET reached (absolute assertion → order-independent across re-runs of this account).
    expect(after.kms_key_id).toBe(TARGET_KMS_KEY_ID);
    // Re-wrap touches the DEK wrapping ONLY — the sealed secret stays byte-for-byte identical.
    expect(after.secret_ciphertext.toString('hex')).toBe(before.secret_ciphertext.toString('hex'));
    expect(after.iv_nonce.toString('hex')).toBe(before.iv_nonce.toString('hex'));
    expect(after.auth_tag.toString('hex')).toBe(before.auth_tag.toString('hex'));
  });

  it('RED 13c — worker pool (mediaos_worker) can SELECT the platform_account row (worker_all policy)', async () => {
    const res = await worker.query(`SELECT id FROM platform_accounts WHERE id = $1`, [acctInvariants]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].id).toBe(acctInvariants);
  });

  it('RED 13d — reWrapAll returns { rotated: number } and rotates the not-yet-rotated rows', async () => {
    const result = await rotationSvc.reWrapAll(PURPOSE);
    expect(typeof result.rotated).toBe('number');
    expect(result.rotated).toBeGreaterThanOrEqual(1);
    // acctBulk (dedicated to this case) must now be wrapped under the target key.
    const after = await fetchEnvelope(acctBulk);
    expect(after.kms_key_id).toBe(TARGET_KMS_KEY_ID);
  });

  it('RED 13e — reWrapAccount is idempotent: two calls keep the row valid + still decryptable', async () => {
    await rotationSvc.reWrapAccount(acctIdem);
    const mid = await fetchEnvelope(acctIdem);
    await rotationSvc.reWrapAccount(acctIdem);
    const after = await fetchEnvelope(acctIdem);

    // Ciphertext never changes across re-wraps; kms_key_id stays at the target on the second pass.
    expect(after.secret_ciphertext.toString('hex')).toBe(mid.secret_ciphertext.toString('hex'));
    expect(after.kms_key_id).toBe(TARGET_KMS_KEY_ID);
    const plaintext = await secrets.decryptSecret(toEncryptedColumns(after), {
      companyId: tenant.companyId,
      recordId: acctIdem,
      purpose: PURPOSE,
    });
    expect(plaintext).toBe(ROTATE_SECRET);
  });

  it('RED 13f — decryptSecret STILL returns the original plaintext after rotation (round-trip survives)', async () => {
    await rotationSvc.reWrapAccount(acctRoundTrip);
    const after = await fetchEnvelope(acctRoundTrip);
    expect(after.kms_key_id).toBe(TARGET_KMS_KEY_ID); // rotation actually happened
    const plaintext = await secrets.decryptSecret(toEncryptedColumns(after), {
      companyId: tenant.companyId,
      recordId: acctRoundTrip,
      purpose: PURPOSE,
    });
    expect(plaintext).toBe(ROTATE_SECRET);
  });

  it('RED 13g — dek_key_version is UNCHANGED (frozen secret AAD) and last_rotated_at is set', async () => {
    const before = await fetchEnvelope(acctInvariants);
    await rotationSvc.reWrapAccount(acctInvariants);
    const after = await fetchEnvelope(acctInvariants);

    // The seal version is immutable — rotating it would break decrypt of the preserved ciphertext.
    expect(after.dek_key_version).toBe(before.dek_key_version);
    expect(after.dek_key_version).toBe(1);
    // Rotation stamps the audit-of-record timestamp.
    expect(after.last_rotated_at).not.toBeNull();
  });

  it('RED 13h — reWrapAll: a tamper/corrupt row lands in failed[] (NOT rotated) + emits an AGGREGATE error log', async () => {
    // Silence + capture every logger.error. The PER-ROW dark log already exists; the NEW contract is a single
    // AGGREGATE summary (`failedIds=…`) so monitoring has one signal to alert on instead of N scattered lines.
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    let tamperedId: string | undefined;
    try {
      // Stale v1 row (kms_key_id != target → selected by reWrapAll) whose encrypted_dek is garbage → GCM unwrap
      // throws → the row must be RECORDED in failed[], skipped, and NEVER counted as rotated.
      tamperedId = await seedPlatformAccount(direct, tenant.companyId, {
        encrypted_dek: Buffer.alloc(40, 7),
        kms_key_id: 'local-dev-kek',
        dek_key_version: 1,
      });

      const result = await rotationSvc.reWrapAll(PURPOSE);

      // The corrupt row is surfaced as a failure, not swallowed…
      expect(result.failed.some((f) => f.id === tamperedId)).toBe(true);
      // …and was NOT rotated: its envelope is byte-for-byte unchanged (still v1, never stamped).
      const after = await fetchEnvelope(tamperedId);
      expect(after.kms_key_id).toBe('local-dev-kek');
      expect(after.last_rotated_at).toBeNull();
      // BOTH signals fire: the per-row line AND a single aggregate line — a corrupt row can't fail in the dark.
      expect(errorSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('failedIds='));
    } finally {
      errorSpy.mockRestore();
      // Remove the tampered row so a crashed/interrupted run can't leave it to contaminate other suites' global
      // reWrapAll scans on a later run (reWrapAll is cross-tenant by design).
      if (tamperedId) await direct.query('DELETE FROM platform_accounts WHERE id = $1', [tamperedId]);
    }
  });

  it('RED 13i — reWrapAccount THROWS on a missing/vanished account (no silent no-op)', async () => {
    // A caller naming a specific account expects it to rotate; a 0-row result must fail loud, not resolve void.
    await expect(rotationSvc.reWrapAccount(randomUUID())).rejects.toThrow(/account không tồn tại.*0 row/);
  });
});
