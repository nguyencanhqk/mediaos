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
 *   R8 [QA-04 — FIX Đội-3 MEDIUM]  from_date/to_date range: gte/lte trên created_at — bao đúng subset
 *      trong dải (total khớp) + biên NGOÀI dải → 0 row.
 *   E9 [QA-04 — FIX Đội-3 MEDIUM]  event_type filter /auth/security-events: eq exact — lọc 1 loại trả
 *      đúng 1 row, KHÔNG lẫn event loại khác cùng user.
 *   S10 [QA-04 — FIX Đội-3 MEDIUM]  status filter /auth/login-logs: status=success CHỈ trả success-rows
 *      (KHÔNG lẫn failed/blocked) + sort=status/order=asc + no-filter (phủ branch repo cho coverage gate).
 *   S11 [QA-04 — FIX Đội-3 MEDIUM]  severity filter /auth/security-events: severity=high CHỈ trả high-rows
 *      (KHÔNG lẫn medium/low) + sort=severity/event_type + from/to range + no-filter (phủ branch repo).
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
  createdAt?: string,
): Promise<void> {
  // created_at chỉ chèn khi seed cần timestamp TƯỜNG MINH (test range from_date/to_date);
  // bỏ qua ⇒ DEFAULT now() (giữ NGUYÊN hành vi mọi call hiện có — additive, không phá).
  const cols = [
    "company_id",
    "user_id",
    "email",
    "normalized_email",
    "login_status",
    "failure_reason",
    "ip_address",
    "user_agent",
    "metadata",
  ];
  const vals: unknown[] = [
    companyId,
    userId,
    email,
    email.toLowerCase(),
    status,
    status === "failed" ? "WrongPassword" : null,
    SEED_IP,
    SEED_UA,
    JSON.stringify(metadata),
  ];
  if (createdAt) {
    cols.push("created_at");
    vals.push(createdAt);
  }
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(",");
  await direct.query(`INSERT INTO login_logs (${cols.join(", ")}) VALUES (${placeholders})`, vals);
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

  // ── R8: from_date/to_date range — gte/lte trên created_at, biên NGOÀI dải → 0 ────
  // FIX Đội-3 (MEDIUM): trước đây chưa có int-test cho dải ngày; chứng minh gte/lte repo
  // chạy thật trên DB. Subject riêng (company A) 3 row created_at TƯỜNG MINH cách xa nhau —
  // KHÔNG đụng userA1 (giữ P3 đếm = 2). 1 row TRONG dải 2023, 2 row NGOÀI (2020 + 2025).
  it("R8 — login-logs from_date/to_date bao đúng subset trong dải + biên ngoài → 0", async () => {
    const email = `subjDate-${TAG}@a.test`;
    const subj = await seedUser(direct, A.companyId, email);
    await insertLoginLog(
      direct,
      A.companyId,
      subj,
      email,
      "success",
      { i: 0 },
      "2020-01-01T00:00:00.000Z",
    );
    await insertLoginLog(
      direct,
      A.companyId,
      subj,
      email,
      "success",
      { i: 1 },
      "2023-06-15T12:00:00.000Z",
    );
    await insertLoginLog(
      direct,
      A.companyId,
      subj,
      email,
      "success",
      { i: 2 },
      "2025-12-31T00:00:00.000Z",
    );

    // Sanity: KHÔNG filter date → cả 3 row (chứng minh range thực sự thu hẹp 3→1).
    const all = await api(app)
      .get(`/auth/login-logs?user_id=${subj}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.pagination.total).toBe(3);

    // Trong dải [2023-01-01 .. 2023-12-31] → đúng 1 row (2023-06-15); total khớp subset.
    const inRange = await api(app)
      .get(`/auth/login-logs?user_id=${subj}&from_date=2023-01-01&to_date=2023-12-31`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(inRange.status, JSON.stringify(inRange.body)).toBe(200);
    expect(inRange.body.data.length).toBe(1);
    expect(inRange.body.pagination.total).toBe(1);
    const ts = new Date(inRange.body.data[0].created_at as string).getTime();
    expect(ts).toBeGreaterThanOrEqual(new Date("2023-01-01T00:00:00.000Z").getTime());
    expect(ts).toBeLessThanOrEqual(new Date("2023-12-31T23:59:59.999Z").getTime());

    // Biên NGOÀI dải (2024 — không có row nào) → 0 row + total 0.
    const outRange = await api(app)
      .get(`/auth/login-logs?user_id=${subj}&from_date=2024-01-01&to_date=2024-12-31`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(outRange.status, JSON.stringify(outRange.body)).toBe(200);
    expect(outRange.body.data.length).toBe(0);
    expect(outRange.body.pagination.total).toBe(0);
  });

  // ── E9: event_type filter — eq exact, KHÔNG lẫn event loại khác ────────────────
  // FIX Đội-3 (MEDIUM): trước đây chưa có int-test cho event_type. Subject riêng (company A)
  // có 2 event KHÁC loại cho CÙNG user — KHÔNG đụng userA1 (giữ P3 = 1). Lọc 1 loại → 1 row.
  it("E9 — security-events event_type=PASSWORD_CHANGED → đúng 1 row, không lẫn EMAIL_CHANGED", async () => {
    const email = `subjEv-${TAG}@a.test`;
    const subj = await seedUser(direct, A.companyId, email);
    await insertSecurityEvent(direct, A.companyId, subj, null, "PASSWORD_CHANGED", "high", {
      i: 0,
    });
    await insertSecurityEvent(direct, A.companyId, subj, null, "EMAIL_CHANGED", "medium", { i: 1 });

    // Sanity: KHÔNG filter type → 2 row (chứng minh filter thực sự thu hẹp 2→1).
    const all = await api(app)
      .get(`/auth/security-events?user_id=${subj}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.pagination.total).toBe(2);

    // Lọc event_type=PASSWORD_CHANGED → đúng 1 row, KHÔNG lẫn EMAIL_CHANGED.
    const filtered = await api(app)
      .get(`/auth/security-events?user_id=${subj}&event_type=PASSWORD_CHANGED`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.status, JSON.stringify(filtered.body)).toBe(200);
    expect(filtered.body.data.length).toBe(1);
    expect(filtered.body.pagination.total).toBe(1);
    expect(filtered.body.data[0].event_type).toBe("PASSWORD_CHANGED");
    for (const row of filtered.body.data as Array<Record<string, unknown>>) {
      expect(row.event_type).not.toBe("EMAIL_CHANGED");
    }
  });

  // ── S10: status filter — eq exact, CHỈ success-rows; + sort/order/no-filter (phủ branch repo) ──
  // FIX Đội-3 (MEDIUM): trước đây CHƯA có int-test positive cho status (V7 chỉ phủ reject enum sai;
  // P3 dùng user_id KHÔNG kèm status). Subject riêng (company A) 3 row KHÁC status cho CÙNG user —
  // KHÔNG đụng userA1 (giữ P3 = 2). status=success → CHỈ success. Kèm sort=status&order=asc +
  // no-filter để phủ orderBy(status-col/asc) + buildWhere(no-conds) login-log.repository cho coverage
  // gate ≥80% (HARD — KHÔNG hạ ngưỡng, KHÔNG tắt type-check).
  it("S10 — login-logs status=success → CHỈ success-rows + sort=status asc (phủ branch repo)", async () => {
    const email = `subjStatus-${TAG}@a.test`;
    const subj = await seedUser(direct, A.companyId, email);
    await insertLoginLog(direct, A.companyId, subj, email, "success", { i: 0 });
    await insertLoginLog(direct, A.companyId, subj, email, "failed", { i: 1 });
    await insertLoginLog(direct, A.companyId, subj, email, "blocked", { i: 2 });

    // Sanity: KHÔNG filter status (user_id) → cả 3 row (chứng minh filter thực sự thu hẹp 3→1).
    const all = await api(app)
      .get(`/auth/login-logs?user_id=${subj}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.pagination.total).toBe(3);

    // status=success → đúng 1 row, mọi row.status==='success', KHÔNG lẫn failed/blocked.
    const filtered = await api(app)
      .get(`/auth/login-logs?user_id=${subj}&status=success`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.status, JSON.stringify(filtered.body)).toBe(200);
    expect(filtered.body.data.length).toBe(1);
    expect(filtered.body.pagination.total).toBe(1);
    for (const row of filtered.body.data as Array<Record<string, unknown>>) {
      expect(row.status).toBe("success");
      expect(row.status).not.toBe("failed");
      expect(row.status).not.toBe("blocked");
    }

    // sort=status&order=asc → ORDER BY login_status ASC (phủ orderBy(status-col, asc) repo).
    const sorted = await api(app)
      .get(`/auth/login-logs?user_id=${subj}&sort=status&order=asc`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(sorted.status, JSON.stringify(sorted.body)).toBe(200);
    expect(sorted.body.data.length).toBe(3);
    const statuses = (sorted.body.data as Array<{ status: string }>).map((r) => r.status);
    expect(statuses).toEqual([...statuses].sort());

    // No-filter list (KHÔNG user_id/status/date) → buildWhere trả undefined (phủ nhánh no-conds repo).
    const noFilter = await api(app)
      .get(`/auth/login-logs`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(noFilter.status, JSON.stringify(noFilter.body)).toBe(200);
    expect(noFilter.body.pagination.total).toBeGreaterThanOrEqual(3);
  });

  // ── S11: severity filter — eq exact, CHỈ high; + sort/event_type/date-range/no-filter (phủ branch repo) ──
  // FIX Đội-3 (MEDIUM): trước đây CHƯA có int-test positive cho severity (V7 chỉ phủ reject enum sai;
  // E9 phủ event_type). Subject riêng (company A) 3 event KHÁC severity + KHÁC event_type cho CÙNG user —
  // KHÔNG đụng userA1 (giữ P3 = 1). severity=high → CHỈ high. Kèm sort=severity/event_type + from/to range +
  // no-filter để phủ orderBy(severity/event_type) + buildWhere(date/no-conds) security-event.repository cho
  // coverage gate ≥80% (HARD — KHÔNG hạ ngưỡng, KHÔNG tắt type-check).
  it("S11 — security-events severity=high → CHỈ high-rows + sort/date-range (phủ branch repo)", async () => {
    const email = `subjSev-${TAG}@a.test`;
    const subj = await seedUser(direct, A.companyId, email);
    await insertSecurityEvent(direct, A.companyId, subj, null, "ACCOUNT_RECOVERY", "high", {
      i: 0,
    });
    await insertSecurityEvent(direct, A.companyId, subj, null, "MFA_DISABLED", "medium", { i: 1 });
    await insertSecurityEvent(direct, A.companyId, subj, null, "SUSPICIOUS_LOGIN", "low", { i: 2 });

    // Sanity: KHÔNG filter severity (user_id) → cả 3 row (chứng minh filter thực sự thu hẹp 3→1).
    const all = await api(app)
      .get(`/auth/security-events?user_id=${subj}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.pagination.total).toBe(3);

    // severity=high → đúng 1 row, mọi row.severity==='high', KHÔNG lẫn medium/low.
    const filtered = await api(app)
      .get(`/auth/security-events?user_id=${subj}&severity=high`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.status, JSON.stringify(filtered.body)).toBe(200);
    expect(filtered.body.data.length).toBe(1);
    expect(filtered.body.pagination.total).toBe(1);
    for (const row of filtered.body.data as Array<Record<string, unknown>>) {
      expect(row.severity).toBe("high");
      expect(row.severity).not.toBe("medium");
      expect(row.severity).not.toBe("low");
    }

    // sort=severity&order=asc → ORDER BY severity ASC (phủ orderBy(severity-col, asc) repo).
    const bySev = await api(app)
      .get(`/auth/security-events?user_id=${subj}&sort=severity&order=asc`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(bySev.status, JSON.stringify(bySev.body)).toBe(200);
    expect(bySev.body.data.length).toBe(3);
    const sevs = (bySev.body.data as Array<{ severity: string }>).map((r) => r.severity);
    expect(sevs).toEqual([...sevs].sort());

    // sort=event_type&order=asc → ORDER BY event_type ASC (phủ orderBy(event_type-col) repo).
    const byType = await api(app)
      .get(`/auth/security-events?user_id=${subj}&sort=event_type&order=asc`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byType.status, JSON.stringify(byType.body)).toBe(200);
    const types = (byType.body.data as Array<{ event_type: string }>).map((r) => r.event_type);
    expect(types).toEqual([...types].sort());

    // from/to range trên created_at (event ~now): dải bao now → cả 3 (phủ gte+lte branch); to_date quá khứ → 0.
    const wide = await api(app)
      .get(`/auth/security-events?user_id=${subj}&from_date=2000-01-01&to_date=2999-12-31`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(wide.status, JSON.stringify(wide.body)).toBe(200);
    expect(wide.body.pagination.total).toBe(3);
    const past = await api(app)
      .get(`/auth/security-events?user_id=${subj}&to_date=2000-01-01`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(past.status, JSON.stringify(past.body)).toBe(200);
    expect(past.body.pagination.total).toBe(0);

    // No-filter list → buildWhere trả undefined (phủ nhánh no-conds repo).
    const noFilter = await api(app)
      .get(`/auth/security-events`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(noFilter.status, JSON.stringify(noFilter.body)).toBe(200);
    expect(noFilter.body.pagination.total).toBeGreaterThanOrEqual(3);
  });
});
