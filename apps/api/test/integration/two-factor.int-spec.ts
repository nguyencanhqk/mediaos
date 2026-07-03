/**
 * G16-1 — TwoFactorService integration suite (real Postgres, mediaos_app role, RLS enforced).
 * Skip khi không có DATABASE_URL. Deny-path TRƯỚC: verify-before-enable, wrong-token, re-enroll-conflict,
 * recovery one-time, tenant isolation. Secret TOTP PHẢI envelope-encrypted (không plaintext trong DB).
 */
import { randomUUID } from "node:crypto";
import { ConflictException, HttpException, UnauthorizedException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TwoFactorService, TWO_FACTOR_ENFORCED } from "../../src/auth/two-factor.service";
import { TotpService } from "../../src/auth/totp.service";
import { TokenService } from "../../src/auth/token.service";
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { ReplayGuardService } from "../../src/auth/replay-guard.service";
import { ValkeyService } from "../../src/permission/valkey.service";
import { DatabaseService } from "../../src/db/db.service";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";
import { AuditService } from "../../src/events/audit.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001"; // system role, requires_two_factor=true (mig 0120)

/** Lấy base32 secret từ otpauth:// URI để sinh mã TOTP hợp lệ trong test. */
function secretFromUri(uri: string): string {
  return new URL(uri).searchParams.get("secret") ?? "";
}

describe.skipIf(!hasDb)("G16-1 TwoFactorService — 2FA TOTP", () => {
  const direct = directPool();
  const totp = new TotpService();
  let svc: TwoFactorService;
  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let adminUserA: string;
  let userB: string;

  beforeAll(async () => {
    const db = new DatabaseService();
    const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
    svc = new TwoFactorService(
      db,
      secrets,
      totp,
      new TokenService(),
      new AuditService(),
      new LoginRateLimiter(),
      new ReplayGuardService(new ValkeyService()),
    );

    A = await seedCompany(direct, "g16a");
    B = await seedCompany(direct, "g16b");
    userA = await seedUser(direct, A.companyId, `g16a-${randomUUID().slice(0, 8)}@test.local`);
    adminUserA = await seedUser(
      direct,
      A.companyId,
      `g16admin-${randomUUID().slice(0, 8)}@test.local`,
    );
    userB = await seedUser(direct, B.companyId, `g16b-${randomUUID().slice(0, 8)}@test.local`);
    await seedUserRole(direct, adminUserA, COMPANY_ADMIN_ROLE_ID, A.companyId);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
  });

  it("enroll → otpauthUri + 10 recovery codes; secret KHÔNG plaintext trong DB", async () => {
    const res = await svc.enroll(userA, A.companyId);
    expect(res.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(res.recoveryCodes).toHaveLength(10);
    expect(new Set(res.recoveryCodes).size).toBe(10); // không trùng

    const secret = secretFromUri(res.otpauthUri);
    // secret_ciphertext trong DB KHÁC base32 secret (đã envelope-encrypt, BẤT BIẾN #3)
    const row = await direct.query(
      "SELECT secret_ciphertext, enabled_at FROM user_totp WHERE user_id = $1",
      [userA],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].enabled_at).toBeNull(); // chưa bật
    expect(row.rows[0].secret_ciphertext.toString("utf8")).not.toContain(secret);
  });

  it("DENY: verifyChallenge khi CHƯA enable (enabled_at null) → false", async () => {
    expect(
      await svc.verifyChallenge(
        userA,
        A.companyId,
        totp.generate(secretFromUri((await reEnroll()).otpauthUri)),
      ),
    ).toBe(false);
  });

  it("DENY: confirmEnable mã SAI → UnauthorizedException, enabled_at vẫn null", async () => {
    await reEnroll();
    await expect(svc.confirmEnable(userA, A.companyId, "000000")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const row = await direct.query("SELECT enabled_at FROM user_totp WHERE user_id = $1", [userA]);
    expect(row.rows[0].enabled_at).toBeNull();
  });

  it("confirmEnable mã ĐÚNG → bật; isEnabled true; verifyChallenge TOTP đúng → true, sai → false", async () => {
    const { otpauthUri } = await reEnroll();
    const secret = secretFromUri(otpauthUri);
    await svc.confirmEnable(userA, A.companyId, totp.generate(secret));
    expect(await svc.isEnabled(userA, A.companyId)).toBe(true);
    expect(await svc.verifyChallenge(userA, A.companyId, totp.generate(secret))).toBe(true);
    expect(await svc.verifyChallenge(userA, A.companyId, "111111")).toBe(false);
  });

  it("DENY: enroll lại khi ĐÃ bật → ConflictException", async () => {
    await expect(svc.enroll(userA, A.companyId)).rejects.toBeInstanceOf(ConflictException);
  });

  it("recovery code dùng được 1 LẦN: lần 2 cùng mã → false", async () => {
    // disable + re-enroll + enable để lấy bộ recovery codes mới đã biết plaintext
    await svc.disable(userA, A.companyId);
    const { otpauthUri, recoveryCodes } = await svc.enroll(userA, A.companyId);
    await svc.confirmEnable(userA, A.companyId, totp.generate(secretFromUri(otpauthUri)));
    expect(await svc.verifyChallenge(userA, A.companyId, recoveryCodes[0])).toBe(true);
    expect(await svc.verifyChallenge(userA, A.companyId, recoveryCodes[0])).toBe(false); // đã dùng
    expect(await svc.verifyChallenge(userA, A.companyId, recoveryCodes[1])).toBe(true); // mã khác vẫn được
  });

  it("disable → xoá secret + recovery codes; isEnabled false", async () => {
    await svc.disable(userA, A.companyId);
    expect(await svc.isEnabled(userA, A.companyId)).toBe(false);
    const totpRows = await direct.query("SELECT 1 FROM user_totp WHERE user_id = $1", [userA]);
    const recRows = await direct.query("SELECT 1 FROM user_recovery_codes WHERE user_id = $1", [
      userA,
    ]);
    expect(totpRows.rows).toHaveLength(0);
    expect(recRows.rows).toHaveLength(0);
  });

  it("requiresTwoFactor: user có role company-admin → true; user thường → false", async () => {
    expect(await svc.requiresTwoFactor(adminUserA, A.companyId)).toBe(true);
    expect(await svc.requiresTwoFactor(userA, A.companyId)).toBe(false);
  });

  it("tenant isolation: 2FA của tenant A KHÔNG thấy được từ ngữ cảnh tenant B (RLS)", async () => {
    const { otpauthUri } = await svc.enroll(userA, A.companyId);
    await svc.confirmEnable(userA, A.companyId, totp.generate(secretFromUri(otpauthUri)));
    expect(await svc.isEnabled(userA, A.companyId)).toBe(true);
    // Cùng userId nhưng ngữ cảnh tenant B → RLS lọc → 0 row → false (không rò trạng thái chéo tenant).
    expect(await svc.isEnabled(userA, B.companyId)).toBe(false);
  });

  it("rate-limit confirmEnable: nhiều mã sai → khoá (429) chống brute-force TOTP", async () => {
    // svc dùng chung 1 LoginRateLimiter; dùng userB (chưa đụng) để key sạch.
    await svc.enroll(userB, B.companyId);
    for (let i = 0; i < 5; i++) {
      await expect(svc.confirmEnable(userB, B.companyId, "000000")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    await expect(svc.confirmEnable(userB, B.companyId, "000000")).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  /** Helper: disable (nếu có) + enroll lại, trả enroll result. Dùng cho các case cần trạng thái pending sạch. */
  async function reEnroll() {
    await svc.disable(userA, A.companyId);
    return svc.enroll(userA, A.companyId);
  }
});

/**
 * S2-AUTH-BE-11 (l2-2fa-enforce-disable, CROWN auth) — enforcement 2FA:
 *   - requiresTwoFactorTx = roles.requires_two_factor (mig 0120) OR users.require_two_factor (mig 0466).
 *   - POST /auth/2fa/disable (svc.disable) khi bị ép ⇒ 409 TWO_FACTOR_ENFORCED, fail-closed TRƯỚC
 *     delete/audit/security-event.
 * Real Postgres (mediaos_app, RLS ENFORCED). Deny-path TRƯỚC (RED) — chứng minh trên DB thật, KHÔNG mock.
 */
describe.skipIf(!hasDb)(
  "S2-AUTH-BE-11 — 2FA enforcement: disable fail-closed + per-user source",
  () => {
    const direct = directPool();
    const totp = new TotpService();
    let svc: TwoFactorService;
    let C: SeededTenant;
    let D: SeededTenant;
    let uPerUser: string; // ép PER-USER (users.require_two_factor=true), role KHÔNG cờ
    let uRole: string; // ép QUA ROLE (company-admin requires_two_factor=true)
    let uPlain: string; // KHÔNG bị ép

    /** Đếm audit_logs của user theo action (append-only) — chứng minh CÓ / KHÔNG ghi audit. */
    async function countAudit(userId: string, action: string): Promise<number> {
      const r = await direct.query(
        "SELECT COUNT(*)::int AS n FROM audit_logs WHERE actor_user_id = $1 AND action = $2",
        [userId, action],
      );
      return r.rows[0].n as number;
    }

    /** Đếm user_security_events của user theo event_type — chứng minh CÓ / KHÔNG ghi TOTP_DISABLED. */
    async function countSecEvent(userId: string, eventType: string): Promise<number> {
      const r = await direct.query(
        "SELECT COUNT(*)::int AS n FROM user_security_events WHERE user_id = $1 AND event_type = $2",
        [userId, eventType],
      );
      return r.rows[0].n as number;
    }

    async function enrollAndEnable(userId: string, companyId: string): Promise<void> {
      const { otpauthUri } = await svc.enroll(userId, companyId);
      await svc.confirmEnable(userId, companyId, totp.generate(secretFromUri(otpauthUri)));
    }

    beforeAll(async () => {
      const db = new DatabaseService();
      const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
      svc = new TwoFactorService(
        db,
        secrets,
        totp,
        new TokenService(),
        new AuditService(),
        new LoginRateLimiter(),
        new ReplayGuardService(new ValkeyService()),
      );

      C = await seedCompany(direct, "be11c");
      D = await seedCompany(direct, "be11d");
      uPerUser = await seedUser(
        direct,
        C.companyId,
        `be11p-${randomUUID().slice(0, 8)}@test.local`,
      );
      uRole = await seedUser(direct, C.companyId, `be11r-${randomUUID().slice(0, 8)}@test.local`);
      uPlain = await seedUser(direct, C.companyId, `be11n-${randomUUID().slice(0, 8)}@test.local`);
      // Nguồn PER-USER: bật cờ users.require_two_factor (mig 0466) — role KHÔNG cờ.
      await direct.query("UPDATE users SET require_two_factor = true WHERE id = $1", [uPerUser]);
      // Nguồn ROLE: gắn company-admin (system role, requires_two_factor=true mig 0120) — cờ per-user để mặc định false.
      await seedUserRole(direct, uRole, COMPANY_ADMIN_ROLE_ID, C.companyId);
    });

    afterAll(async () => {
      await cleanupTenants(direct, [C.companyId, D.companyId]);
      await direct.end();
    });

    // (d) status.required ĐÚNG cho CẢ 3 nguồn — độc lập trạng thái enabled (chỉ đọc cờ). Đặt TRƯỚC các test disable.
    it("(d) status.required: role=true, per-user=true, không-nguồn=false", async () => {
      expect((await svc.status(uRole, C.companyId)).required).toBe(true);
      expect((await svc.status(uPerUser, C.companyId)).required).toBe(true);
      expect((await svc.status(uPlain, C.companyId)).required).toBe(false);
    });

    // (a) ép PER-USER → disable 409 fail-closed; vẫn enabled; KHÔNG audit/TOTP_DISABLED.
    it("(a) ép PER-USER (users.require_two_factor) → disable 409 TWO_FACTOR_ENFORCED, vẫn enabled, KHÔNG audit/security-event", async () => {
      await enrollAndEnable(uPerUser, C.companyId);
      expect(await svc.isEnabled(uPerUser, C.companyId)).toBe(true);

      const err = await svc.disable(uPerUser, C.companyId).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getStatus()).toBe(409);
      expect((err as ConflictException).getResponse()).toMatchObject({ code: TWO_FACTOR_ENFORCED });

      // fail-closed: secret KHÔNG bị xoá (vẫn enabled) + KHÔNG audit 2fa_disabled + KHÔNG TOTP_DISABLED.
      expect(await svc.isEnabled(uPerUser, C.companyId)).toBe(true);
      expect(await countAudit(uPerUser, "auth.2fa_disabled")).toBe(0);
      expect(await countSecEvent(uPerUser, "TOTP_DISABLED")).toBe(0);
    });

    // (b) ép QUA ROLE → disable 409, vẫn enabled.
    it("(b) ép QUA ROLE (roles.requires_two_factor) → disable 409 TWO_FACTOR_ENFORCED, vẫn enabled", async () => {
      await enrollAndEnable(uRole, C.companyId);
      const err = await svc.disable(uRole, C.companyId).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({ code: TWO_FACTOR_ENFORCED });
      expect(await svc.isEnabled(uRole, C.companyId)).toBe(true);
      expect(await countAudit(uRole, "auth.2fa_disabled")).toBe(0);
      expect(await countSecEvent(uRole, "TOTP_DISABLED")).toBe(0);
    });

    // (c) KHÔNG bị ép → disable OK (regression wiring BE-8): xoá secret+recovery + audit + TOTP_DISABLED.
    it("(c) KHÔNG bị ép → disable OK: xoá secret+recovery, audit auth.2fa_disabled + TOTP_DISABLED", async () => {
      await enrollAndEnable(uPlain, C.companyId);
      await svc.disable(uPlain, C.companyId);
      expect(await svc.isEnabled(uPlain, C.companyId)).toBe(false);
      const totpRows = await direct.query("SELECT 1 FROM user_totp WHERE user_id = $1", [uPlain]);
      const recRows = await direct.query("SELECT 1 FROM user_recovery_codes WHERE user_id = $1", [
        uPlain,
      ]);
      expect(totpRows.rows).toHaveLength(0);
      expect(recRows.rows).toHaveLength(0);
      expect(await countAudit(uPlain, "auth.2fa_disabled")).toBe(1);
      expect(await countSecEvent(uPlain, "TOTP_DISABLED")).toBe(1);
    });

    // (f) 2-tenant deny: ngữ cảnh tenant D KHÔNG đọc/ghi được cờ 2FA của user tenant C (RLS); disable chéo = no-op.
    it("(f) cross-tenant: tenant D KHÔNG thấy require/enabled của user C; disable chéo KHÔNG gỡ 2FA của C", async () => {
      // uPerUser (tenant C) đang enabled (từ case a). Từ ngữ cảnh tenant D:
      expect(await svc.requiresTwoFactor(uPerUser, D.companyId)).toBe(false); // cờ per-user KHÔNG rò chéo tenant
      expect(await svc.isEnabled(uPerUser, D.companyId)).toBe(false); // RLS lọc → không lộ trạng thái

      // disable chéo tenant: trong D, requiresTwoFactorTx=false (RLS) → không 409, nhưng delete lọc 0 hàng → no-op.
      await svc.disable(uPerUser, D.companyId);
      // 2FA của uPerUser trong tenant C KHÔNG bị đụng (không xoá xuyên tenant).
      expect(await svc.isEnabled(uPerUser, C.companyId)).toBe(true);
      expect(await countSecEvent(uPerUser, "TOTP_DISABLED")).toBe(0);
    });
  },
);
