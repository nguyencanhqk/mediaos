import { UnauthorizedException } from "@nestjs/common";
import type { AuthTokens, LoginResponse } from "@mediaos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuthService } from "../../src/auth/auth.service";
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { PasswordService } from "../../src/auth/password.service";
import { TokenService } from "../../src/auth/token.service";
import { TotpService } from "../../src/auth/totp.service";
import { TwoFactorService } from "../../src/auth/two-factor.service";
import { ReplayGuardService } from "../../src/auth/replay-guard.service";
import { SecurityAlertService } from "../../src/auth/security-alert.service";
import { ValkeyService } from "../../src/permission/valkey.service";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { PermissionService } from "../../src/permission/permission.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import { makeSecurityPolicyService } from "../helpers/security-policy";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

/**
 * S2-AUTH-BE-4 — deny-path UNIFORM cho forgot/reset/change-password (Postgres thật, DB cô lập theo lane).
 *
 * Gate: hasDb (DATABASE_*) + LANE_DB (DB cô lập) — thiếu LANE_DB → SKIP để KHÔNG chạm DB dev chung 'mediaos'
 * (memory: integration-test-lane-db-gate, CLAUDE.md §9.5).
 *
 * Khẳng định:
 *  - invalid / expired / already-used reset token → CÙNG UnauthorizedException + CÙNG message (no-enumeration,
 *    không phân biệt expired-vs-used).
 *  - forgot-password cho email lạ + companySlug lạ → CÙNG void; KHÔNG tạo password_reset_tokens row, KHÔNG outbox.
 *  - reset thành công → used_at set, đổi hash, thu hồi MỌI refresh token còn sống (phiên cũ refresh → 401).
 *  - reset token chỉ lưu HASH (cột token_hash KHÔNG chứa plaintext token).
 *  - change-password: thiếu currentPassword bị Zod chặn (contract); sai currentPassword → 401 + KHÔNG đổi pass.
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)("S2-AUTH-BE-4 reset/forgot/change deny-path uniform", () => {
  const direct = directPool();
  const password = new PasswordService();
  const meta = { ip: "127.0.0.1", userAgent: "vitest" };

  const EMAIL = "reset-user@a.test";
  const PASSWORD = "Passw0rd!strong";
  const UNIFORM = "Token không hợp lệ hoặc đã hết hạn.";

  let A: SeededTenant;
  let userId: string;
  let auth: AuthService;

  beforeAll(async () => {
    A = await seedCompany(direct, "reset");
    const hash = await password.hash(PASSWORD);
    userId = await seedUser(direct, A.companyId, EMAIL, hash);
    auth = newAuth();
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  function newAuth(): AuthService {
    const dbsvc = new DatabaseService();
    const mockPermissions = {
      getCapabilities: async () => ({}),
      getCapabilityScopes: async () => ({}),
    } as unknown as PermissionService;
    const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
    const replayGuard = new ReplayGuardService(new ValkeyService());
    const securityAlerts = new SecurityAlertService(dbsvc, new AuditService());
    const twoFactor = new TwoFactorService(
      dbsvc,
      secrets,
      new TotpService(),
      new TokenService(),
      new AuditService(),
      new LoginRateLimiter(),
      replayGuard,
    );
    return new AuthService(
      dbsvc,
      password,
      new TokenService(),
      new LoginRateLimiter(),
      new AuditService(),
      new OutboxService(),
      mockPermissions,
      secrets,
      twoFactor,
      replayGuard,
      securityAlerts,
      makeSecurityPolicyService(dbsvc),
      { getMyApps: async () => [] } as never,
    );
  }

  function expectTokens(r: LoginResponse): AuthTokens {
    if ("twoFactorRequired" in r) throw new Error("không mong đợi 2FA challenge");
    return r;
  }

  /** Lấy plaintext reset token cho EMAIL từ outbox (mail consumer JIT decrypt). */
  async function requestResetToken(): Promise<string> {
    const fresh = newAuth();
    await fresh.forgotPassword({ companySlug: A.slug, email: EMAIL }, meta);
    const ev = await direct.query(
      `SELECT payload FROM outbox_events
       WHERE company_id = $1 AND event_type = 'auth.password_reset_requested'
       ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    const payload = ev.rows[0].payload as { userId: string; resetTokenEnc: unknown };
    return fresh.decryptResetToken(A.companyId, payload.resetTokenEnc, payload.userId);
  }

  // ── uniform reset error (no enumeration / no expired-vs-used signal) ──────────────
  it("invalid token → 401 ĐỒNG NHẤT", async () => {
    await expect(
      auth.resetPassword({
        token: `${A.companyId}.not-a-real-token`,
        newPassword: "WhatEver!2026",
      }),
    ).rejects.toMatchObject({ message: UNIFORM });
  });

  it("token sai định dạng (không scoped) → 401 CÙNG message (không lộ lý do)", async () => {
    await expect(
      auth.resetPassword({ token: "garbage-no-dot", newPassword: "WhatEver!2026" }),
    ).rejects.toMatchObject({ message: UNIFORM });
  });

  it("expired token VÀ used token → CÙNG UnauthorizedException + CÙNG message (no expired-vs-used signal)", async () => {
    // expired: seed một row với expires_at quá khứ; companyId tiền tố để splitScopedToken mở withTenant.
    const tok = new TokenService();
    const plainExpired = `${A.companyId}.${tok.generateOpaqueToken()}`;
    await direct.query(
      `INSERT INTO password_reset_tokens (company_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() - interval '1 hour')`,
      [A.companyId, userId, tok.hashToken(plainExpired)],
    );
    let expiredErr: unknown;
    await auth.resetPassword({ token: plainExpired, newPassword: "WhatEver!2026" }).catch((e) => {
      expiredErr = e;
    });

    // used: tạo token thật rồi tiêu thụ 1 lần, sau đó dùng lại.
    const usedToken = await requestResetToken();
    await auth.resetPassword({ token: usedToken, newPassword: "FirstUse!2026" });
    let usedErr: unknown;
    await auth.resetPassword({ token: usedToken, newPassword: "SecondUse!2026" }).catch((e) => {
      usedErr = e;
    });

    expect(expiredErr).toBeInstanceOf(UnauthorizedException);
    expect(usedErr).toBeInstanceOf(UnauthorizedException);
    expect((expiredErr as Error).message).toBe(UNIFORM);
    expect((usedErr as Error).message).toBe(UNIFORM);
    expect((expiredErr as Error).message).toBe((usedErr as Error).message);

    // khôi phục mật khẩu gốc cho các test sau.
    await direct.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      await password.hash(PASSWORD),
      userId,
    ]);
  });

  // ── forgot-password: no enumeration (email lạ / slug lạ → cùng void, không tạo dữ liệu) ────
  it("forgot-password email lạ + slug lạ → CÙNG void; KHÔNG tạo reset row / KHÔNG outbox cho ghost", async () => {
    const before = await direct.query(
      `SELECT count(*)::int AS n FROM password_reset_tokens WHERE company_id = $1`,
      [A.companyId],
    );
    const outboxBefore = await direct.query(
      `SELECT count(*)::int AS n FROM outbox_events
       WHERE company_id = $1 AND event_type = 'auth.password_reset_requested'`,
      [A.companyId],
    );

    await expect(
      auth.forgotPassword({ companySlug: A.slug, email: "ghost@a.test" }, meta),
    ).resolves.toBeUndefined();
    await expect(
      auth.forgotPassword({ companySlug: "no-such-tenant", email: EMAIL }, meta),
    ).resolves.toBeUndefined();

    const after = await direct.query(
      `SELECT count(*)::int AS n FROM password_reset_tokens WHERE company_id = $1`,
      [A.companyId],
    );
    const outboxAfter = await direct.query(
      `SELECT count(*)::int AS n FROM outbox_events
       WHERE company_id = $1 AND event_type = 'auth.password_reset_requested'`,
      [A.companyId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(outboxAfter.rows[0].n).toBe(outboxBefore.rows[0].n);
  });

  // ── successful reset: used_at, new hash, revoke ALL sessions ──────────────────────
  it("reset thành công → used_at set + đổi hash + thu hồi MỌI refresh token (phiên cũ refresh = 401)", async () => {
    // tạo 1 phiên login (refresh token còn sống) TRƯỚC khi reset.
    const session = newAuth();
    const tokens = expectTokens(
      await session.login({ companySlug: A.slug, email: EMAIL, password: PASSWORD }, meta),
    );

    const resetToken = await requestResetToken();
    const NEW_PW = "Reset!NewPw2026";
    await expect(
      auth.resetPassword({ token: resetToken, newPassword: NEW_PW }),
    ).resolves.toBeUndefined();

    // used_at đã set trên row tương ứng.
    const usedRow = await direct.query(
      `SELECT used_at FROM password_reset_tokens
       WHERE company_id = $1 AND token_hash = $2`,
      [A.companyId, new TokenService().hashToken(resetToken)],
    );
    expect(usedRow.rows[0].used_at).not.toBeNull();

    // phiên CŨ: refresh token bị thu hồi → refresh ném 401.
    await expect(session.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    // mật khẩu mới đăng nhập được.
    const logged = expectTokens(
      await newAuth().login({ companySlug: A.slug, email: EMAIL, password: NEW_PW }, meta),
    );
    expect(logged.accessToken).toBeTruthy();

    // khôi phục mật khẩu gốc.
    await direct.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      await password.hash(PASSWORD),
      userId,
    ]);
  });

  it("password_reset_tokens lưu HASH-only (cột token_hash KHÔNG chứa plaintext token)", async () => {
    const resetToken = await requestResetToken();
    const row = await direct.query(
      `SELECT token_hash FROM password_reset_tokens
       WHERE company_id = $1 AND used_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    const stored = row.rows[0].token_hash as string;
    expect(stored).not.toContain(resetToken);
    // SHA-256 hex = 64 ký tự; khẳng định là hash, không phải plaintext.
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).toBe(new TokenService().hashToken(resetToken));
  });

  // ── change-password contract: sai currentPassword → 401, KHÔNG đổi pass ──────────
  it("change-password sai currentPassword → 401 + ZERO mutation (hash giữ nguyên)", async () => {
    const before = await direct.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    await expect(
      auth.changePassword({ id: userId, companyId: A.companyId }, "wrong-current", "NewPw!2026xyz"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const after = await direct.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    expect(after.rows[0].password_hash).toBe(before.rows[0].password_hash);
  });

  it("change-password đúng currentPassword → đổi hash + thu hồi MỌI refresh token", async () => {
    const session = newAuth();
    const tokens = expectTokens(
      await session.login({ companySlug: A.slug, email: EMAIL, password: PASSWORD }, meta),
    );
    const NEW_PW = "Change!NewPw2026";
    await expect(
      auth.changePassword({ id: userId, companyId: A.companyId }, PASSWORD, NEW_PW),
    ).resolves.toBeUndefined();
    // phiên cũ chết.
    await expect(session.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // mật khẩu mới đăng nhập được.
    const logged = expectTokens(
      await newAuth().login({ companySlug: A.slug, email: EMAIL, password: NEW_PW }, meta),
    );
    expect(logged.accessToken).toBeTruthy();
    // khôi phục.
    await direct.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      await password.hash(PASSWORD),
      userId,
    ]);
  });

  // Empty/missing currentPassword bị Zod chặn ở DTO (contract test riêng — schema.min(1)).
  it("contract: changePasswordRequestSchema chặn currentPassword rỗng (Zod min(1) → 400 path)", async () => {
    const { changePasswordRequestSchema } = await import("@mediaos/contracts");
    expect(
      changePasswordRequestSchema.safeParse({ currentPassword: "", newPassword: "abcdefgh" })
        .success,
    ).toBe(false);
    expect(changePasswordRequestSchema.safeParse({ newPassword: "abcdefgh" }).success).toBe(false);
  });
});
