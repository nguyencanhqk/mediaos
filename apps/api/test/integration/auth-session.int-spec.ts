/**
 * FS-1a (🔴 CROWN-JEWEL auth) — vòng đời phiên SSO cookie-subdomain: /auth/refresh (rotation +
 * REUSE-DETECTION thu hồi family), /auth/logout (thu hồi family + xoá cookie), refresh cookie HttpOnly/Secure/
 * SameSite=Strict/Domain, CSRF double-submit, redirect allowlist. Supertest + Nest app THẬT → đi qua toàn bộ
 * pipeline guard/pipe/filter. DB cô lập (LANE_DB=mediaos_feauth).
 *
 * DENY-PATH TRƯỚC (RED-first cho crown): thiếu cookie/CSRF, reuse replay, logout, open-redirect.
 */

import "reflect-metadata";

// PHẢI set env TRƯỚC khi compile module (SessionCookieService đọc env lúc khởi tạo).
process.env.AUTH_COOKIE_DOMAIN = ".localhost";
process.env.AUTH_COOKIE_SECURE = "true";
process.env.AUTH_REDIRECT_ALLOWLIST = "https://studio.localhost,https://people.localhost";

import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  REFRESH_COOKIE_NAME,
} from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const PASSWORD = "Passw0rd!test99";

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

/** Tách 1 cookie value (raw, chưa decode) từ mảng Set-Cookie. */
function cookieValue(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined;
  for (const c of setCookie) {
    const m = c.match(new RegExp(`^${name}=([^;]*)`));
    if (m) return m[1];
  }
  return undefined;
}

/** Tìm dòng Set-Cookie đầy đủ (để assert flag) theo tên. */
function cookieLine(setCookie: string[] | undefined, name: string): string | undefined {
  return setCookie?.find((c) => c.startsWith(`${name}=`));
}

describe.skipIf(!hasDb)("FS-1a auth session (refresh/logout/CSRF/redirect — cookie SSO)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let email: string;
  const companyIds: string[] = [];

  /** Đăng nhập qua HTTP → trả set-cookie + body envelope. */
  async function login() {
    const res = await api(app)
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
    return {
      res,
      refresh: cookieValue(setCookie, REFRESH_COOKIE_NAME)!,
      csrf: cookieValue(setCookie, CSRF_COOKIE_NAME)!,
      setCookie,
    };
  }

  /** Gọi /auth/refresh ở chế độ cookie (Cookie + header CSRF). */
  function refreshCookie(refresh: string, csrf: string, csrfHeader = csrf) {
    return api(app)
      .post("/auth/refresh")
      .set("Cookie", `${REFRESH_COOKIE_NAME}=${refresh}; ${CSRF_COOKIE_NAME}=${csrf}`)
      .set(CSRF_HEADER_NAME, csrfHeader)
      .send({});
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "feauth");
    companyIds.push(A.companyId);
    email = `feauth-${randomUUID().slice(0, 8)}@a.test`;
    const pw = await new PasswordService().hash(PASSWORD);
    await seedUser(direct, A.companyId, email, pw);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // ── DENY-PATH ────────────────────────────────────────────────────────────────

  it("(deny) refresh KHÔNG cookie + KHÔNG body → 401", async () => {
    const res = await api(app).post("/auth/refresh").send({});
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("(deny) refresh có cookie nhưng THIẾU header CSRF → 403", async () => {
    const { refresh, csrf } = await login();
    const res = await api(app)
      .post("/auth/refresh")
      .set("Cookie", `${REFRESH_COOKIE_NAME}=${refresh}; ${CSRF_COOKIE_NAME}=${csrf}`)
      .send({}); // KHÔNG set x-csrf-token
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("(deny) refresh có cookie nhưng header CSRF SAI → 403", async () => {
    const { refresh, csrf } = await login();
    const res = await refreshCookie(refresh, csrf, "wrong-csrf-token-value");
    expect(res.status).toBe(403);
  });

  it("(deny — REUSE-DETECTION) replay refresh token đã xoay → 401 + thu hồi CẢ HỌ", async () => {
    const { refresh: r1, csrf: c1 } = await login();

    // Xoay lần 1: r1 → r2 (r1 bị revoke).
    const rot = await refreshCookie(r1, c1);
    expect(rot.status, JSON.stringify(rot.body)).toBe(200);
    const sc2 = rot.headers["set-cookie"] as unknown as string[] | undefined;
    const r2 = cookieValue(sc2, REFRESH_COOKIE_NAME)!;
    const c2 = cookieValue(sc2, CSRF_COOKIE_NAME)!;

    // Replay r1 (đã revoke) → reuse-detection → 401.
    const replay = await refreshCookie(r1, c1);
    expect(replay.status).toBe(401);

    // Family bị thu hồi → token HỢP LỆ mới nhất (r2) cũng chết → 401.
    const afterReuse = await refreshCookie(r2, c2);
    expect(afterReuse.status).toBe(401);
  });

  it("(deny — LOGOUT) logout thu hồi family → refresh sau đó 401", async () => {
    const { refresh, csrf } = await login();
    const out = await api(app)
      .post("/auth/logout")
      .set("Cookie", `${REFRESH_COOKIE_NAME}=${refresh}; ${CSRF_COOKIE_NAME}=${csrf}`)
      .set(CSRF_HEADER_NAME, csrf)
      .send({});
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.data.ok).toBe(true);
    // Cookie bị xoá (Max-Age=0).
    const cleared = out.headers["set-cookie"] as unknown as string[] | undefined;
    expect(cookieLine(cleared, REFRESH_COOKIE_NAME)).toContain("Max-Age=0");

    const after = await refreshCookie(refresh, csrf);
    expect(after.status).toBe(401);
  });

  it("(deny — LOGOUT CSRF) logout cookie-based THIẾU CSRF → 403 (chống forced-logout)", async () => {
    const { refresh, csrf } = await login();
    const res = await api(app)
      .post("/auth/logout")
      .set("Cookie", `${REFRESH_COOKIE_NAME}=${refresh}; ${CSRF_COOKIE_NAME}=${csrf}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("(deny — OPEN-REDIRECT) origin ngoài allowlist → allowed:false", async () => {
    const res = await api(app).get("/auth/redirect-allowed").query({ redirect: "https://evil.com/x" });
    expect(res.status).toBe(200);
    expect(res.body.data.allowed).toBe(false);
    expect(res.body.data.target).toBeNull();
  });

  // ── HAPPY-PATH ───────────────────────────────────────────────────────────────

  it("login đặt refresh cookie HttpOnly+Secure+SameSite=Strict+Domain + CSRF cookie KHÔNG HttpOnly", async () => {
    const { setCookie } = await login();
    const rt = cookieLine(setCookie, REFRESH_COOKIE_NAME)!;
    expect(rt).toContain("HttpOnly");
    expect(rt).toContain("Secure");
    expect(rt).toContain("SameSite=Strict");
    expect(rt).toContain("Domain=.localhost");

    const csrfLine = cookieLine(setCookie, CSRF_COOKIE_NAME)!;
    expect(csrfLine).not.toContain("HttpOnly"); // client phải đọc được để echo header
    expect(csrfLine).toContain("SameSite=Strict");
  });

  it("refresh cookie + CSRF hợp lệ → 200 {accessToken,expiresIn}, KHÔNG refreshToken trong body, xoay cookie", async () => {
    const { refresh, csrf } = await login();
    const res = await refreshCookie(refresh, csrf);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(typeof res.body.data.accessToken).toBe("string");
    expect(res.body.data.expiresIn).toBeGreaterThan(0);
    expect(res.body.data.refreshToken).toBeUndefined(); // refresh token CHỈ trong cookie
    // Cookie xoay (giá trị mới khác cũ).
    const sc = res.headers["set-cookie"] as unknown as string[] | undefined;
    expect(cookieValue(sc, REFRESH_COOKIE_NAME)).not.toBe(refresh);
  });

  it("redirect-allowed: origin trong allowlist → allowed:true + target", async () => {
    const res = await api(app)
      .get("/auth/redirect-allowed")
      .query({ redirect: "https://studio.localhost/tasks" });
    expect(res.status).toBe(200);
    expect(res.body.data.allowed).toBe(true);
    expect(res.body.data.target).toBe("https://studio.localhost/tasks");
  });

  // ── REGRESSION (luồng cũ body refreshToken — mobile/Bearer KHÔNG cookie) ────────
  it("(regression) refresh body refreshToken (không cookie) vẫn trả AuthTokens đầy đủ", async () => {
    const loginRes = await api(app)
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: PASSWORD });
    const bodyRefresh = loginRes.body.data.refreshToken as string;
    expect(typeof bodyRefresh).toBe("string");

    const res = await api(app).post("/auth/refresh").send({ refreshToken: bodyRefresh });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(typeof res.body.data.accessToken).toBe("string");
    expect(typeof res.body.data.refreshToken).toBe("string"); // luồng cũ: refresh token TRONG body
    expect(res.body.data.refreshToken).not.toBe(bodyRefresh); // đã xoay
  });

  /** Đăng nhập lấy refresh token TRONG body (luồng mobile/Bearer). */
  async function loginBody(): Promise<string> {
    const res = await api(app)
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: PASSWORD });
    return res.body.data.refreshToken as string;
  }

  it("body-path logout với token CÒN SỐNG → thu hồi cả family", async () => {
    const r1 = await loginBody();
    const rot = await api(app).post("/auth/refresh").send({ refreshToken: r1 }); // r1 → r2
    const r2 = rot.body.data.refreshToken as string;
    // logout bằng token sống (r2) → thu hồi family.
    const out = await api(app).post("/auth/logout").send({ refreshToken: r2 });
    expect(out.status).toBe(200);
    expect(out.body.data.ok).toBe(true);
    // r2 đã bị thu hồi → refresh 401.
    const after = await api(app).post("/auth/refresh").send({ refreshToken: r2 });
    expect(after.status).toBe(401);
  });

  it("(deny — FORCED-LOGOUT) body-path logout với token ĐÃ XOAY (revoked) KHÔNG thu hồi family sống", async () => {
    const r1 = await loginBody();
    const rot = await api(app).post("/auth/refresh").send({ refreshToken: r1 }); // r1 → r2 (r1 revoked)
    const r2 = rot.body.data.refreshToken as string;
    // Kẻ tấn công giữ token CŨ r1 (đã revoke, vốn vô hại) → POST logout {r1}: KHÔNG được force-logout nạn nhân.
    const attack = await api(app).post("/auth/logout").send({ refreshToken: r1 });
    expect(attack.status).toBe(200); // idempotent, nhưng KHÔNG thu hồi family
    // Token sống r2 VẪN dùng được (family chưa bị kẻ tấn công thu hồi).
    const stillAlive = await api(app).post("/auth/refresh").send({ refreshToken: r2 });
    expect(stillAlive.status, JSON.stringify(stillAlive.body)).toBe(200);
  });
});
