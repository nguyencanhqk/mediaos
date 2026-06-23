/**
 * S1-FND-AUDIT-1 (L3) — Audit viewer LIST/DETAIL filter + scope + pagination (integration, DB cô lập).
 *
 * Phủ done_when / testTasks còn thiếu của FOUNDATION-BE-3 / S1-FND-AUDIT-1 (read-side §8.5):
 *   F1  filter module/action/actor/entity/dateFrom-dateTo trả ĐÚNG tập (eq + between).
 *   F2  filter §8.5 bổ sung: actionGroup / permissionCode / dataScope.
 *   F3  Company scope (withTenant + RLS): admin tenant A CHỈ thấy audit của A, KHÔNG thấy B.
 *   F4  System scope (operator /all): thấy CHÉO tenant; ?companyId=A khoanh đúng 1 tenant.
 *   F5  pagination: meta total/limit/offset chính xác; limit kẹp ≤ MAX_AUDIT_PAGE_LIMIT (100).
 *   F6  detail /{id}: Company scope id của tenant khác → 404 (RLS ép); System /all/{id} thấy chéo.
 *
 * Dùng Postgres THẬT (DB cô lập mediaos_<lane>, CLAUDE §9.5). Auto-skip khi DATABASE_URL chưa set
 * (hasDb=false) — KHÔNG false-green. Direct pool (superuser, bypass RLS) seed audit rows trực tiếp;
 * HTTP đi qua app thật (guard + service + RLS pipeline sống).
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
import {
  cleanupTenants,
  seedCompany,
  seedRole,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const PASSWORD = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001";
const PLATFORM_ADMIN_ROLE = "00000000-0000-0000-0000-0000000000f0";

/** Marker chung để tách dữ liệu của suite này khỏi audit khác trên DB chung (filter theo action prefix). */
const TAG = `FILT-${randomUUID().slice(0, 8)}`;

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.accessToken as string;
}

interface AuditSeed {
  action: string;
  objectType?: string;
  objectId?: string;
  actorUserId?: string;
  moduleCode?: string;
  entityType?: string;
  entityId?: string;
  actorType?: string;
  actionGroup?: string;
  permissionCode?: string;
  dataScope?: string;
  createdAt?: string;
}

/** Chèn 1 hàng audit RAW (direct pool, bypass RLS/masker) với cột §8.5 tường minh để test filter. */
async function insertAudit(direct: Pool, companyId: string, s: AuditSeed): Promise<string> {
  const r = await direct.query(
    `INSERT INTO audit_logs
       (company_id, action, object_type, object_id, actor_user_id,
        module_code, entity_type, entity_id, actor_type, action_group, permission_code, data_scope,
        created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        COALESCE($13::timestamptz, now()))
     RETURNING id`,
    [
      companyId,
      s.action,
      s.objectType ?? "user",
      s.objectId ?? null,
      s.actorUserId ?? null,
      s.moduleCode ?? null,
      s.entityType ?? null,
      s.entityId ?? null,
      s.actorType ?? null,
      s.actionGroup ?? null,
      s.permissionCode ?? null,
      s.dataScope ?? null,
      s.createdAt ?? null,
    ],
  );
  return r.rows[0].id as string;
}

type Row = Record<string, unknown>;

function rowsOf(body: { data: { data: Row[] } }): Row[] {
  return body.data.data;
}

describe.skipIf(!hasDb)("S1-FND-AUDIT-1 audit list filter + scope + pagination", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let adminToken: string;
  let operatorToken: string;
  let actorA: string;
  let objA: string;
  let entA: string;
  let idHrA: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "fla");
    B = await seedCompany(direct, "flb");
    companyIds.push(A.companyId, B.companyId);
    const pw = await new PasswordService().hash(PASSWORD);

    // Company-admin A (view:audit-log) + operator (view:platform-audit cross-tenant).
    const adminEmail = `adm-${randomUUID().slice(0, 8)}@a.test`;
    const admin = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);
    actorA = admin;

    const opEmail = `op-${randomUUID().slice(0, 8)}@a.test`;
    const op = await seedUser(direct, A.companyId, opEmail, pw);
    await seedUserRole(direct, op, PLATFORM_ADMIN_ROLE, A.companyId);

    // A worker role so seedUser/seedUserRole order is exercised (no-op grant otherwise).
    await seedRole(direct, A.companyId, `r-${randomUUID().slice(0, 8)}`);

    objA = randomUUID();
    entA = randomUUID();

    // ── Tenant A audit rows (varied §8.5 attributes) ──
    // HR module, action group 'data', dataScope Company, with actor/object/entity → multi-filter target.
    idHrA = await insertAudit(direct, A.companyId, {
      action: `${TAG}-hr-view`,
      objectType: "employee",
      objectId: objA,
      actorUserId: actorA,
      moduleCode: "HR",
      entityType: "employee",
      entityId: entA,
      actorType: "User",
      actionGroup: "data",
      permissionCode: "HR.EMPLOYEE.VIEW",
      dataScope: "Company",
      createdAt: "2026-03-10T08:00:00.000Z",
    });
    // AUTH module, action group 'auth', dataScope Own, different actor (none) → excluded by HR/data filters.
    await insertAudit(direct, A.companyId, {
      action: `${TAG}-auth-login`,
      objectType: "auth",
      moduleCode: "AUTH",
      actorType: "User",
      actionGroup: "auth",
      permissionCode: "AUTH.SESSION.LOGIN",
      dataScope: "Own",
      createdAt: "2026-03-12T08:00:00.000Z",
    });
    // Out-of-window row (date filter boundary).
    await insertAudit(direct, A.companyId, {
      action: `${TAG}-hr-old`,
      moduleCode: "HR",
      actionGroup: "data",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    // ── Tenant B audit rows (cross-tenant isolation target) ──
    await insertAudit(direct, B.companyId, {
      action: `${TAG}-hr-view`,
      moduleCode: "HR",
      actionGroup: "data",
      dataScope: "Company",
      createdAt: "2026-03-11T08:00:00.000Z",
    });

    adminToken = await login(app, A.slug, adminEmail);
    operatorToken = await login(app, A.slug, opEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── F1: core filters (Company scope) ───────────────────────────────────────────
  it("F1 — filter action trả đúng 1 hàng của tenant hiện tại", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs?action=${TAG}-hr-view`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = rowsOf(res.body);
    expect(rows.length).toBe(1); // KHÔNG thấy hàng cùng action của tenant B (RLS ép).
    expect(rows[0]["action"]).toBe(`${TAG}-hr-view`);
  });

  it("F1 — filter moduleCode=HR trả đúng tập HR của A (loại AUTH)", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs?moduleCode=HR`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = rowsOf(res.body);
    expect(rows.every((r) => r["moduleCode"] === "HR")).toBe(true);
    expect(rows.some((r) => r["action"] === `${TAG}-auth-login`)).toBe(false);
  });

  it("F1 — filter actorUserId trả hàng của đúng actor", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs?actorUserId=${actorA}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = rowsOf(res.body);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r["actorUserId"] === actorA)).toBe(true);
  });

  it("F1 — filter entityType+entityId trả hàng HR có entity khớp", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs?entityType=employee&entityId=${entA}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = rowsOf(res.body);
    expect(rows.length).toBe(1);
    expect(rows[0]["id"]).toBe(idHrA);
  });

  it("F1 — filter objectType+objectId khớp 1 hàng", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs?objectType=employee&objectId=${objA}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = rowsOf(res.body);
    expect(rows.length).toBe(1);
    expect(rows[0]["id"]).toBe(idHrA);
  });

  it("F1 — filter dateFrom..dateTo khoanh đúng cửa sổ thời gian (loại hàng 2026-01)", async () => {
    const res = await api(app)
      .get(
        `/foundation/audit-logs?moduleCode=HR&dateFrom=2026-03-01T00:00:00.000Z&dateTo=2026-03-31T23:59:59.000Z`,
      )
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = rowsOf(res.body);
    // Chỉ hàng HR trong tháng 3 (idHrA) — hàng 'hr-old' (2026-01) bị loại.
    expect(rows.some((r) => r["action"] === `${TAG}-hr-old`)).toBe(false);
    expect(rows.some((r) => r["id"] === idHrA)).toBe(true);
  });

  // ── F2: §8.5 bổ sung filters ────────────────────────────────────────────────────
  it("F2 — filter actionGroup=auth trả hàng AUTH (loại data)", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs?actionGroup=auth`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = rowsOf(res.body);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r["actionGroup"] === "auth")).toBe(true);
  });

  it("F2 — filter permissionCode khớp eq", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs?permissionCode=HR.EMPLOYEE.VIEW`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = rowsOf(res.body);
    expect(rows.length).toBe(1);
    expect(rows[0]["id"]).toBe(idHrA);
  });

  it("F2 — filter dataScope=Own (enum hợp lệ) trả hàng AUTH", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs?dataScope=Own`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = rowsOf(res.body);
    expect(rows.every((r) => r["dataScope"] === "Own")).toBe(true);
    expect(rows.some((r) => r["action"] === `${TAG}-auth-login`)).toBe(true);
  });

  it("F2 — dataScope ngoài enum {Own,Team,Department,Company,System} → 400 (Zod fail-closed)", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs?dataScope=Galaxy`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  // ── F3: Company scope tenant isolation ───────────────────────────────────────────
  it("F3 — Company scope: admin A KHÔNG thấy audit của B (RLS ép)", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs?action=${TAG}-hr-view`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = rowsOf(res.body);
    expect(rows.every((r) => r["companyId"] === A.companyId)).toBe(true);
  });

  // ── F4: System scope cross-tenant + companyId narrowing ──────────────────────────
  it("F4 — System scope /all: operator thấy CHÉO tenant (cả A và B)", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs/all?action=${TAG}-hr-view`)
      .set("Authorization", `Bearer ${operatorToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = rowsOf(res.body);
    const companies = new Set(rows.map((r) => r["companyId"]));
    expect(companies.has(A.companyId)).toBe(true);
    expect(companies.has(B.companyId)).toBe(true);
  });

  it("F4 — System scope ?companyId=A khoanh đúng 1 tenant (KHÔNG còn hàng B)", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs/all?action=${TAG}-hr-view&companyId=${A.companyId}`)
      .set("Authorization", `Bearer ${operatorToken}`);
    expect(res.status).toBe(200);
    const rows = rowsOf(res.body);
    expect(rows.length).toBe(1);
    expect(rows[0]["companyId"]).toBe(A.companyId);
  });

  // ── F5: pagination meta + limit cap ──────────────────────────────────────────────
  it("F5 — meta total/limit/offset đúng; limit=1 phân trang được", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs?moduleCode=HR&limit=1&offset=0`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const meta = res.body.data.meta as { total: number; limit: number; offset: number };
    expect(meta.limit).toBe(1);
    expect(meta.offset).toBe(0);
    expect(meta.total).toBeGreaterThanOrEqual(2); // hr-view + hr-old của A
    expect(rowsOf(res.body).length).toBe(1); // 1 trang = 1 hàng
  });

  it("F5 — limit > MAX (101) → 400 (ROW CAP kẹp ≤ 100)", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs?limit=101`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  // ── F6: detail by id, scope-bound ────────────────────────────────────────────────
  it("F6 — Company detail /{id} của tenant hiện tại → 200; id tenant khác → 404", async () => {
    const ok = await api(app)
      .get(`/foundation/audit-logs/${idHrA}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.id).toBe(idHrA);

    // id ngẫu nhiên (không thuộc A) → 404 (RLS ép — không lộ tồn tại hàng tenant khác).
    const miss = await api(app)
      .get(`/foundation/audit-logs/${randomUUID()}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(miss.status).toBe(404);
  });

  it("F6 — System detail /all/{id} thấy chéo tenant (operator)", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs/all/${idHrA}`)
      .set("Authorization", `Bearer ${operatorToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.id).toBe(idHrA);
  });
});
