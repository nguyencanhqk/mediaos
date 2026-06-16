/**
 * G6-2 PR-B ROUND 2 — RED integration suite: PlatformAccountsService.revealSecretViaBreakGlass.
 *
 * Runs against REAL Postgres (mediaos_app role, RLS enforced). Auto-skips when DATABASE_URL is unset.
 *
 * The reveal gate is KÉP (double) + fail-closed (BẤT BIẾN #1):
 *   (a) caller holds the sensitive company-tier permission `reveal-break-glass` (exact non-wildcard; *:*
 *       does NOT satisfy; no object grant / re-auth needed), AND
 *   (b) an `active`, non-expired break-glass grant exists for THIS caller (requester) on THIS account,
 *       expiry enforced by the DB clock (expires_at > now()) inside the tenant tx (BẤT BIẾN #4).
 *
 * RED deny-path matrix (each must DENY — relaxing the gate would turn one green-trivially):
 *   no permission (gate a)                              → 403
 *   wildcard *:* only (gate a, sensitive)               → 403
 *   permission but NO active grant (gate b)             → 403
 *   permission but grant of ANOTHER requester (gate b)  → 403
 *   permission but grant EXPIRED (gate b, DB clock)     → 403
 *   permission but grant REVOKED (gate b)               → 403
 *   permission but grant PENDING (gate b)               → 403
 *   cross-tenant (account invisible under RLS)          → 404 (no cross-tenant existence leak — BẤT BIẾN #3)
 *
 * GREEN path: permission + own active grant on a real envelope → { secret, grantId }, with a
 *   'break_glass_access.secret_revealed' audit row committed (object_id = grantId) that contains NO plaintext
 *   secret (BẤT BIẾN #2). Tamper (corrupt envelope) → generic throw + 'secret_reveal_failed' audit committed.
 */

import { randomUUID } from "node:crypto";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlatformAccountsService } from "../../src/media/platform-accounts.service";
import type { RequestUser, RevealCtx } from "../../src/media/platform-accounts.service";
import { PlatformAccountsRepository } from "../../src/media/platform-accounts.repository";
import { DatabaseService } from "../../src/db/db.service";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { ValkeyService } from "../../src/permission/valkey.service";
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { PasswordService } from "../../src/auth/password.service";
import { AuditService } from "../../src/events/audit.service";
import { BreakGlassRepository } from "../../src/break-glass/break-glass.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedBreakGlassGrant,
  seedCompany,
  seedPermissionCatalog,
  seedPlatformAccount,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const ACTION_REVEAL_BG = "reveal-break-glass";
const RESOURCE_BG = "break-glass";
/** Plaintext sealed into accountA's real envelope so the success case round-trips. */
const REVEAL_SECRET_A = "break-glass-secret-A-value";

describe.skipIf(!hasDb)("G6-2 PR-B ROUND 2 break-glass reveal — RED deny-path + success suite", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let revealer: string; // A: has reveal-break-glass + owns active grant on accountA / accountTamper
  let otherRequester: string; // A: owns an active grant; revealer must NOT reveal via it
  let noPermUser: string; // A: owns an active grant but has NO reveal-break-glass permission
  let wildcardUser: string; // A: only *:* ALLOW + owns active grant → sensitive gate denies
  let revealerB: string; // B: has reveal-break-glass in company B (cross-tenant probe)
  let accountA: string; // A: REAL envelope
  let accountTamper: string; // A: dummy 00-byte envelope (decrypt fails)
  let accountB: string; // B
  let svc: PlatformAccountsService;

  beforeAll(async () => {
    const db = new DatabaseService();
    const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
    const permissions = new PermissionService(new PermissionRepository(db));
    svc = new PlatformAccountsService(
      db,
      new PlatformAccountsRepository(db),
      secrets,
      permissions,
      new AuditService(),
      new ValkeyService(),
      new PasswordService(),
      new LoginRateLimiter(),
      new BreakGlassRepository(db),
    );

    A = await seedCompany(direct, "bgr-a");
    B = await seedCompany(direct, "bgr-b");
    revealer = await seedUser(direct, A.companyId, `bgr-rev-${randomUUID().slice(0, 8)}@x.test`);
    otherRequester = await seedUser(direct, A.companyId, `bgr-oth-${randomUUID().slice(0, 8)}@x.test`);
    noPermUser = await seedUser(direct, A.companyId, `bgr-np-${randomUUID().slice(0, 8)}@x.test`);
    wildcardUser = await seedUser(direct, A.companyId, `bgr-wc-${randomUUID().slice(0, 8)}@x.test`);
    revealerB = await seedUser(direct, B.companyId, `bgr-b-${randomUUID().slice(0, 8)}@x.test`);
    accountB = await seedPlatformAccount(direct, B.companyId);
    accountTamper = await seedPlatformAccount(direct, A.companyId);

    // accountA carries a REAL envelope so the success case round-trips.
    accountA = await seedPlatformAccount(direct, A.companyId);
    const env = await secrets.encryptSecret(REVEAL_SECRET_A, {
      companyId: A.companyId,
      recordId: accountA,
      purpose: "platform_account",
    });
    await direct.query(
      `UPDATE platform_accounts
         SET secret_ciphertext=$2, encrypted_dek=$3, dek_key_version=$4, kms_key_id=$5,
             iv_nonce=$6, auth_tag=$7, enc_algo=$8
       WHERE id=$1`,
      [accountA, env.secretCiphertext, env.encryptedDek, env.dekKeyVersion, env.kmsKeyId, env.ivNonce, env.authTag, env.encAlgo],
    );

    // Permission catalog (mig 0201 already seeds reveal-break-glass; upsert returns its id).
    const permRevealBg = await seedPermissionCatalog(direct, ACTION_REVEAL_BG, RESOURCE_BG, true);

    // revealer + revealerB + otherRequester hold reveal-break-glass; noPermUser does NOT.
    const revRole = await seedRole(direct, A.companyId, `bgr-rev-role-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, revRole, permRevealBg, "ALLOW");
    await seedUserRole(direct, revealer, revRole, A.companyId);
    await seedUserRole(direct, otherRequester, revRole, A.companyId);

    const revRoleB = await seedRole(direct, B.companyId, `bgr-rev-role-b-${randomUUID().slice(0, 8)}`);
    const permRevealBgB = await seedPermissionCatalog(direct, ACTION_REVEAL_BG, RESOURCE_BG, true);
    await seedRolePermission(direct, revRoleB, permRevealBgB, "ALLOW");
    await seedUserRole(direct, revealerB, revRoleB, B.companyId);

    // wildcardUser: only *:* ALLOW (must fail the sensitive gate).
    const wcRole = await seedRole(direct, A.companyId, `bgr-wc-role-${randomUUID().slice(0, 8)}`);
    const wcPerm = await seedPermissionCatalog(direct, "*", "*", false);
    await seedRolePermission(direct, wcRole, wcPerm, "ALLOW");
    await seedUserRole(direct, wildcardUser, wcRole, A.companyId);
    // noPermUser: intentionally NO role/permission.
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function userCtx(userId: string, companyId: string): RequestUser {
    return { id: userId, companyId };
  }

  function ctx(): RevealCtx {
    return { ip: "127.0.0.1", userAgent: "vitest" };
  }

  async function invoke<T>(fn: () => T | Promise<T>): Promise<{ result?: T; error?: Error }> {
    try {
      return { result: await fn() };
    } catch (e) {
      return { error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  /** Seed an ACTIVE (approved) grant — status='active' requires activated_at (active_pair CHECK). */
  async function activeGrant(requesterUserId: string, platformAccountId: string): Promise<string> {
    return seedBreakGlassGrant(direct, {
      companyId: A.companyId,
      platformAccountId,
      requesterUserId,
      status: "active",
      activatedAt: new Date().toISOString(),
    });
  }

  async function auditRowsForGrant(grantId: string, action: string): Promise<Record<string, unknown>[]> {
    const r = await direct.query(
      `SELECT * FROM audit_logs WHERE object_type='break_glass_access' AND object_id=$1 AND action=$2`,
      [grantId, action],
    );
    return r.rows as Record<string, unknown>[];
  }

  // ─── Gate (a): permission ───────────────────────────────────────────────────────

  it("RED 1 — no reveal-break-glass permission (even with an active grant) → ForbiddenException", async () => {
    await activeGrant(noPermUser, accountA);
    const { error } = await invoke(() =>
      svc.revealSecretViaBreakGlass(userCtx(noPermUser, A.companyId), accountA, ctx()),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  it("RED 2 — only wildcard *:* ALLOW (sensitive gate) → ForbiddenException", async () => {
    await activeGrant(wildcardUser, accountA);
    const { error } = await invoke(() =>
      svc.revealSecretViaBreakGlass(userCtx(wildcardUser, A.companyId), accountA, ctx()),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  // ─── Gate (b): active grant for THIS caller on THIS account ──────────────────────

  it("RED 3 — permission but NO break-glass grant at all → ForbiddenException (fail-closed)", async () => {
    // revealer has permission but no grant on accountTamper yet.
    const { error } = await invoke(() =>
      svc.revealSecretViaBreakGlass(userCtx(revealer, A.companyId), accountTamper, ctx()),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  it("RED 4 — permission but the active grant belongs to ANOTHER requester → ForbiddenException", async () => {
    // Active grant owned by otherRequester (not revealer) on a fresh account.
    const acct = await seedPlatformAccount(direct, A.companyId);
    await activeGrant(otherRequester, acct);
    const { error } = await invoke(() =>
      svc.revealSecretViaBreakGlass(userCtx(revealer, A.companyId), acct, ctx()),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  it("RED 5 — permission but the grant is EXPIRED (DB clock) → ForbiddenException", async () => {
    const acct = await seedPlatformAccount(direct, A.companyId);
    // status active but expires_at in the past, created_at further past (ttl CHECK expires_at > created_at).
    await seedBreakGlassGrant(direct, {
      companyId: A.companyId,
      platformAccountId: acct,
      requesterUserId: revealer,
      status: "active",
      activatedAt: new Date(Date.now() - 7200_000).toISOString(),
      createdAt: new Date(Date.now() - 7200_000).toISOString(),
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    const { error } = await invoke(() =>
      svc.revealSecretViaBreakGlass(userCtx(revealer, A.companyId), acct, ctx()),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  it("RED 6 — permission but the grant is REVOKED → ForbiddenException", async () => {
    const acct = await seedPlatformAccount(direct, A.companyId);
    // Seed ACTIVE then revoke via UPDATE: status='revoked' requires revoked_at + revoked_by (revoked_pair CHECK),
    // and the FSM trigger permits active→revoked. Direct UPDATE bypasses the column-grant (test pool is owner).
    const grantId = await activeGrant(revealer, acct);
    await direct.query(
      `UPDATE break_glass_grants SET status='revoked', revoked_at=now(), revoked_by=$2 WHERE id=$1`,
      [grantId, revealer],
    );
    const { error } = await invoke(() =>
      svc.revealSecretViaBreakGlass(userCtx(revealer, A.companyId), acct, ctx()),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  it("RED 7 — permission but the grant is still PENDING (not approved) → ForbiddenException", async () => {
    const acct = await seedPlatformAccount(direct, A.companyId);
    await seedBreakGlassGrant(direct, {
      companyId: A.companyId,
      platformAccountId: acct,
      requesterUserId: revealer,
      status: "pending",
    });
    const { error } = await invoke(() =>
      svc.revealSecretViaBreakGlass(userCtx(revealer, A.companyId), acct, ctx()),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  // ─── Cross-tenant (RLS hides the account) ────────────────────────────────────────

  it("RED 8 — cross-tenant: revealerB (company B) reveal accountA (company A) → NotFoundException (RLS)", async () => {
    const { error } = await invoke(() =>
      svc.revealSecretViaBreakGlass(userCtx(revealerB, B.companyId), accountA, ctx()),
    );
    // Account invisible under RLS → 404, not a cross-tenant existence leak.
    expect(error).toBeInstanceOf(NotFoundException);
  });

  // ─── Success + tamper ─────────────────────────────────────────────────────────────

  it("RED 9 — permission + own ACTIVE grant on a real envelope → returns { secret, grantId } + audit (no secret in row)", async () => {
    const grantId = await activeGrant(revealer, accountA);
    const { result, error } = await invoke(() =>
      svc.revealSecretViaBreakGlass(userCtx(revealer, A.companyId), accountA, ctx()),
    );
    expect(error).toBeUndefined();
    expect(result?.secret).toBe(REVEAL_SECRET_A);
    expect(result?.grantId).toBe(grantId);

    // Audit committed against the grant, action secret_revealed, and the plaintext is NOWHERE in the row.
    const rows = await auditRowsForGrant(grantId, "break_glass_access.secret_revealed");
    expect(rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(REVEAL_SECRET_A);
  });

  it("RED 10 — permission + active grant but TAMPERED envelope → generic throw + secret_reveal_failed audit committed", async () => {
    const grantId = await activeGrant(revealer, accountTamper);
    const { error } = await invoke(() =>
      svc.revealSecretViaBreakGlass(userCtx(revealer, A.companyId), accountTamper, ctx()),
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe("Secret reveal failed.");
    const rows = await auditRowsForGrant(grantId, "break_glass_access.secret_reveal_failed");
    expect(rows.length).toBeGreaterThan(0);
  });
});
