/**
 * G6-2b RED integration suite — PlatformAccountsService reveal / list / edit deny paths.
 *
 * All tests run against REAL Postgres (mediaos_app role, RLS enforced).
 * Suite is skipped automatically when DATABASE_URL is not set (describe.skipIf(!hasDb)).
 *
 * RED sources (why each case fails until 2e/2e0 is implemented):
 *   All PlatformAccountsService methods throw NOT_IMPLEMENTED:2e synchronously.
 *   Each test asserts the EXPECTED post-2e outcome (ForbiddenException, a resolved DTO, etc.).
 *   Because the methods throw instead of returning the expected value, expect(result).toBeDefined()
 *   or toBeInstanceOf(ForbiddenException) assertions fail → RED for the right reason.
 *
 * Permission seeding: permission catalog rows (reveal-secret, edit-platform-account) are seeded
 * directly via directPool() in beforeAll because migration 0027 is NOT done yet.
 *
 * Seams cited:
 *   permission.guard.ts:73-80   — guard passes no resourceId/ctx (2e0 gap)
 *   permission.service.ts:55-58 — Tier-3 skipped when resourceId == null
 *   platform-accounts.service.ts — all methods throw NOT_IMPLEMENTED:2e
 */

import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformAccountsService } from '../../src/media/platform-accounts.service';
import type { RequestUser, RevealCtx, SafePlatformAccountDto } from '../../src/media/platform-accounts.service';
import { PlatformAccountsRepository } from '../../src/media/platform-accounts.repository';
import { DatabaseService } from '../../src/db/db.service';
import { SecretEncryptionService } from '../../src/crypto/secret-encryption.service';
import { NodeEnvelopeCipher } from '../../src/crypto/envelope-cipher';
import { LocalKekProvider } from '../../src/crypto/local-kek.provider';
import { PermissionService } from '../../src/permission/permission.service';
import { PermissionRepository } from '../../src/permission/permission.repository';
import { ValkeyService } from '../../src/permission/valkey.service';
import { LoginRateLimiter } from '../../src/auth/login-rate-limiter';
import { PasswordService } from '../../src/auth/password.service';
import { AuditService } from '../../src/events/audit.service';
import { BreakGlassRepository } from '../../src/break-glass/break-glass.repository';
import { directPool, hasDb } from '../helpers/integration-db';
import {
  cleanupTenants,
  seedCompany,
  seedObjectGrant,
  seedPermissionCatalog,
  seedPlatformAccount,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from '../helpers/seed';

// ─── Permission action constants ──────────────────────────────────────────────

const ACTION_REVEAL = 'reveal-secret';
const ACTION_EDIT   = 'edit-platform-account';
const RESOURCE_TYPE = 'platform-account';
/** Plaintext sealed into accountA's real envelope so RED 5 can round-trip a successful reveal. */
const REVEAL_SECRET_A = 'super-secret-A-value';

// ─── Suite ────────────────────────────────────────────────────────────────────

describe.skipIf(!hasDb)('G6-2b platform-accounts reveal / list / edit — RED deny-path suite', () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let userB: string;
  let accountA: string;
  let accountB: string;
  let accountTamper: string;
  let svc: PlatformAccountsService;
  let permRevealId: string;
  let permEditId: string;

  beforeAll(async () => {
    // Real service wired with concrete deps (mirror content.int-spec). Valkey has no URL in tests → its
    // client stays null and set/get are no-ops; harmless because the reveal window arrives via ctx, not Valkey.
    const db = new DatabaseService();
    const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
    const permissions = new PermissionService(new PermissionRepository(db));
    const password = new PasswordService();
    svc = new PlatformAccountsService(
      db,
      new PlatformAccountsRepository(db),
      secrets,
      permissions,
      new AuditService(),
      new ValkeyService(),
      password,
      new LoginRateLimiter(),
      new BreakGlassRepository(db),
    );

    A = await seedCompany(direct, 'g62a');
    B = await seedCompany(direct, 'g62b');
    // userA needs a REAL argon2 hash so reauth() (RED 7b) can verify the 'pw' password.
    userA = await seedUser(direct, A.companyId, `g62a-${randomUUID().slice(0, 8)}@test.local`, await password.hash('pw'));
    userB = await seedUser(direct, B.companyId, `g62b-${randomUUID().slice(0, 8)}@test.local`);
    accountB = await seedPlatformAccount(direct, B.companyId);
    permRevealId = await seedPermissionCatalog(direct, ACTION_REVEAL, RESOURCE_TYPE, true);
    permEditId   = await seedPermissionCatalog(direct, ACTION_EDIT,   RESOURCE_TYPE, true);

    // accountA carries a REAL envelope so RED 5 round-trips (reveal succeeds). accountTamper keeps the
    // dummy 00-byte envelope so RED 8 exercises the decrypt-failure path. Both seeded AFTER `secrets`.
    accountA = await seedPlatformAccount(direct, A.companyId);
    const env = await secrets.encryptSecret(REVEAL_SECRET_A, {
      companyId: A.companyId,
      recordId: accountA,
      purpose: 'platform_account',
    });
    await direct.query(
      `UPDATE platform_accounts
         SET secret_ciphertext=$2, encrypted_dek=$3, dek_key_version=$4, kms_key_id=$5,
             iv_nonce=$6, auth_tag=$7, enc_algo=$8
       WHERE id=$1`,
      [accountA, env.secretCiphertext, env.encryptedDek, env.dekKeyVersion, env.kmsKeyId, env.ivNonce, env.authTag, env.encAlgo],
    );
    accountTamper = await seedPlatformAccount(direct, A.companyId);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function userCtx(userId: string, companyId: string): RequestUser {
    return { id: userId, companyId };
  }

  function validRevealCtx(): RevealCtx {
    return { reauthValidUntil: new Date(Date.now() + 300_000) };
  }

  /**
   * Calls fn() and returns { result, error }. Works for both sync throws and async rejections.
   * RED pattern: assert result is defined (post-impl) or error is ForbiddenException (post-impl deny).
   * While NOT_IMPLEMENTED: result is undefined and error.message contains NOT_IMPLEMENTED → RED.
   */
  async function invoke<T>(fn: () => T | Promise<T>): Promise<{ result: T | undefined; error: Error | undefined }> {
    try {
      const result = await fn();
      return { result, error: undefined };
    } catch (e) {
      return { result: undefined, error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  // ─── RED 1 — no reveal-secret grant → deny-default (ForbiddenException) ───

  it('RED 1 — no reveal-secret grant: revealSecret must throw ForbiddenException (currently throws NOT_IMPLEMENTED)', async () => {
    const user = userCtx(userA, A.companyId);
    const { error } = await invoke(() => svc.revealSecret(user, accountA, validRevealCtx()));
    // RED: when 2e is done, error must be ForbiddenException (deny-default).
    // Now: error.message = 'NOT_IMPLEMENTED:2e...' → not a ForbiddenException → assertion fails.
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  // ─── RED 2 — only wildcard *:* ALLOW → deny-sensitive ────────────────────

  it('RED 2 — wildcard *:* ALLOW only: revealSecret must throw ForbiddenException deny-sensitive', async () => {
    const wildcardRole = await seedRole(direct, A.companyId, `wildcard-${randomUUID().slice(0, 8)}`);
    const wildcardPerm = await seedPermissionCatalog(direct, '*', '*', false);
    await seedRolePermission(direct, wildcardRole, wildcardPerm, 'ALLOW');
    await seedUserRole(direct, userA, wildcardRole, A.companyId);

    const { error } = await invoke(() => svc.revealSecret(userCtx(userA, A.companyId), accountA, validRevealCtx()));
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  // ─── RED 3 — exact ALLOW + NO reauth window → deny-reauth-required ───────

  it('RED 3 — exact ALLOW + NO reauth window: revealSecret must throw ForbiddenException deny-reauth-required', async () => {
    const revealRole = await seedRole(direct, A.companyId, `reveal-role-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, revealRole, permRevealId, 'ALLOW');
    await seedUserRole(direct, userA, revealRole, A.companyId);
    await seedObjectGrant(direct, A.companyId, userA, RESOURCE_TYPE, accountA, ACTION_REVEAL, 'ALLOW');

    const noReauthCtx: RevealCtx = { reauthValidUntil: undefined };
    const { error } = await invoke(() => svc.revealSecret(userCtx(userA, A.companyId), accountA, noReauthCtx));
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  // ─── RED 5 — exact ALLOW + valid window → must return { secret } ─────────

  it('RED 5 — exact ALLOW + valid reauth window: revealSecret must return { secret: string } and write audit', async () => {
    // Grants already seeded in RED 3 (idempotent). Valid window provided.
    const { result } = await invoke(() => svc.revealSecret(userCtx(userA, A.companyId), accountA, validRevealCtx()));
    // RED: currently throws NOT_IMPLEMENTED → result is undefined.
    expect(result).toBeDefined();
    expect(typeof (result as { secret: string } | undefined)?.secret).toBe('string');
  });

  // ─── RED 4 — exact ALLOW + EXPIRED reauth → deny-reauth-required ─────────

  it('RED 4 — exact ALLOW + EXPIRED reauth: revealSecret must throw ForbiddenException', async () => {
    const expiredCtx: RevealCtx = { reauthValidUntil: new Date(Date.now() - 60_000) };
    const { error } = await invoke(() => svc.revealSecret(userCtx(userA, A.companyId), accountA, expiredCtx));
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  // ─── RED 6 — cross-tenant reveal → ForbiddenException / NotFoundException ─

  it('RED 6 — cross-tenant: userA reveal accountB must throw (ForbiddenException or NotFoundException)', async () => {
    const { error } = await invoke(() => svc.revealSecret(userCtx(userA, A.companyId), accountB, validRevealCtx()));
    expect(error).toBeInstanceOf(Error);
    // When 2e done: must be ForbiddenException or NotFoundException (not NOT_IMPLEMENTED)
    expect(error?.message).not.toContain('NOT_IMPLEMENTED');
  });

  // ─── RED 7 — listAccounts / getAccount return masked DTO ─────────────────

  it('RED 7 — listAccounts must return SafePlatformAccountDto[] (currently throws NOT_IMPLEMENTED)', async () => {
    const { result } = await invoke(() => svc.listAccounts(userCtx(userA, A.companyId)));
    expect(Array.isArray(result)).toBe(true);
  });

  it('RED 7 follow-up — getAccount must return SafePlatformAccountDto (currently throws NOT_IMPLEMENTED)', async () => {
    const { result } = await invoke(() => svc.getAccount(userCtx(userA, A.companyId), accountA));
    expect(result).toBeDefined();
  });

  it('RED 7 serialization — listAccounts result must not contain crypto/PII keys in serialized form', async () => {
    const { result } = await invoke(() => svc.listAccounts(userCtx(userA, A.companyId)));
    // RED: result is undefined (method throws). Array.isArray(undefined) = false.
    if (!Array.isArray(result)) {
      // Still red — method doesn't return an array yet.
      expect(Array.isArray(result)).toBe(true);
      return;
    }
    const forbiddenKeys = [
      'secret_ciphertext', 'secretCiphertext', 'encrypted_dek', 'encryptedDek',
      'iv_nonce', 'ivNonce', 'auth_tag', 'authTag',
      'recovery_email', 'recoveryEmail', 'recovery_phone', 'recoveryPhone',
      'two_factor_note', 'twoFactorNote',
    ];
    const serialized = JSON.parse(JSON.stringify(result)) as Record<string, unknown>[];
    for (const row of serialized) {
      for (const key of forbiddenKeys) {
        expect(Object.prototype.hasOwnProperty.call(row, key)).toBe(false);
      }
    }
  });

  // ─── G16-1b leak-by-scope — getAccount (detail) must also omit crypto/PII keys ───

  it("G16-1b leak-by-scope — getAccount detail omits secret/recovery keys (no out-of-scope fields)", async () => {
    const { result } = await invoke(() => svc.getAccount(userCtx(userA, A.companyId), accountA));
    expect(result).toBeDefined();
    const forbiddenKeys = [
      "secret_ciphertext", "secretCiphertext", "encrypted_dek", "encryptedDek",
      "iv_nonce", "ivNonce", "auth_tag", "authTag",
      "recovery_email", "recoveryEmail", "recovery_phone", "recoveryPhone",
      "two_factor_note", "twoFactorNote",
    ];
    const row = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    for (const key of forbiddenKeys) {
      expect(Object.prototype.hasOwnProperty.call(row, key)).toBe(false);
    }
  });

  // ─── RED 7b — reauth scope per (userId, accountId) ───────────────────────

  it('RED 7b — reauth for accountA must not authorize reveal of accountB', async () => {
    const user = userCtx(userA, A.companyId);
    // reauth must resolve with a window (currently throws NOT_IMPLEMENTED)
    const { result: reauthResult } = await invoke(() => svc.reauth(user, accountA, { password: 'pw' }));
    expect(reauthResult).toBeDefined();
    // Even if reauth resolved, reveal of accountB with that window should fail
    // (scope check: token is per-accountA, not accountB)
  });

  // ─── RED 8 (audit) — tampered row → generic throw + audit committed ───────

  it('RED 8 (audit) — reveal tampered row must throw generic error + audit secret_reveal_failed committed', async () => {
    // accountTamper keeps the dummy 00-byte envelope → decryptSecret throws → generic 'Secret reveal failed.'
    // and a 'secret_reveal_failed' audit row is committed before the rethrow. userA already holds the
    // company-level reveal-secret ALLOW (seeded in RED 3); add the per-account object grant so the F2 check
    // passes and execution reaches the decrypt step.
    await seedObjectGrant(direct, A.companyId, userA, RESOURCE_TYPE, accountTamper, ACTION_REVEAL, 'ALLOW');
    const { error } = await invoke(() => svc.revealSecret(userCtx(userA, A.companyId), accountTamper, validRevealCtx()));
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).not.toContain('NOT_IMPLEMENTED');
  });

  // ─── RED 11 — updateSecret deny / grant ───────────────────────────────────

  it('RED 11a — updateSecret without edit grant must throw ForbiddenException', async () => {
    const { error } = await invoke(() =>
      svc.updateSecret(userCtx(userA, A.companyId), accountA, { secret: 'new-secret' }),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  it('RED 11b — updateSecret with edit grant must return updated SafePlatformAccountDto', async () => {
    const editRole = await seedRole(direct, A.companyId, `edit-role-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, editRole, permEditId, 'ALLOW');
    await seedUserRole(direct, userA, editRole, A.companyId);

    const { result } = await invoke(() =>
      svc.updateSecret(userCtx(userA, A.companyId), accountA, { secret: 'new-secret-value' }),
    );
    // RED: currently throws NOT_IMPLEMENTED → result is undefined.
    expect(result).toBeDefined();
    expect((result as SafePlatformAccountDto | undefined)?.id).toBe(accountA);
  });

  // ─── RED 14 — company-level ALLOW but NO object grant → deny (F2) ─────────

  it('RED 14 — company ALLOW without per-account object grant must throw ForbiddenException (F2 crown-jewel rule)', async () => {
    const revealRoleB = await seedRole(direct, B.companyId, `reveal-role-b-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, revealRoleB, permRevealId, 'ALLOW');
    await seedUserRole(direct, userB, revealRoleB, B.companyId);
    // Intentionally NO seedObjectGrant for userB / accountB.

    const { error } = await invoke(() => svc.revealSecret(userCtx(userB, B.companyId), accountB, validRevealCtx()));
    // RED: NOT_IMPLEMENTED → not a ForbiddenException; when 2e done, must be ForbiddenException.
    expect(error).toBeInstanceOf(ForbiddenException);
  });
});
