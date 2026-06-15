/**
 * G13CTL — HTTP deny-path: RevenueController (supertest + Nest app thật, PermissionGuard wired).
 *
 * Routes tested:
 *   POST /finance/revenue          — create
 *   POST /finance/revenue/:id/adjust — adjust
 *   POST /finance/revenue/:id/void   — void
 *   GET  /finance/revenue            — list
 *
 * Cases:
 *  §deny  — user KHÔNG có create:finance → 403 envelope {success:false,error.code} + 0 side-effect.
 *  §allow — financeUserA (role …000a có create:finance) → 201/200 envelope {success:true,data}.
 *  §409   — double-adjust cùng original qua HTTP → lần 2 trả 409 ConflictException (KHÔNG 500).
 *  §400   — adjust/void trên bản void → 400.
 *  §rls   — GET list với login A không thấy row của B → 200 mảng rỗng (RLS).
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
import { PasswordService } from "../../src/auth/password.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedRole,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const FINANCE_MANAGER_ROLE_ID = "00000000-0000-0000-0000-00000000000a";
const PASSWORD = "Passw0rd!test99";

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app).post("/auth/login").send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

async function emailOf(direct: Pool, userId: string): Promise<string> {
  const r = await direct.query(`SELECT email FROM users WHERE id = $1`, [userId]);
  return r.rows[0].email as string;
}

/** Seed 1 revenue gốc qua DIRECT (bypass RLS). */
async function seedRevenue(direct: Pool, companyId: string, userId: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO revenue_records
       (company_id, amount, currency, revenue_date, source, entered_by, entry_kind)
     VALUES ($1, 1000.00, 'VND', current_date, 'manual', $2, 'original') RETURNING id`,
    [companyId, userId],
  );
  return r.rows[0].id as string;
}

async function countRevenue(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM revenue_records WHERE company_id = $1`,
    [companyId],
  );
  return r.rows[0].n as number;
}

describe.skipIf(!hasDb)("G13CTL revenue controller HTTP deny-path", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let noPermEmail: string;
  let financeEmail: string;
  let financeUserId: string;
  let noPermToken: string;
  let financeToken: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "rvcA");
    B = await seedCompany(direct, "rvcB");
    companyIds.push(A.companyId, B.companyId);

    const pw = await hashedPw();

    // noPermUser: role rỗng → không có create:finance
    const noPermId = await seedUser(direct, A.companyId, `rvc-noperm-${randomUUID().slice(0,8)}@a.test`, pw);
    const emptyRole = await seedRole(direct, A.companyId, `rvc-empty-${randomUUID().slice(0,8)}`);
    await seedUserRole(direct, noPermId, emptyRole, A.companyId);
    noPermEmail = await emailOf(direct, noPermId);

    // financeUserA: gắn role finance-manager (…000a) → có create:finance
    financeUserId = await seedUser(direct, A.companyId, `rvc-mgr-${randomUUID().slice(0,8)}@a.test`, pw);
    await seedUserRole(direct, financeUserId, FINANCE_MANAGER_ROLE_ID, A.companyId);
    financeEmail = await emailOf(direct, financeUserId);

    noPermToken = await login(app, A.slug, noPermEmail);
    financeToken = await login(app, A.slug, financeEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
  });

  const validBody = () => ({
    amount: 500,
    currency: "VND",
    revenueDate: "2026-06-15",
    source: "manual",
  });

  // ── §deny — user không quyền → 403 envelope, 0 side-effect ──────────────────

  describe("§deny — thiếu create:finance → 403", () => {
    it("POST /finance/revenue → 403 + envelope {success:false} + 0 row ghi", async () => {
      const before = await countRevenue(direct, A.companyId);
      const res = await api(app)
        .post("/finance/revenue")
        .set("Authorization", `Bearer ${noPermToken}`)
        .send(validBody());
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("object");
      expect(await countRevenue(direct, A.companyId)).toBe(before);
    });

    it("POST /finance/revenue/:id/adjust → 403 + 0 side-effect", async () => {
      const revId = await seedRevenue(direct, A.companyId, financeUserId);
      const before = await countRevenue(direct, A.companyId);
      const res = await api(app)
        .post(`/finance/revenue/${revId}/adjust`)
        .set("Authorization", `Bearer ${noPermToken}`)
        .send(validBody());
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(await countRevenue(direct, A.companyId)).toBe(before);
    });

    it("POST /finance/revenue/:id/void → 403 + 0 side-effect", async () => {
      const revId = await seedRevenue(direct, A.companyId, financeUserId);
      const before = await countRevenue(direct, A.companyId);
      const res = await api(app)
        .post(`/finance/revenue/${revId}/void`)
        .set("Authorization", `Bearer ${noPermToken}`)
        .send({ reason: "test void deny" });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(await countRevenue(direct, A.companyId)).toBe(before);
    });

    it("GET /finance/revenue → 403", async () => {
      const res = await api(app)
        .get("/finance/revenue")
        .set("Authorization", `Bearer ${noPermToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  // ── §allow — financeUserA có quyền → 201/200 envelope {success:true,data} ───

  describe("§allow — finance-manager → 201/200 + envelope {success:true}", () => {
    it("POST /finance/revenue → 201 envelope {success:true,data.id}", async () => {
      const res = await api(app)
        .post("/finance/revenue")
        .set("Authorization", `Bearer ${financeToken}`)
        .send(validBody());
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.id).toBe("string");
    });

    it("GET /finance/revenue → 200 envelope {success:true,data:[...]}", async () => {
      await seedRevenue(direct, A.companyId, financeUserId);
      const res = await api(app)
        .get("/finance/revenue")
        .set("Authorization", `Bearer ${financeToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ── §409 — double-adjust cùng original → 409 (KHÔNG 500) ────────────────────

  describe("§409 — double-adjust → ConflictException (409)", () => {
    it("2 lần POST /finance/revenue/:id/adjust cùng original → lần 2 trả 409", async () => {
      const original = await seedRevenue(direct, A.companyId, financeUserId);
      const body1 = { ...validBody(), amount: 600 };
      const res1 = await api(app)
        .post(`/finance/revenue/${original}/adjust`)
        .set("Authorization", `Bearer ${financeToken}`)
        .send(body1);
      expect(res1.status).toBe(201);

      const res2 = await api(app)
        .post(`/finance/revenue/${original}/adjust`)
        .set("Authorization", `Bearer ${financeToken}`)
        .send({ ...validBody(), amount: 700 });
      expect(res2.status).toBe(409);
      expect(res2.body.success).toBe(false);
    });
  });

  // ── §400 — adjust/void trên bản void → 400 ───────────────────────────────────

  describe("§400 — adjust/void trên bản void → 400", () => {
    it("adjust trên bản đã void → 400", async () => {
      const original = await seedRevenue(direct, A.companyId, financeUserId);
      const voidRes = await api(app)
        .post(`/finance/revenue/${original}/void`)
        .set("Authorization", `Bearer ${financeToken}`)
        .send({ reason: "void để test" });
      expect(voidRes.status).toBe(201);
      const voidedId = voidRes.body.data.id as string;

      const res = await api(app)
        .post(`/finance/revenue/${voidedId}/adjust`)
        .set("Authorization", `Bearer ${financeToken}`)
        .send(validBody());
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("void trên bản đã void → 400", async () => {
      const original = await seedRevenue(direct, A.companyId, financeUserId);
      const voidRes = await api(app)
        .post(`/finance/revenue/${original}/void`)
        .set("Authorization", `Bearer ${financeToken}`)
        .send({ reason: "void lần 1" });
      expect(voidRes.status).toBe(201);
      const voidedId = voidRes.body.data.id as string;

      const res = await api(app)
        .post(`/finance/revenue/${voidedId}/void`)
        .set("Authorization", `Bearer ${financeToken}`)
        .send({ reason: "void lần 2 phải fail" });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ── §rls — GET list: login A không thấy row của B (RLS) ──────────────────────

  describe("§rls — GET list RLS: login A không thấy row của B", () => {
    it("revenue của tenant B không xuất hiện trong list của A", async () => {
      // Seed user B + financeManager role cho B, lấy token
      const finBId = await seedUser(direct, B.companyId, `rvc-mgrB-${randomUUID().slice(0,8)}@b.test`);
      await seedUserRole(direct, finBId, FINANCE_MANAGER_ROLE_ID, B.companyId);
      const revBId = await seedRevenue(direct, B.companyId, finBId);

      const res = await api(app)
        .get("/finance/revenue")
        .set("Authorization", `Bearer ${financeToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).not.toContain(revBId);
    });
  });
});
