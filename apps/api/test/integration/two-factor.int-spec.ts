/**
 * G16-1 — TwoFactorService integration suite (real Postgres, mediaos_app role, RLS enforced).
 * Skip khi không có DATABASE_URL. Deny-path TRƯỚC: verify-before-enable, wrong-token, re-enroll-conflict,
 * recovery one-time, tenant isolation. Secret TOTP PHẢI envelope-encrypted (không plaintext trong DB).
 */
import { randomUUID } from "node:crypto";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TwoFactorService } from "../../src/auth/two-factor.service";
import { TotpService } from "../../src/auth/totp.service";
import { TokenService } from "../../src/auth/token.service";
import { DatabaseService } from "../../src/db/db.service";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";
import { AuditService } from "../../src/events/audit.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, seedUserRole, type SeededTenant } from "../helpers/seed";

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
    svc = new TwoFactorService(db, secrets, totp, new TokenService(), new AuditService());

    A = await seedCompany(direct, "g16a");
    B = await seedCompany(direct, "g16b");
    userA = await seedUser(direct, A.companyId, `g16a-${randomUUID().slice(0, 8)}@test.local`);
    adminUserA = await seedUser(direct, A.companyId, `g16admin-${randomUUID().slice(0, 8)}@test.local`);
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
    expect(await svc.verifyChallenge(userA, A.companyId, totp.generate(secretFromUri((await reEnroll()).otpauthUri)))).toBe(false);
  });

  it("DENY: confirmEnable mã SAI → UnauthorizedException, enabled_at vẫn null", async () => {
    await reEnroll();
    await expect(svc.confirmEnable(userA, A.companyId, "000000")).rejects.toBeInstanceOf(UnauthorizedException);
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
    const recRows = await direct.query("SELECT 1 FROM user_recovery_codes WHERE user_id = $1", [userA]);
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

  /** Helper: disable (nếu có) + enroll lại, trả enroll result. Dùng cho các case cần trạng thái pending sạch. */
  async function reEnroll() {
    await svc.disable(userA, A.companyId);
    return svc.enroll(userA, A.companyId);
  }
});
