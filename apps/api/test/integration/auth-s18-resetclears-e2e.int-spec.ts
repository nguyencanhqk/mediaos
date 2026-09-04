/**
 * S18-AUTH-RESETCLEARS-1 — đặt lại mật khẩu thành công thì GỠ LUÔN khoá đăng nhập 429.
 *
 * Vòng đời đo ở đây là vòng người dùng thật đi: gõ sai tới khi bị chặn → "Quên mật khẩu" → đặt mật
 * khẩu mới → đăng nhập lại. Trước WO này bước cuối vẫn 429 cho tới hết `LOGIN_LOCKOUT_SEC` (900s).
 *
 * Ca:
 *  §e2e     — 5 lần sai ⇒ lần thứ 6 là 429 → forgot → reset đúng token → login mật khẩu MỚI 200 NGAY.
 *  §acct    — 20 lần sai rải BỐN IP ⇒ bucket `acct` khoá → reset ⇒ mọi IP vào lại được.
 *  §token   — token sai / hết hạn / đã dùng ⇒ khoá CÒN NGUYÊN (không endpoint nào biến thành nút gỡ).
 *  §forgot  — sau reset tự phục vụ, trần `rl:forgot:*` KHÔNG được cấp lại (endpoint công khai).
 *  §2fa     — bucket bước-2 KHÔNG bị gỡ bởi reset (nó chỉ chứng minh quyền kiểm soát hòm thư).
 *  §admin   — admin đặt lại mật khẩu hộ ⇒ người dùng vào lại được ngay bằng `tempPassword`.
 *
 * ⚠️ Ca nhiều-IP gọi `AuthService.login(..., {ip})` TRỰC TIẾP, không qua HTTP: `req.ip` sau supertest là
 * hằng số, và bật `trust proxy` trong test để giả IP bằng header sẽ đo hành vi của một app CẤU HÌNH
 * KHÁC production (khuôn đã ký ở `auth-s18-unlock429-e2e.int-spec.ts`). Cũng vì `login()` trả 429 TRƯỚC
 * `recordLoginFailure`, mỗi IP chỉ góp tối đa `LOGIN_MAX_ATTEMPTS`=5 vào bucket `acct` (ngưỡng 20) ⇒
 * phải rải **bốn** nguồn, hai IP là không bao giờ khoá được.
 */
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { AuthService } from "../../src/auth/auth.service";
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { PasswordService } from "../../src/auth/password.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";
const PASSWORD = "Passw0rd!s18reset";
const NEW_PASSWORD = "N3wPassw0rd!s18reset";
const WRONG_PASSWORD = "Wr0ng!s18reset";

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

describe.skipIf(!hasDb)("S18-AUTH-RESETCLEARS-1 — reset mật khẩu gỡ khoá 429", () => {
  let app: INestApplication;
  let direct: Pool;
  let auth: AuthService;
  let limiter: LoginRateLimiter;
  let A: SeededTenant;
  let adminToken: string;
  const companyIds: string[] = [];

  /** Mỗi ca một user MỚI: không gian khoá `rl:` dùng chung giữa spec/môi trường (KI-067). */
  async function seedTarget(prefix: string): Promise<{ id: string; email: string }> {
    const email = `s18r-${prefix}-${randomUUID().slice(0, 8)}@a.test`;
    const id = await seedUser(direct, A.companyId, email, await hashedPw());
    return { id, email };
  }

  async function loginHttp(email: string, password: string): Promise<number> {
    const res = await api(app).post("/auth/login").send({ companySlug: A.slug, email, password });
    return res.status;
  }

  /** Plaintext reset token cho `email` — qua outbox + JIT decrypt (khuôn auth-reset-deny-path). */
  async function requestResetToken(email: string): Promise<string> {
    await auth.forgotPassword({ companySlug: A.slug, email }, { ip: "198.51.100.200" });
    const ev = await direct.query(
      `SELECT payload FROM outbox_events
       WHERE company_id = $1 AND event_type = 'auth.password_reset_requested'
       ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    const payload = ev.rows[0].payload as { userId: string; resetTokenEnc: unknown };
    return auth.decryptResetToken(A.companyId, payload.resetTokenEnc, payload.userId);
  }

  /** Trạng thái khoá ĐỌC QUA ĐƯỜNG ADMIN của WO-1 — cùng thứ con người nhìn thấy trên giao diện. */
  async function throttleOf(id: string): Promise<{ locked: boolean; buckets: string[] }> {
    const res = await api(app)
      .get(`/auth/users/${id}/login-throttle`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as { locked: boolean; buckets: string[] };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();
    auth = app.get(AuthService);
    limiter = app.get(LoginRateLimiter);

    A = await seedCompany(direct, "s18r");
    companyIds.push(A.companyId);

    const adminEmail = `s18r-admin-${randomUUID().slice(0, 8)}@a.test`;
    const adminId = await seedUser(direct, A.companyId, adminEmail, await hashedPw());
    await seedUserRole(direct, adminId, COMPANY_ADMIN_ROLE_ID, A.companyId);
    const adminRes = await api(app)
      .post("/auth/login")
      .send({ companySlug: A.slug, email: adminEmail, password: PASSWORD });
    expect(adminRes.status, JSON.stringify(adminRes.body)).toBe(200);
    adminToken = adminRes.body.data.accessToken as string;
  });

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, companyIds);
  });

  // ── §e2e — vòng người dùng thật, toàn bộ qua HTTP ───────────────────────────
  it("5 lần sai ⇒ lần 6 là 429; forgot → reset ⇒ đăng nhập mật khẩu MỚI 200 NGAY (không chờ 900s)", async () => {
    const target = await seedTarget("e2e");
    for (let i = 0; i < 5; i++) {
      expect(await loginHttp(target.email, WRONG_PASSWORD)).toBe(401);
    }
    // Lần thứ 5 ĐẶT khoá nhưng vẫn trả 401; lần thứ 6 mới là lần ĐỌC phải khoá ⇒ 429.
    expect(await loginHttp(target.email, WRONG_PASSWORD)).toBe(429);
    expect((await throttleOf(target.id)).locked).toBe(true);

    const token = await requestResetToken(target.email);
    const reset = await api(app)
      .post("/auth/reset-password")
      .send({ token, newPassword: NEW_PASSWORD });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);

    expect(await loginHttp(target.email, NEW_PASSWORD)).toBe(200);
    expect((await throttleOf(target.id)).locked).toBe(false);
  });

  // ── §acct — bucket tài khoản, BỐN IP (xem docblock đầu file) ────────────────
  it("20 lần sai rải BỐN IP ⇒ bucket `acct` khoá; reset ⇒ mọi IP vào lại được", async () => {
    const target = await seedTarget("acct");
    const ips = ["203.0.113.71", "203.0.113.72", "203.0.113.73", "203.0.113.74"];
    for (const ip of ips) {
      for (let i = 0; i < 5; i++) {
        await auth
          .login({ companySlug: A.slug, email: target.email, password: WRONG_PASSWORD }, { ip })
          .catch(() => undefined);
      }
    }
    const acctKey = LoginRateLimiter.accountKey(A.slug, target.email);
    expect(await limiter.isLocked(acctKey)).toBe(true);

    const token = await requestResetToken(target.email);
    await auth.resetPassword({ token, newPassword: NEW_PASSWORD });

    // Bỏ vế xoá `accountKey` trong `clearLoginLocks` ⇒ ca này ĐỎ: từng IP mở ra nhưng bucket tài khoản
    // vẫn chặn, tức người dùng vẫn 429 sau khi vừa tự đặt lại mật khẩu.
    expect(await limiter.isLocked(acctKey)).toBe(false);
    const fresh = "203.0.113.99";
    await expect(
      auth.login(
        { companySlug: A.slug, email: target.email, password: NEW_PASSWORD },
        { ip: fresh },
      ),
    ).resolves.toBeDefined();
  });

  // ── §token — ba nhánh token hỏng KHÔNG được chạm không gian khoá ────────────
  it("token sai / hết hạn / đã dùng ⇒ khoá CÒN NGUYÊN (endpoint reset không thành nút gỡ khoá)", async () => {
    const target = await seedTarget("badtok");
    for (let i = 0; i < 5; i++) await loginHttp(target.email, WRONG_PASSWORD);
    expect((await throttleOf(target.id)).locked).toBe(true);

    // (1) token bịa.
    const bogus = await api(app)
      .post("/auth/reset-password")
      .send({ token: `${A.companyId}.khong-phai-token-that`, newPassword: NEW_PASSWORD });
    expect(bogus.status).toBe(401);
    expect((await throttleOf(target.id)).locked).toBe(true);

    // (2) token ĐÃ DÙNG — dùng đúng một lần rồi dùng lại. Lần đầu THÀNH CÔNG nên gỡ khoá; dựng lại
    //     khoá trước khi thử lần hai, nếu không ca này đo trên nền không có khoá (xanh-rỗng).
    const used = await requestResetToken(target.email);
    expect(
      (await api(app).post("/auth/reset-password").send({ token: used, newPassword: NEW_PASSWORD }))
        .status,
    ).toBe(200);
    for (let i = 0; i < 5; i++) await loginHttp(target.email, WRONG_PASSWORD);
    expect((await throttleOf(target.id)).locked).toBe(true);
    const replay = await api(app)
      .post("/auth/reset-password")
      .send({ token: used, newPassword: NEW_PASSWORD });
    expect(replay.status).toBe(401);
    expect((await throttleOf(target.id)).locked).toBe(true);

    // (3) token HẾT HẠN — đẩy `expires_at` về quá khứ trên hàng token mới nhất.
    const fresh = await requestResetToken(target.email);
    await direct.query(
      `UPDATE password_reset_tokens SET expires_at = now() - interval '1 hour'
       WHERE user_id = $1 AND used_at IS NULL`,
      [target.id],
    );
    const expired = await api(app)
      .post("/auth/reset-password")
      .send({ token: fresh, newPassword: NEW_PASSWORD });
    expect(expired.status).toBe(401);
    expect((await throttleOf(target.id)).locked).toBe(true);
  });

  // ── §forgot — trần endpoint CÔNG KHAI không được cấp lại ────────────────────
  it("reset tự phục vụ KHÔNG cấp lại hạn mức `forgot` (giữ chống spam endpoint công khai)", async () => {
    const target = await seedTarget("forgotcap");
    const ip = "198.51.100.77";
    // Dựng trần forgot bằng chính đường sản phẩm (5 lượt/IP), rồi dựng thêm khoá login để có cái phải gỡ.
    for (let i = 0; i < 5; i++) {
      await auth.forgotPassword({ companySlug: A.slug, email: target.email }, { ip });
    }
    const forgotIpKey = LoginRateLimiter.forgotKey(A.slug, target.email, ip);
    expect(await limiter.isLocked(forgotIpKey)).toBe(true);
    for (let i = 0; i < 5; i++) await loginHttp(target.email, WRONG_PASSWORD);
    expect((await throttleOf(target.id)).locked).toBe(true);

    // Token phải lấy TRƯỚC khi trần forgot chặn — lấy lại qua IP khác (bucket per-IP).
    const token = await requestResetToken(target.email);
    await auth.resetPassword({ token, newPassword: NEW_PASSWORD });

    // Khoá LOGIN mở — đó là mục đích của WO…
    expect((await throttleOf(target.id)).locked).toBe(false);
    // …nhưng trần forgot CÒN NGUYÊN. Đổi `includeForgot:false` → `true` ở `resetPassword` ⇒ ca này ĐỎ.
    expect(await limiter.isLocked(forgotIpKey)).toBe(true);
  });

  // ── §2fa — reset mật khẩu KHÔNG gỡ bucket dò TOTP bước-2 ────────────────────
  it("bucket bước-2 (`2fa`) KHÔNG bị gỡ: reset chỉ chứng minh quyền kiểm soát hòm thư", async () => {
    const target = await seedTarget("twofa");
    const twoFaKey = LoginRateLimiter.twoFactorKey(A.companyId, target.id);
    for (let i = 0; i < 5; i++) await limiter.recordFailure(twoFaKey);
    expect(await limiter.isLocked(twoFaKey)).toBe(true);

    const token = await requestResetToken(target.email);
    await auth.resetPassword({ token, newPassword: NEW_PASSWORD });

    // Truyền `subject` vào `clearLoginLocks` ở `resetPassword` ⇒ ca này ĐỎ. `rl:2fa` là control DUY
    // NHẤT chặn dò 10⁶ mã TOTP; gỡ được nó bằng một lượt reset là biến 2FA thành hình thức.
    expect(await limiter.isLocked(twoFaKey)).toBe(true);
  });

  // ── §admin — đặt lại mật khẩu hộ cũng gỡ khoá ───────────────────────────────
  it("admin đặt lại mật khẩu hộ ⇒ người dùng vào lại được NGAY bằng tempPassword", async () => {
    const target = await seedTarget("admin");
    for (let i = 0; i < 5; i++) await loginHttp(target.email, WRONG_PASSWORD);
    expect(await loginHttp(target.email, WRONG_PASSWORD)).toBe(429);

    const res = await api(app)
      .post(`/auth/users/${target.id}/password/reset`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const tempPassword = res.body.data.tempPassword as string;

    expect(await loginHttp(target.email, tempPassword)).toBe(200);
    expect((await throttleOf(target.id)).locked).toBe(false);
  });
});
