/**
 * S18-AUTH-UNLOCK429-1 — GỠ khoá đăng nhập (429) từ giao diện: deny-path + vòng end-to-end.
 *
 * Routes (gate CẶP `unlock:user`, is_sensitive=false — seed 0444/0450):
 *   GET  /auth/users/:id/login-throttle        → {locked, remainingSec, buckets}
 *   POST /auth/users/:id/login-throttle/clear  → 204
 *
 * Ca:
 *  §deny   — role rỗng ⇒ 403 ở CẢ hai route, KÈM ca ALLOW đối chứng (không có nó, ca deny xanh-RỖNG:
 *            một route gõ sai đường dẫn cũng cho 403/404 mà chẳng chứng minh cổng nào).
 *  §rls    — admin A thao tác user của B ⇒ 404 (RLS che), id không tồn tại ⇒ 404.
 *  §self   — admin tự gỡ khoá chính mình ⇒ 400 (mirror lock/unlock).
 *  §e2e    — 5 lần sai ⇒ 429 → admin clear → đăng nhập ĐÚNG mật khẩu 200 NGAY (không chờ hết 900s).
 *  §acct   — 20 lần sai rải BỐN IP ⇒ bucket tài khoản khoá → clear ⇒ mọi IP vào lại được.
 *  §trail  — clear ghi ĐÚNG 1 audit + 1 security event, KỂ CẢ khi không có khoá nào để gỡ.
 *
 * ⚠️ Ca nhiều-IP gọi `AuthService.login(..., {ip})` trực tiếp thay vì qua HTTP: `req.ip` sau supertest là
 * hằng số, và bật `trust proxy` trong test để giả IP bằng header sẽ đo hành vi của một app CẤU HÌNH
 * KHÁC production. Khuôn này mirror `login-blocked-attribution.int-spec.ts`.
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
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";
const PASSWORD = "Passw0rd!s18unlock";
const WRONG_PASSWORD = "Wr0ng!s18unlock";

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

describe.skipIf(!hasDb)("S18-AUTH-UNLOCK429-1 — gỡ khoá đăng nhập (429)", () => {
  let app: INestApplication;
  let direct: Pool;
  let auth: AuthService;
  let limiter: LoginRateLimiter;
  let A: SeededTenant;
  let B: SeededTenant;
  let adminToken: string;
  let adminId: string;
  let noPermToken: string;
  let targetBId: string;
  const companyIds: string[] = [];

  /** Mỗi ca dùng MỘT user mới: không gian khoá `rl:` dùng chung giữa các spec/môi trường (KI-067). */
  async function seedTarget(prefix: string): Promise<{ id: string; email: string }> {
    const email = `s18-${prefix}-${randomUUID().slice(0, 8)}@a.test`;
    const id = await seedUser(direct, A.companyId, email, await hashedPw());
    return { id, email };
  }

  async function loginHttp(email: string, password: string): Promise<number> {
    const res = await api(app).post("/auth/login").send({ companySlug: A.slug, email, password });
    return res.status;
  }

  async function countRows(sql: string, params: unknown[]): Promise<number> {
    const r = await direct.query<{ n: string }>(sql, params);
    return Number(r.rows[0]?.n ?? "0");
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

    A = await seedCompany(direct, "s18A");
    B = await seedCompany(direct, "s18B");
    companyIds.push(A.companyId, B.companyId);

    const pw = await hashedPw();
    const adminEmail = `s18-admin-${randomUUID().slice(0, 8)}@a.test`;
    adminId = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, adminId, COMPANY_ADMIN_ROLE_ID, A.companyId);

    // Actor KHÔNG có unlock:user — role rỗng (deny-path).
    const noPermEmail = `s18-noperm-${randomUUID().slice(0, 8)}@a.test`;
    const noPermId = await seedUser(direct, A.companyId, noPermEmail, pw);
    const emptyRole = await seedRole(direct, A.companyId, `s18-empty-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, noPermId, emptyRole, A.companyId);
    // Cấp `view:user` để chắc chắn 403 đến TỪ cổng `unlock:user`, không phải từ việc actor mù hoàn toàn.
    const viewPerm = await seedPermissionCatalog(direct, "view", "user", false);
    await seedRolePermission(direct, emptyRole, viewPerm, "ALLOW");

    targetBId = await seedUser(
      direct,
      B.companyId,
      `s18-tgtB-${randomUUID().slice(0, 8)}@b.test`,
      pw,
    );

    const adminRes = await api(app)
      .post("/auth/login")
      .send({ companySlug: A.slug, email: adminEmail, password: PASSWORD });
    expect(adminRes.status, JSON.stringify(adminRes.body)).toBe(200);
    adminToken = adminRes.body.data.accessToken as string;

    const noPermRes = await api(app)
      .post("/auth/login")
      .send({ companySlug: A.slug, email: noPermEmail, password: PASSWORD });
    expect(noPermRes.status, JSON.stringify(noPermRes.body)).toBe(200);
    noPermToken = noPermRes.body.data.accessToken as string;
  });

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, companyIds);
  });

  // ── §deny + §allow đối chứng ────────────────────────────────────────────────
  it("thiếu `unlock:user` ⇒ 403 ở CẢ HAI route (dù CÓ view:user)", async () => {
    const target = await seedTarget("deny");
    const get = await api(app)
      .get(`/auth/users/${target.id}/login-throttle`)
      .set("Authorization", `Bearer ${noPermToken}`);
    expect(get.status).toBe(403);

    const post = await api(app)
      .post(`/auth/users/${target.id}/login-throttle/clear`)
      .set("Authorization", `Bearer ${noPermToken}`);
    expect(post.status).toBe(403);
  });

  it("ALLOW đối chứng: admin có `unlock:user` ⇒ GET 200 + POST 204 (ca deny ở trên không xanh-rỗng)", async () => {
    const target = await seedTarget("allow");
    const get = await api(app)
      .get(`/auth/users/${target.id}/login-throttle`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(200);
    expect(get.body.data).toEqual({ locked: false, remainingSec: null, buckets: [] });

    const post = await api(app)
      .post(`/auth/users/${target.id}/login-throttle/clear`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(post.status).toBe(204);
  });

  // ── §rls + §self ────────────────────────────────────────────────────────────
  it("user của tenant KHÁC ⇒ 404 (RLS che, không lộ tồn tại); id không có ⇒ 404", async () => {
    const cross = await api(app)
      .post(`/auth/users/${targetBId}/login-throttle/clear`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(cross.status).toBe(404);

    const ghost = await api(app)
      .get(`/auth/users/${randomUUID()}/login-throttle`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(ghost.status).toBe(404);
  });

  it("tự gỡ khoá CHÍNH MÌNH ⇒ 400 (mirror self-guard của lock/unlock); nhưng ĐỌC trạng thái của mình thì được", async () => {
    const self = await api(app)
      .post(`/auth/users/${adminId}/login-throttle/clear`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(self.status).toBe(400);

    const read = await api(app)
      .get(`/auth/users/${adminId}/login-throttle`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(read.status).toBe(200);
  });

  // ── §e2e — vòng đầy đủ qua HTTP ─────────────────────────────────────────────
  it("5 lần sai ⇒ 429; admin clear ⇒ đăng nhập ĐÚNG mật khẩu 200 NGAY (không chờ hết 900s)", async () => {
    const target = await seedTarget("e2e");
    for (let i = 0; i < 5; i++) {
      expect(await loginHttp(target.email, WRONG_PASSWORD)).toBe(401);
    }
    // Lần kế tiếp bị bộ chặn tần suất chặn TRƯỚC khi tới bước kiểm mật khẩu.
    expect(await loginHttp(target.email, WRONG_PASSWORD)).toBe(429);
    // …kể cả với mật khẩu ĐÚNG — đây là trải nghiệm mà WO này sinh ra để chữa.
    expect(await loginHttp(target.email, PASSWORD)).toBe(429);

    const before = await api(app)
      .get(`/auth/users/${target.id}/login-throttle`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(before.status).toBe(200);
    expect(before.body.data.locked).toBe(true);
    expect(before.body.data.buckets).toContain("ip");
    expect(before.body.data.remainingSec).toBeGreaterThan(0);

    const clear = await api(app)
      .post(`/auth/users/${target.id}/login-throttle/clear`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(clear.status).toBe(204);

    expect(await loginHttp(target.email, PASSWORD)).toBe(200);
    const after = await api(app)
      .get(`/auth/users/${target.id}/login-throttle`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(after.body.data).toEqual({ locked: false, remainingSec: null, buckets: [] });
  });

  // ── §acct — bucket tài khoản (nhiều IP) ─────────────────────────────────────
  it("20 lần sai rải BỐN IP ⇒ bucket `acct` khoá; clear ⇒ MỌI nguồn vào lại được", async () => {
    const target = await seedTarget("acct");
    // BỐN nguồn × 5 lần, KHÔNG phải hai nguồn × 10: đo thật 03/09 cho thấy sau lần sai thứ 5 từ một IP,
    // đường đã-khoá `return` TRƯỚC `recordLoginFailure` ⇒ các lượt sau từ chính IP đó KHÔNG bump bucket
    // tài khoản nữa. Muốn chạm ngưỡng 20 phải rải đủ nguồn — đúng hình dạng credential-stuffing thật,
    // và cũng là lý do trần của chỉ mục IP không bị một kẻ tấn công đơn lẻ đẩy lên nhanh.
    const ips = ["198.51.100.71", "198.51.100.72", "198.51.100.73", "198.51.100.74"];
    for (const ip of ips) {
      for (let i = 0; i < 5; i++) {
        await auth
          .login(
            { companySlug: A.slug, email: target.email, password: WRONG_PASSWORD },
            { ip, userAgent: "vitest-s18" },
          )
          .catch(() => undefined);
      }
    }
    const acctKey = LoginRateLimiter.accountKey(A.slug, target.email);
    expect(await limiter.isLocked(acctKey)).toBe(true);

    const state = await api(app)
      .get(`/auth/users/${target.id}/login-throttle`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(state.body.data.buckets).toContain("acct");

    const clear = await api(app)
      .post(`/auth/users/${target.id}/login-throttle/clear`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(clear.status).toBe(204);
    expect(await limiter.isLocked(acctKey)).toBe(false);

    // Cả hai nguồn đăng nhập ĐÚNG mật khẩu đều vào được — không nguồn nào còn khoá per-IP sót lại.
    for (const ip of ips) {
      const res = await auth.login(
        { companySlug: A.slug, email: target.email, password: PASSWORD },
        { ip, userAgent: "vitest-s18" },
      );
      // `login` trả THẲNG `AuthTokens` (hoặc challenge 2FA) — khoá còn sót ở bất kỳ nguồn nào sẽ ném
      // 429 trước khi tới đây, nên chính việc có `accessToken` là bằng chứng nguồn đó đã sạch khoá.
      expect("accessToken" in res || "twoFactorRequired" in res).toBe(true);
    }
  });

  // ── §trail — vết forensics ──────────────────────────────────────────────────
  it("clear ghi ĐÚNG 1 audit + 1 security event — KỂ CẢ khi không có khoá nào để gỡ", async () => {
    // lock-observability-rule: "admin đã thử gỡ" là dữ kiện, không phải nhiễu. `hadLock` phân biệt.
    const target = await seedTarget("trail");
    const clear = await api(app)
      .post(`/auth/users/${target.id}/login-throttle/clear`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(clear.status).toBe(204);

    expect(
      await countRows(
        `SELECT count(*)::text AS n FROM audit_logs
          WHERE object_type='user' AND object_id=$1 AND action='user.login_throttle_cleared'`,
        [target.id],
      ),
    ).toBe(1);
    expect(
      await countRows(
        `SELECT count(*)::text AS n FROM user_security_events
          WHERE user_id=$1 AND event_type='USER_UNLOCKED'`,
        [target.id],
      ),
    ).toBe(1);

    const row = await direct.query<{ payload: { reason?: string; hadLock?: boolean } }>(
      `SELECT payload FROM user_security_events WHERE user_id=$1 AND event_type='USER_UNLOCKED' LIMIT 1`,
      [target.id],
    );
    expect(row.rows[0]?.payload?.reason).toBe("login_throttle");
    expect(row.rows[0]?.payload?.hadLock).toBe(false);
  });
});
