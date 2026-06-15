/**
 * G13CTL — HTTP deny-path: CostAllocationController (supertest + Nest app thật).
 *
 * Route tested:
 *   POST /finance/cost/:id/allocate — allocate
 *
 * Cases:
 *  §deny  — user KHÔNG có create:finance → 403 + 0 row cost_allocations ghi.
 *  §allow — financeUserA (role …000a) → 201 envelope {success:true,data:{allocationRunId,allocations,warnings}}.
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

async function seedCost(direct: Pool, companyId: string, userId: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO cost_records
       (company_id, cost_type, amount, currency, cost_date, entered_by, entry_kind)
     VALUES ($1, 'production', 1000.00, 'VND', current_date, $2, 'original') RETURNING id`,
    [companyId, userId],
  );
  return r.rows[0].id as string;
}

async function seedChannel(direct: Pool, companyId: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO channels (company_id, name, platform, platform_id)
     VALUES ($1, $2, 'youtube', (SELECT id FROM platforms WHERE code = 'youtube')) RETURNING id`,
    [companyId, `ch-${randomUUID().slice(0, 8)}`],
  );
  return r.rows[0].id as string;
}

async function countActiveAlloc(direct: Pool, costId: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM cost_allocations WHERE cost_record_id = $1 AND deleted_at IS NULL`,
    [costId],
  );
  return r.rows[0].n as number;
}

describe.skipIf(!hasDb)("G13CTL cost-allocation controller HTTP deny-path", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let noPermToken: string;
  let financeToken: string;
  let financeUserId: string;
  let channelA: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "allocCtl");
    companyIds.push(A.companyId);

    const pw = await hashedPw();

    const noPermId = await seedUser(direct, A.companyId, `alc-noperm-${randomUUID().slice(0,8)}@a.test`, pw);
    const emptyRole = await seedRole(direct, A.companyId, `alc-empty-${randomUUID().slice(0,8)}`);
    await seedUserRole(direct, noPermId, emptyRole, A.companyId);
    const noPermEmail = await emailOf(direct, noPermId);

    financeUserId = await seedUser(direct, A.companyId, `alc-mgr-${randomUUID().slice(0,8)}@a.test`, pw);
    await seedUserRole(direct, financeUserId, FINANCE_MANAGER_ROLE_ID, A.companyId);
    const financeEmail = await emailOf(direct, financeUserId);

    channelA = await seedChannel(direct, A.companyId);

    noPermToken = await login(app, A.slug, noPermEmail);
    financeToken = await login(app, A.slug, financeEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // ── §deny — user không quyền → 403, 0 row cost_allocations ──────────────────

  describe("§deny — thiếu create:finance → 403 + 0 cost_allocations", () => {
    it("POST /finance/cost/:id/allocate → 403 + envelope {success:false} + 0 allocation row", async () => {
      const costId = await seedCost(direct, A.companyId, financeUserId);
      const res = await api(app)
        .post(`/finance/cost/${costId}/allocate`)
        .set("Authorization", `Bearer ${noPermToken}`)
        .send({
          method: "equal_split",
          targets: [{ targetType: "channel", targetId: channelA }],
        });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("object");
      expect(await countActiveAlloc(direct, costId)).toBe(0);
    });
  });

  // ── §allow — financeUserA → 201 envelope {allocationRunId, allocations, warnings} ─

  describe("§allow — finance-manager → 201 + envelope {success:true,data}", () => {
    it("POST /finance/cost/:id/allocate → 201 + {allocationRunId,allocations,warnings}", async () => {
      const costId = await seedCost(direct, A.companyId, financeUserId);
      const res = await api(app)
        .post(`/finance/cost/${costId}/allocate`)
        .set("Authorization", `Bearer ${financeToken}`)
        .send({
          method: "equal_split",
          targets: [{ targetType: "channel", targetId: channelA }],
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.allocationRunId).toBe("string");
      expect(Array.isArray(res.body.data.allocations)).toBe(true);
      expect(res.body.data.allocations.length).toBeGreaterThan(0);
      expect(Array.isArray(res.body.data.warnings)).toBe(true);
      expect(await countActiveAlloc(direct, costId)).toBe(1);
    });
  });
});
