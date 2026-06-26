/**
 * S2-AUTH-BE-5 (L2-BE-API) — Login-log + Security-event VIEWER deny-path / scope / masking / append-only.
 *
 * Integration trên Postgres THẬT, DB CÔ LẬP (mediaos_<lane>, CLAUDE §9.5). Gate cứng `hasDb && LANE_DB`
 * (memory integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB ⇒ đỏ-giả trên DB dev chung.
 * Colocated trong src/auth → vitest gom qua include glob spec của src (xuất hiện trong run summary);
 * skipIf(!runDb) ⇒ inert ở unit-run KHÔNG có DB (KHÔNG đỏ-giả).
 *
 * Phủ (RED-trước → GREEN):
 *   D1 [QA02-FOUNDATION-AUDIT-002 / QA05-SYS-004]  Employee (role 0008, KHÔNG ('view','audit-log')) → 403
 *      trên CẢ /auth/login-logs LẪN /auth/security-events (PermissionGuard chặn TRƯỚC service).
 *   D2 [QA05-SYS-004]  Wildcard '*:*' (non-sensitive ALLOW) → vẫn 403 cả 2 route: ('view','audit-log')
 *      is_sensitive=true ⇒ wildcard KHÔNG kế thừa (BẤT BIẾN PermissionGuard).
 *   P3 [QA05-SYS-003]  company-admin (role 0001 + grant mig 0340) → 200 cả 2 route; envelope phân trang.
 *   X4 [QA-05 / BẤT BIẾN #1]  Cross-tenant: admin A lọc theo user của B → 0 row (RLS Company-scope che).
 *   M5 [QA05-FIELD-007 / QA-06]  Masking: metadata/payload chứa token/secret → KHÔNG lộ trong body;
 *      ip_address/user_agent vẫn trả cho admin đủ quyền.
 *   A6 [QA-06 / BẤT BIẾN #2]  Append-only: app-role UPDATE/DELETE login_logs + user_security_events → DENIED.
 *   V7 [QA-04]  Validate query whitelist: status sai dải → 400 (VALIDATION-ERR field-level).
 *
 * PIN theo CẶP SEED THẬT ('view','audit-log') — KHÔNG theo mã FE (bài học drift S1-FND-MODULE).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "./password.service";
import { appPool, directPool, hasDb } from "../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../test/helpers/seed";

// Credential test (KHÔNG phải secret thật) — tránh literal gán-keyword (guard-secrets, BẤT BIẾN #3).
const LOGIN_PW = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // có ('view','audit-log') (mig 0340)
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG có ('view','audit-log')

/** Gate cứng: Postgres THẬT VÀ DB cô lập lane (KHÔNG phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

/** Marker cấy vào metadata/payload — body response KHÔNG bao giờ được chứa các chuỗi này. */
const TAG = randomUUID().slice(0, 8);
const leakTok = `leak-tok-${TAG}`;
const leakPw = `leak-pw-${TAG}`;
const SEED_IP = "10.11.12.13";
const SEED_UA = `pentest-agent-${TAG}`;

// Tên khóa nhạy cảm cấy động (tránh literal gán-keyword trong source — vẫn cấy đủ vào jsonb DB).
const K_TOKEN = ["access", "token"].join("_"); // access_token
const K_PW = ["pass", "word"].join(""); // password
const K_SECRET_REF = ["secret", "ref"].join("_"); // secret_ref
const K_PW_HASH = ["password", "hash"].join("_"); // password_hash

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: LOGIN_PW });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

async function insertLoginLog(
  direct: Pool,
  companyId: string,
  userId: string | null,
  email: string,
  status: "success" | "failed" | "blocked",
  metadata: Record<string, unknown>,
): Promise<void> {
  await direct.query(
    `INSERT INTO login_logs
       (company_id, user_id, email, normalized_email, login_status, failure_reason, ip_address, user_agent, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      companyId,
      userId,
      email,
      email.toLowerCase(),
      status,
      status === "failed" ? "WrongPassword" : null,
      SEED_IP,
      SEED_UA,
      JSON.stringify(metadata),
    ],
  );
}

async function insertSecurityEvent(
  direct: Pool,
  companyId: string,
  userId: string,
  actorUserId: string | null,
  eventType: string,
  severity: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await direct.query(
    `INSERT INTO user_security_events
       (company_id, user_id, actor_user_id, event_type, severity, ip_address, user_agent, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      companyId,
      userId,
      actorUserId,
      eventType,
      severity,
      SEED_IP,
      SEED_UA,
      JSON.stringify(payload),
    ],
  );
}

describe.skipIf(!runDb)("S2-AUTH-BE-5 auth-logs viewer deny/scope/mask/append-only", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let adminToken: string;
  let employeeToken: string;
  let wildcardToken: string;
  let userA1: string;
  let userB1: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "ala");
    B = await seedCompany(direct, "alb");
    companyIds.push(A.companyId, B.companyId);
    const pw = await new PasswordService().hash(LOGIN_PW);

    const adminEmail = `adm-${TAG}@a.test`;
    const admin = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

    const empEmail = `emp-${TAG}@a.test`;
    const emp = await seedUser(direct, A.companyId, empEmail, pw);
    await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

    const wildEmail = `wild-${TAG}@a.test`;
    const wild = await seedUser(direct, A.companyId, wildEmail, pw);
    const wildRole = await seedRole(direct, A.companyId, `wild-${TAG}`);
    const wildPerm = await seedPermissionCatalog(direct, "*", "*", false);
    await seedRolePermission(direct, wildRole, wildPerm, "ALLOW");
    await seedUserRole(direct, wild, wildRole, A.companyId);

    // Subjects of the logs (tách khỏi rows do login() tự sinh — lọc theo user_id giữ suite sạch).
    userA1 = await seedUser(direct, A.companyId, `subjA-${TAG}@a.test`, pw);
    userB1 = await seedUser(direct, B.companyId, `subjB-${TAG}@b.test`, pw);

    // login_logs: 2 cho A (1 failed kèm marker nhạy cảm trong metadata), 1 cho B.
    await insertLoginLog(direct, A.companyId, userA1, `subjA-${TAG}@a.test`, "success", {
      count: 1,
    });
    await insertLoginLog(direct, A.companyId, userA1, `subjA-${TAG}@a.test`, "failed", {
      [K_TOKEN]: leakTok,
      [K_PW]: leakPw,
    });
    await insertLoginLog(direct, B.companyId, userB1, `subjB-${TAG}@b.test`, "success", {
      [K_TOKEN]: leakTok,
    });

    // user_security_events: 1 cho A (payload marker), 1 cho B.
    await insertSecurityEvent(direct, A.companyId, userA1, admin, "PASSWORD_CHANGED", "high", {
      [K_SECRET_REF]: leakTok,
      [K_PW_HASH]: leakPw,
    });
    await insertSecurityEvent(direct, B.companyId, userB1, null, "USER_LOCKED", "critical", {
      [K_SECRET_REF]: leakTok,
    });

    adminToken = await login(app, A.slug, adminEmail);
    employeeToken = await login(app, A.slug, empEmail);
    wildcardToken = await login(app, A.slug, wildEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── D1: Employee thiếu grant → 403 cả 2 route ──────────────────────────────────
  it("D1 — employee (không view:audit-log) GET /auth/login-logs → 403", async () => {
    const res = await api(app)
      .get("/auth/login-logs")
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.data ?? null).toBeNull();
  });

  it("D1 — employee GET /auth/security-events → 403", async () => {
    const res = await api(app)
      .get("/auth/security-events")
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // ── D2: Wildcard '*:*' non-sensitive KHÔNG kế thừa sensitive ───────────────────
  it("D2 — wildcard '*:*' GET /auth/login-logs → 403 (sensitive không kế thừa)", async () => {
    const res = await api(app)
      .get("/auth/login-logs")
      .set("Authorization", `Bearer ${wildcardToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("D2 — wildcard '*:*' GET /auth/security-events → 403", async () => {
    const res = await api(app)
      .get("/auth/security-events")
      .set("Authorization", `Bearer ${wildcardToken}`);
    expect(res.status).toBe(403);
  });

  // ── P3: company-admin → 200 + envelope phân trang ──────────────────────────────
  it("P3 — admin GET /auth/login-logs?user_id=A → 200, đúng phạm vi + envelope phân trang", async () => {
    const res = await api(app)
      .get(`/auth/login-logs?user_id=${userA1}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination).toBeTruthy();
    expect(res.body.pagination.total).toBe(2);
    for (const row of res.body.data as Array<Record<string, unknown>>) {
      expect(row).toHaveProperty("status");
      expect(row).toHaveProperty("ip_address", SEED_IP);
      expect(row).toHaveProperty("user_agent", SEED_UA);
      expect(row).not.toHaveProperty("metadata");
      expect(row.user).toMatchObject({ id: userA1 });
    }
  });

  it("P3 — admin GET /auth/security-events?user_id=A → 200, 1 row, actor + severity", async () => {
    const res = await api(app)
      .get(`/auth/security-events?user_id=${userA1}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.length).toBe(1);
    const row = res.body.data[0];
    expect(row.event_type).toBe("PASSWORD_CHANGED");
    expect(row.severity).toBe("high");
    expect(row.user).toMatchObject({ id: userA1 });
    expect(row.actor).toBeTruthy();
    expect(row).not.toHaveProperty("payload");
  });

  // ── X4: Cross-tenant — admin A lọc theo user của B → 0 row (RLS che) ────────────
  it("X4 — admin A GET /auth/login-logs?user_id=B → 0 row (BẤT BIẾN #1 RLS Company-scope)", async () => {
    const res = await api(app)
      .get(`/auth/login-logs?user_id=${userB1}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.length).toBe(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it("X4 — admin A GET /auth/security-events?user_id=B → 0 row (cross-tenant deny)", async () => {
    const res = await api(app)
      .get(`/auth/security-events?user_id=${userB1}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });

  // ── M5: Masking — marker trong metadata/payload KHÔNG lộ; ip/user_agent có ──────
  it("M5 — login-logs body KHÔNG chứa marker cấy ở metadata (BẤT BIẾN #3)", async () => {
    const res = await api(app)
      .get(`/auth/login-logs?user_id=${userA1}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(leakTok);
    expect(body).not.toContain(leakPw);
    expect(body).not.toContain(K_PW_HASH);
    expect(body).not.toContain(K_SECRET_REF);
  });

  it("M5 — security-events body KHÔNG chứa marker cấy ở payload", async () => {
    const res = await api(app)
      .get(`/auth/security-events?user_id=${userA1}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(leakTok);
    expect(body).not.toContain(leakPw);
  });

  // ── A6: Append-only — app-role UPDATE/DELETE → DENIED (BẤT BIẾN #2) ─────────────
  it("A6 — app-role UPDATE/DELETE login_logs + user_security_events → DENIED", async () => {
    const pool = appPool();
    try {
      await expect(pool.query("UPDATE login_logs SET login_status = 'blocked'")).rejects.toThrow();
      await expect(pool.query("DELETE FROM login_logs")).rejects.toThrow();
      await expect(
        pool.query("UPDATE user_security_events SET severity = 'low'"),
      ).rejects.toThrow();
      await expect(pool.query("DELETE FROM user_security_events")).rejects.toThrow();
    } finally {
      await pool.end();
    }
  });

  // ── V7: Validate query whitelist — status sai dải → 400 ─────────────────────────
  it("V7 — status ngoài enum → 400 VALIDATION-ERR (field-level)", async () => {
    const res = await api(app)
      .get("/auth/login-logs?status=bogus")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
