/**
 * S2-AUTH-BE-8 (FIX-1) — PER-EMIT-SITE coverage cho `user_security_events` (SPEC-02 §22.2).
 *
 * BỐI CẢNH (vòng sửa): Đội 3 chấp nhận writer nhưng CHẶN vì lưới test chưa đủ mạnh — spec cũ
 * (security-event-writer.int-spec.ts S3) chỉ LẶP qua SECURITY_EVENT_TYPES rồi gọi `writer.record()`
 * TRỰC TIẾP (bypass service layer). Nó chứng minh mapping type→severity/company_id/RLS của WRITER,
 * NHƯNG KHÔNG chứng minh TỪNG EMIT-SITE THỰC TẾ gọi writer với ĐÚNG event_type tại ĐÚNG vị trí.
 * ⇒ một regression hoán-đổi 1 literal HỢP-LỆ-NHƯNG-SAI-SITE (vd copy-paste `USER_UNLOCKED` vào nhánh
 * `lockUser()`) KHÔNG bị TypeScript bắt (cả 2 ∈ union hợp lệ) và KHÔNG bị test cũ bắt.
 *
 * File này ĐÓNG LƯỚI đó: mỗi test GỌI 1 SERVICE METHOD THẬT (lấy từ Nest DI container — writer là
 * instance ĐÃ WIRE qua provider, KHÔNG hand-construct) rồi assert TIMELINE của subject:
 *   - `expectExactEvents(subject, [...])` — TẬP event_type của subject KHỚP CHÍNH XÁC danh sách kỳ vọng
 *     ⇒ (a) đúng event_type tại đúng site; (b) severity = SECURITY_EVENT_SEVERITY (contracts map);
 *        (c) PHỦ ĐỊNH: KHÔNG sinh sibling-type sai (set mismatch ⇒ FAIL);
 *        (d) nếu ai xoá 1 `writer.record` → subject 0 event ⇒ FAIL (bắt cả silent-skip provider un-register).
 *   - actor_user_id: self-service=subject · admin-action=admin · reuse-detection=null (hệ thống).
 *   - 3 site SESSION_REVOKED (logout/revokeSession/revokeOtherSessions) trùng event_type ⇒ phân biệt
 *     thêm bằng `payload.scope` (family/single/others) để 1 site swap sang site khác vẫn bị bắt.
 *
 * Mỗi site dùng 1 SUBJECT MỚI ⇒ query `WHERE user_id = subject` trả ĐÚNG timeline của site đó (cô lập).
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env làm hasDb=true → thiếu
 * LANE_DB ⇒ đỏ-giả trên DB dev chung 'mediaos'. skipIf ⇒ inert ở unit-run không có DB.
 */

import "reflect-metadata";

// JWT_SECRET phải có TRƯỚC khi TokenService đọc env (constructor) — mirror auth.int-spec/atomicity spec.
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { SECURITY_EVENT_SEVERITY, type SecurityEventType } from "@mediaos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { AuthService } from "../../src/auth/auth.service";
import { PasswordService } from "../../src/auth/password.service";
import { TokenService } from "../../src/auth/token.service";
import { TotpService } from "../../src/auth/totp.service";
import { TwoFactorService } from "../../src/auth/two-factor.service";
import { AuthUsersService } from "../../src/users/auth-users.service";
import { PermissionAdminService } from "../../src/permission/permission-admin.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedTwoFactorEnabled,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/** Gate cứng: Postgres THẬT VÀ DB cô lập lane (KHÔNG phải DB dev chung 'mediaos'). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

// Credential fixture (file trong test/ → guard-secrets exempt). Thoả độ mạnh của các DTO login/change-pw.
const LOGIN_PW = "Passw0rd!test99";
const NEW_PW = "N3wPass!word2026";
const IT_TIMEOUT = 30_000;

interface SecEventRow {
  event_type: string;
  severity: string;
  actor_user_id: string | null;
  payload: Record<string, unknown>;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

describe.skipIf(!runDb)("S2-AUTH-BE-8 per-emit-site — user_security_events (SPEC-02 §22.2)", () => {
  let app: INestApplication;
  let direct: Pool;
  let authService: AuthService;
  let twoFactor: TwoFactorService;
  let authUsers: AuthUsersService;
  let permAdmin: PermissionAdminService;
  let tokens: TokenService;
  const totp = new TotpService();

  let A: SeededTenant;
  let pwHash: string;
  let adminId: string; // actor cho admin-action (lock/unlock/assign/revoke) — KHÔNG bao giờ là subject
  const companyIds: string[] = [];
  let tag = "";

  /** Timeline security-event của 1 subject (đọc THÔ qua direct = superuser, thứ tự ghi). */
  async function eventsForUser(userId: string): Promise<SecEventRow[]> {
    const { rows } = await direct.query(
      `SELECT event_type, severity, actor_user_id, payload
         FROM user_security_events WHERE user_id = $1 ORDER BY created_at ASC, id ASC`,
      [userId],
    );
    return rows as SecEventRow[];
  }

  /**
   * Assert TẬP event_type của subject KHỚP CHÍNH XÁC `expected` (đa-tập) + severity mỗi row = contracts map.
   * Set-equality ⇒ vừa xác nhận đúng type-tại-đúng-site, vừa PHỦ ĐỊNH sibling-type sai, vừa bắt xoá-emit
   * (subject rỗng ⇒ mismatch). severity LẤY từ SECURITY_EVENT_SEVERITY ⇒ khớp CHECK …_severity_check.
   */
  function expectExactEvents(events: SecEventRow[], expected: SecurityEventType[]): void {
    const actualTypes = [...events.map((e) => e.event_type)].sort();
    const expectedTypes = [...expected].sort();
    expect(
      actualTypes,
      "tập event_type của subject phải khớp CHÍNH XÁC (không thiếu/dư/sai-sibling)",
    ).toEqual(expectedTypes);
    for (const e of events) {
      expect(
        e.severity,
        `severity của ${e.event_type} phải = SECURITY_EVENT_SEVERITY (contracts map)`,
      ).toBe(SECURITY_EVENT_SEVERITY[e.event_type as SecurityEventType]);
    }
  }

  /** Lấy DUY NHẤT 1 row của event_type — fail nếu 0 hoặc >1 (per-site chỉ có đúng 1). */
  function onlyEvent(events: SecEventRow[], type: SecurityEventType): SecEventRow {
    const matched = events.filter((e) => e.event_type === type);
    expect(matched.length, `phải có ĐÚNG 1 row ${type}`).toBe(1);
    return matched[0];
  }

  /** Đăng nhập body-path (mobile/Bearer, KHÔNG cookie) → { accessToken, refreshToken }. */
  async function loginBody(email: string): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await api(app)
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return {
      accessToken: res.body.data.accessToken as string,
      refreshToken: res.body.data.refreshToken as string,
    };
  }

  /** Seed 1 subject MỚI có hash mật khẩu thật (đăng nhập/đổi-pass được). Trả { id, email }. */
  async function seedLoginSubject(prefix: string): Promise<{ id: string; email: string }> {
    const email = `${prefix}-${tag}-${randomUUID().slice(0, 8)}@a.test`;
    const id = await seedUser(direct, A.companyId, email, pwHash);
    return { id, email };
  }

  /** ID phiên đang hoạt động (chưa revoke) của user, mới nhất trước. */
  async function activeSessionIds(userId: string): Promise<string[]> {
    const { rows } = await direct.query(
      `SELECT id FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map((r) => r.id as string);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    authService = app.get(AuthService, { strict: false });
    twoFactor = app.get(TwoFactorService, { strict: false });
    authUsers = app.get(AuthUsersService, { strict: false });
    permAdmin = app.get(PermissionAdminService, { strict: false });
    tokens = app.get(TokenService, { strict: false });

    tag = randomUUID().slice(0, 8);
    A = await seedCompany(direct, "emitsite");
    companyIds.push(A.companyId);
    pwHash = await new PasswordService().hash(LOGIN_PW);

    // Admin actor cho các admin-action. assign/revoke role gate `assign-role:user` (ALLOW Company);
    // lock/unlock KHÔNG gate ở service (guard ở controller) nhưng vẫn dùng admin làm actor tách bạch subject.
    adminId = await seedUser(direct, A.companyId, `emit-admin-${tag}@a.test`, pwHash);
    const assignPerm = await seedPermissionCatalog(direct, "assign-role", "user", true);
    const adminRole = await seedRole(direct, A.companyId, `emit-admin-role-${tag}`);
    await seedRolePermission(direct, adminRole, assignPerm, "ALLOW");
    await seedUserRole(direct, adminId, adminRole, A.companyId);
  }, IT_TIMEOUT);

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── AuthService.changePassword → PASSWORD_CHANGED (self, medium) ────────────────────────────────
  it(
    "changePassword → 1× PASSWORD_CHANGED (self)",
    async () => {
      const subject = await seedLoginSubject("chpw");
      await authService.changePassword(
        { id: subject.id, companyId: A.companyId },
        LOGIN_PW,
        NEW_PW,
      );

      const events = await eventsForUser(subject.id);
      expectExactEvents(events, ["PASSWORD_CHANGED"]);
      expect(onlyEvent(events, "PASSWORD_CHANGED").actor_user_id).toBe(subject.id);
    },
    IT_TIMEOUT,
  );

  // ── AuthService.forgotPassword → PASSWORD_RESET_REQUESTED (self, low) ────────────────────────────
  it(
    "forgotPassword → 1× PASSWORD_RESET_REQUESTED (self)",
    async () => {
      const subject = await seedLoginSubject("fpw");
      await authService.forgotPassword(
        { companySlug: A.slug, email: subject.email },
        { ip: "127.0.0.1", userAgent: "vitest-emit-site" },
      );

      const events = await eventsForUser(subject.id);
      expectExactEvents(events, ["PASSWORD_RESET_REQUESTED"]);
      expect(onlyEvent(events, "PASSWORD_RESET_REQUESTED").actor_user_id).toBe(subject.id);
    },
    IT_TIMEOUT,
  );

  // ── AuthService.resetPassword → PASSWORD_RESET_COMPLETED + ALL_SESSIONS_REVOKED (self) ───────────
  it(
    "resetPassword → 1× PASSWORD_RESET_COMPLETED + 1× ALL_SESSIONS_REVOKED (self)",
    async () => {
      const subject = await seedLoginSubject("rpw");
      // Seed 1 reset-token HỢP LỆ: token scoped `${companyId}.${opaque}`, hash = tokens.hashToken(scoped)
      // (chính hàm resetPassword dùng để tra passwordResetTokens). company_id set tường minh (direct = no tenant).
      const scoped = `${A.companyId}.${tokens.generateOpaqueToken()}`;
      await direct.query(
        `INSERT INTO password_reset_tokens (company_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour')`,
        [A.companyId, subject.id, tokens.hashToken(scoped)],
      );

      await authService.resetPassword({ token: scoped, newPassword: NEW_PW });

      const events = await eventsForUser(subject.id);
      expectExactEvents(events, ["PASSWORD_RESET_COMPLETED", "ALL_SESSIONS_REVOKED"]);
      expect(onlyEvent(events, "PASSWORD_RESET_COMPLETED").actor_user_id).toBe(subject.id);
      expect(onlyEvent(events, "ALL_SESSIONS_REVOKED").actor_user_id).toBe(subject.id);
    },
    IT_TIMEOUT,
  );

  // ── AuthService.refresh (reuse-detection) → REFRESH_TOKEN_REUSE_DETECTED (actor=null, critical) ──
  it(
    "refresh reuse-detection → 1× REFRESH_TOKEN_REUSE_DETECTED (actor=null, critical)",
    async () => {
      const subject = await seedLoginSubject("reuse");
      const { refreshToken: r1 } = await loginBody(subject.email);
      // Xoay lần 1 (r1 → r2, r1 bị revoke) — nhánh rotation KHÔNG phát security-event.
      await authService.refresh(r1, { ip: "127.0.0.1", userAgent: "vitest-emit-site" });
      // Replay r1 (đã revoke) → reuse-detection: emit event TRONG tx đã revoke family rồi ném 401 ngoài tx.
      await expect(
        authService.refresh(r1, { ip: "127.0.0.1", userAgent: "vitest-emit-site" }),
      ).rejects.toThrow();

      const events = await eventsForUser(subject.id);
      expectExactEvents(events, ["REFRESH_TOKEN_REUSE_DETECTED"]);
      const row = onlyEvent(events, "REFRESH_TOKEN_REUSE_DETECTED");
      // actor=null: hệ thống phát hiện replay — KHÔNG quy cho chủ tài khoản.
      expect(row.actor_user_id).toBeNull();
      expect(row.severity).toBe("critical");
    },
    IT_TIMEOUT,
  );

  // ── AuthService.logout → SESSION_REVOKED scope:family (self, low) ────────────────────────────────
  it(
    "logout → 1× SESSION_REVOKED (scope=family, self)",
    async () => {
      const subject = await seedLoginSubject("logout");
      const { refreshToken } = await loginBody(subject.email);
      await authService.logout(refreshToken);

      const events = await eventsForUser(subject.id);
      expectExactEvents(events, ["SESSION_REVOKED"]);
      const row = onlyEvent(events, "SESSION_REVOKED");
      expect(row.actor_user_id).toBe(subject.id);
      expect(row.payload?.scope).toBe("family");
    },
    IT_TIMEOUT,
  );

  // ── AuthService.revokeSession → SESSION_REVOKED scope:single (self, low) ─────────────────────────
  it(
    "revokeSession → 1× SESSION_REVOKED (scope=single, self)",
    async () => {
      const subject = await seedLoginSubject("revsess");
      await loginBody(subject.email); // tạo 1 phiên
      const [sessionId] = await activeSessionIds(subject.id);
      expect(sessionId, "phải có 1 phiên sau login").toBeTruthy();

      await authService.revokeSession(A.companyId, subject.id, sessionId);

      const events = await eventsForUser(subject.id);
      expectExactEvents(events, ["SESSION_REVOKED"]);
      const row = onlyEvent(events, "SESSION_REVOKED");
      expect(row.actor_user_id).toBe(subject.id);
      expect(row.payload?.scope).toBe("single");
    },
    IT_TIMEOUT,
  );

  // ── AuthService.revokeOtherSessions → SESSION_REVOKED scope:others (self, low) ───────────────────
  it(
    "revokeOtherSessions → 1× SESSION_REVOKED (scope=others, self)",
    async () => {
      const subject = await seedLoginSubject("revoth");
      await loginBody(subject.email); // phiên #1
      await loginBody(subject.email); // phiên #2 (giữ làm current)
      const sessions = await activeSessionIds(subject.id);
      expect(sessions.length).toBeGreaterThanOrEqual(2);
      const currentSessionId = sessions[0];

      const revoked = await authService.revokeOtherSessions(
        A.companyId,
        subject.id,
        currentSessionId,
      );
      expect(revoked).toBeGreaterThanOrEqual(1);

      const events = await eventsForUser(subject.id);
      expectExactEvents(events, ["SESSION_REVOKED"]);
      const row = onlyEvent(events, "SESSION_REVOKED");
      expect(row.actor_user_id).toBe(subject.id);
      expect(row.payload?.scope).toBe("others");
    },
    IT_TIMEOUT,
  );

  // ── TwoFactorService.confirmEnable → TOTP_ENABLED (self, low) ────────────────────────────────────
  it(
    "TwoFactor.confirmEnable → 1× TOTP_ENABLED (self)",
    async () => {
      const subject = await seedLoginSubject("2faon");
      const { otpauthUri } = await twoFactor.enroll(subject.id, A.companyId); // enroll KHÔNG phát event
      const secret = new URL(otpauthUri).searchParams.get("secret") ?? "";
      await twoFactor.confirmEnable(subject.id, A.companyId, totp.generate(secret));

      const events = await eventsForUser(subject.id);
      expectExactEvents(events, ["TOTP_ENABLED"]);
      expect(onlyEvent(events, "TOTP_ENABLED").actor_user_id).toBe(subject.id);
    },
    IT_TIMEOUT,
  );

  // ── TwoFactorService.disable → TOTP_DISABLED (self, medium) ──────────────────────────────────────
  it(
    "TwoFactor.disable → 1× TOTP_DISABLED (self)",
    async () => {
      const subject = await seedLoginSubject("2faoff");
      // Bật sẵn TRỰC TIẾP (không qua confirmEnable) để timeline của subject CHỈ chứa event của disable.
      await seedTwoFactorEnabled(direct, A.companyId, subject.id);
      await twoFactor.disable(subject.id, A.companyId);

      const events = await eventsForUser(subject.id);
      expectExactEvents(events, ["TOTP_DISABLED"]);
      expect(onlyEvent(events, "TOTP_DISABLED").actor_user_id).toBe(subject.id);
    },
    IT_TIMEOUT,
  );

  // ── AuthUsersService.lockUser → USER_LOCKED (actor=admin, high) ──────────────────────────────────
  it(
    "AuthUsers.lockUser → 1× USER_LOCKED (actor=admin, subject=target)",
    async () => {
      const target = await seedLoginSubject("lock");
      await authUsers.lockUser({ id: adminId, companyId: A.companyId }, target.id, "policy");

      const events = await eventsForUser(target.id);
      expectExactEvents(events, ["USER_LOCKED"]);
      const row = onlyEvent(events, "USER_LOCKED");
      expect(row.actor_user_id).toBe(adminId);
      expect(row.severity).toBe("high");
    },
    IT_TIMEOUT,
  );

  // ── AuthUsersService.unlockUser → USER_UNLOCKED (actor=admin, medium) ────────────────────────────
  it(
    "AuthUsers.unlockUser → 1× USER_UNLOCKED (actor=admin, subject=target)",
    async () => {
      const target = await seedLoginSubject("unlock");
      // Đặt trạng thái 'locked' TRỰC TIẾP (không qua lockUser) → timeline subject CHỈ chứa event của unlock.
      await direct.query(`UPDATE users SET status = 'locked', locked_at = now() WHERE id = $1`, [
        target.id,
      ]);
      await authUsers.unlockUser({ id: adminId, companyId: A.companyId }, target.id);

      const events = await eventsForUser(target.id);
      expectExactEvents(events, ["USER_UNLOCKED"]);
      expect(onlyEvent(events, "USER_UNLOCKED").actor_user_id).toBe(adminId);
    },
    IT_TIMEOUT,
  );

  // ── PermissionAdminService.assignRole → ROLE_ASSIGNED (actor=admin, medium) ──────────────────────
  it(
    "PermissionAdmin.assignRole → 1× ROLE_ASSIGNED (actor=admin, subject=target)",
    async () => {
      const target = await seedLoginSubject("assign");
      const role = await seedRole(
        direct,
        A.companyId,
        `emit-assignable-${tag}-${randomUUID().slice(0, 6)}`,
      );
      await permAdmin.assignRole({ id: adminId, companyId: A.companyId }, target.id, {
        roleId: role,
      });

      const events = await eventsForUser(target.id);
      expectExactEvents(events, ["ROLE_ASSIGNED"]);
      expect(onlyEvent(events, "ROLE_ASSIGNED").actor_user_id).toBe(adminId);
    },
    IT_TIMEOUT,
  );

  // ── PermissionAdminService.revokeRole → ROLE_REMOVED (actor=admin, medium) ───────────────────────
  it(
    "PermissionAdmin.revokeRole → 1× ROLE_REMOVED (actor=admin, subject=target)",
    async () => {
      const target = await seedLoginSubject("revoke");
      const role = await seedRole(
        direct,
        A.companyId,
        `emit-revokable-${tag}-${randomUUID().slice(0, 6)}`,
      );
      // Gán TRỰC TIẾP (không qua assignRole) → timeline subject CHỈ chứa event của revoke.
      await seedUserRole(direct, target.id, role, A.companyId);
      await permAdmin.revokeRole({ id: adminId, companyId: A.companyId }, target.id, role);

      const events = await eventsForUser(target.id);
      expectExactEvents(events, ["ROLE_REMOVED"]);
      expect(onlyEvent(events, "ROLE_REMOVED").actor_user_id).toBe(adminId);
    },
    IT_TIMEOUT,
  );
});
