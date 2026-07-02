/**
 * S2-AUTH-BE-7 (🔴 CROWN-JEWEL auth) — Session self-service: GET /auth/sessions + POST
 * /auth/sessions/:id/revoke + POST /auth/sessions/revoke-others. Own scope tuyệt đối (userId từ
 * req.user đã qua JwtAuthGuard, KHÔNG nhận tham số từ client). Supertest + Nest app THẬT → đi qua
 * toàn bộ pipeline guard/pipe/filter. DB cô lập (LANE_DB=mediaos_batch6).
 *
 * DENY-PATH TRƯỚC (RED-first cho crown): revoke phiên user KHÁC → 403/404; revoke phiên tenant KHÁC
 * (2-tenant, RLS) → KHÔNG thấy/thu hồi được; KHÔNG auth → 401; KHÔNG lộ refresh_token_hash/jti thô.
 */

import "reflect-metadata";

import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

describe.skipIf(!hasDb)("S2-AUTH-BE-7 session self-service (list/revoke/revoke-others)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let emailA: string;
  let emailB: string;
  const companyIds: string[] = [];

  async function login(tenant: SeededTenant, email: string) {
    const res = await api(app)
      .post("/auth/login")
      .send({ companySlug: tenant.slug, email, password: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "beauthsess-a");
    B = await seedCompany(direct, "beauthsess-b");
    companyIds.push(A.companyId, B.companyId);
    emailA = `beauthsess-a-${randomUUID().slice(0, 8)}@a.test`;
    emailB = `beauthsess-b-${randomUUID().slice(0, 8)}@b.test`;
    const pw = await new PasswordService().hash(PASSWORD);
    await seedUser(direct, A.companyId, emailA, pw);
    await seedUser(direct, B.companyId, emailB, pw);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // ── DENY-PATH ────────────────────────────────────────────────────────────────

  it("(deny) GET /auth/sessions KHÔNG có access token → 401", async () => {
    const res = await api(app).get("/auth/sessions");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("(deny) POST /auth/sessions/:id/revoke KHÔNG có access token → 401", async () => {
    const res = await api(app).post(`/auth/sessions/${randomUUID()}/revoke`);
    expect(res.status).toBe(401);
  });

  it("(deny) revoke sessionId KHÔNG tồn tại → 404", async () => {
    const token = await login(A, emailA);
    const res = await api(app)
      .post(`/auth/sessions/${randomUUID()}/revoke`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("(deny) revoke sessionId dạng KHÔNG PHẢI uuid → 404 (KHÔNG 500)", async () => {
    const token = await login(A, emailA);
    const res = await api(app)
      .post("/auth/sessions/not-a-uuid/revoke")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("(deny — CROSS-USER) user A KHÔNG thể revoke phiên của user KHÁC (dù cùng tenant) → 404", async () => {
    // Seed user thứ 2 trong CÙNG company A, login lấy sessionId của nó qua GET /auth/sessions.
    const emailA2 = `beauthsess-a2-${randomUUID().slice(0, 8)}@a.test`;
    const pw = await new PasswordService().hash(PASSWORD);
    await seedUser(direct, A.companyId, emailA2, pw);
    const tokenA2 = await login(A, emailA2);
    const listA2 = await api(app).get("/auth/sessions").set("Authorization", `Bearer ${tokenA2}`);
    expect(listA2.status, JSON.stringify(listA2.body)).toBe(200);
    const sessionIdOfA2 = listA2.body.data[0].id as string;

    // User A (khác user, cùng company) cố revoke phiên của A2 → 404 (owner-check, KHÔNG lộ tồn tại).
    const tokenA = await login(A, emailA);
    const res = await api(app)
      .post(`/auth/sessions/${sessionIdOfA2}/revoke`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(404);

    // Phiên A2 VẪN sống (không bị revoke bởi kẻ không sở hữu).
    const stillAlive = await api(app)
      .get("/auth/sessions")
      .set("Authorization", `Bearer ${tokenA2}`);
    expect(stillAlive.body.data.some((s: { id: string }) => s.id === sessionIdOfA2)).toBe(true);
  });

  it("(deny — CROSS-TENANT RLS) GET /auth/sessions KHÔNG thấy phiên tenant KHÁC", async () => {
    const tokenA = await login(A, emailA);
    const tokenB = await login(B, emailB);
    const listA = await api(app).get("/auth/sessions").set("Authorization", `Bearer ${tokenA}`);
    const listB = await api(app).get("/auth/sessions").set("Authorization", `Bearer ${tokenB}`);
    expect(listA.status).toBe(200);
    expect(listB.status).toBe(200);
    const idsA = new Set(listA.body.data.map((s: { id: string }) => s.id));
    const idsB = new Set(listB.body.data.map((s: { id: string }) => s.id));
    for (const id of idsB) expect(idsA.has(id)).toBe(false);
  });

  it("(deny — no-secret-leak) list item KHÔNG chứa refresh_token_hash/access_token_jti thô", async () => {
    const token = await login(A, emailA);
    const res = await api(app).get("/auth/sessions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("refresh_token_hash");
    expect(raw).not.toContain("refreshTokenHash");
    expect(raw).not.toContain("access_token_jti");
    expect(raw).not.toContain("accessTokenJti");
  });

  // ── HAPPY-PATH ───────────────────────────────────────────────────────────────

  it("GET /auth/sessions trả phiên vừa login, is_current=true", async () => {
    const token = await login(A, emailA);
    const res = await api(app).get("/auth/sessions").set("Authorization", `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    const current = res.body.data.find((s: { is_current: boolean }) => s.is_current);
    expect(current).toBeDefined();
  });

  it("revoke 1 phiên của CHÍNH user → biến mất khỏi list active", async () => {
    const token = await login(A, emailA);
    const list1 = await api(app).get("/auth/sessions").set("Authorization", `Bearer ${token}`);
    const sessionId = list1.body.data.find((s: { is_current: boolean; id: string }) => s.is_current)
      .id as string;

    // Login phiên MỚI (thứ 2) để revoke phiên thứ 1 mà không tự khoá mình khỏi hệ thống test.
    const token2 = await login(A, emailA);
    const revoke = await api(app)
      .post(`/auth/sessions/${sessionId}/revoke`)
      .set("Authorization", `Bearer ${token2}`);
    expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);
    expect(revoke.body.data.ok).toBe(true);
    expect(revoke.body.data.revoked_count).toBe(1);

    const list2 = await api(app).get("/auth/sessions").set("Authorization", `Bearer ${token2}`);
    expect(list2.body.data.some((s: { id: string }) => s.id === sessionId)).toBe(false);
  });

  it("revoke 1 phiên IDEMPOTENT: revoke lần 2 vẫn 200 (KHÔNG lỗi)", async () => {
    const token1 = await login(A, emailA);
    const list1 = await api(app).get("/auth/sessions").set("Authorization", `Bearer ${token1}`);
    const sessionId = list1.body.data.find((s: { is_current: boolean; id: string }) => s.is_current)
      .id as string;

    const token2 = await login(A, emailA);
    const first = await api(app)
      .post(`/auth/sessions/${sessionId}/revoke`)
      .set("Authorization", `Bearer ${token2}`);
    expect(first.status).toBe(200);
    const second = await api(app)
      .post(`/auth/sessions/${sessionId}/revoke`)
      .set("Authorization", `Bearer ${token2}`);
    expect(second.status).toBe(200);
  });

  it("revoke-others: thu hồi phiên KHÁC, GIỮ phiên hiện tại (is_current vẫn còn sau đó)", async () => {
    const emailA3 = `beauthsess-a3-${randomUUID().slice(0, 8)}@a.test`;
    const pw = await new PasswordService().hash(PASSWORD);
    await seedUser(direct, A.companyId, emailA3, pw);

    const token1 = await login(A, emailA3); // phiên 1
    await login(A, emailA3); // phiên 2 (khác thiết bị)
    const tokenCurrent = await login(A, emailA3); // phiên hiện tại (giữ lại)

    const before = await api(app)
      .get("/auth/sessions")
      .set("Authorization", `Bearer ${tokenCurrent}`);
    expect(before.body.data.length).toBeGreaterThanOrEqual(3);

    const res = await api(app)
      .post("/auth/sessions/revoke-others")
      .set("Authorization", `Bearer ${tokenCurrent}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.ok).toBe(true);
    expect(res.body.data.revoked_count).toBeGreaterThanOrEqual(2);

    const after = await api(app)
      .get("/auth/sessions")
      .set("Authorization", `Bearer ${tokenCurrent}`);
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0].is_current).toBe(true);

    // Phiên đã bị revoke-others → refresh KẾ TIẾP bằng token1 (nếu có refreshToken) phải fail-closed.
    // (Ở đây chỉ xác nhận access token cũ KHÔNG còn xuất hiện trong list — request refresh cookie/body
    // không nằm trong scope test bearer-only; auth-session.int-spec.ts đã phủ revoke→401 cho refresh.)
    expect(typeof token1).toBe("string");
  });
});
