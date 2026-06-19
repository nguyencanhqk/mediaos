/**
 * AI-1 CTL — HTTP deny-path: AiController (supertest + Nest app thật, PermissionGuard wired).
 *
 * Route tested:
 *   GET /ai/insight — read-only insight (read:kpi).
 *
 * Cases:
 *  §deny  — user KHÔNG có read:kpi → 403 envelope {success:false}.
 *  §allow — user CÓ read:kpi → 200 envelope {success:true,data} (Claude = MOCK override, KHÔNG API thật).
 *
 * AiClient bị OVERRIDE bằng mock (useValue) → KHÔNG gọi Claude thật / KHÔNG cần ANTHROPIC_API_KEY.
 * companyId/userId từ req.user (JWT), KHÔNG tin client.
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
import { AiClient, type AiSummarizeResult } from "../../src/ai/ai-client";
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

const PASSWORD = "Passw0rd!test99";

/** Mock AiClient — KHÔNG gọi Claude thật (deterministic, 0 token, không cần key). */
const mockAiClient = {
  resolveModel: () => "claude-opus-4-8" as const,
  summarize: async (): Promise<AiSummarizeResult> => ({
    summary: "tóm tắt giả lập (mock)",
    model: "claude-opus-4-8",
  }),
};

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

async function emailOf(direct: Pool, userId: string): Promise<string> {
  const r = await direct.query(`SELECT email FROM users WHERE id = $1`, [userId]);
  return r.rows[0].email as string;
}

describe.skipIf(!hasDb)("AI-1 CTL ai-insight controller HTTP deny-path", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let noPermToken: string;
  let kpiToken: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient)
      .useValue(mockAiClient)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "aiCtl");
    companyIds.push(A.companyId);

    const pw = await hashedPw();
    const readKpiPerm = await seedPermissionCatalog(direct, "read", "kpi", false);

    // noPerm user — role rỗng.
    const noPermId = await seedUser(
      direct,
      A.companyId,
      `aictl-noperm-${randomUUID().slice(0, 8)}@a.test`,
      pw,
    );
    const emptyRole = await seedRole(
      direct,
      A.companyId,
      `aictl-empty-${randomUUID().slice(0, 8)}`,
    );
    await seedUserRole(direct, noPermId, emptyRole, A.companyId);

    // kpi user — read:kpi.
    const kpiId = await seedUser(
      direct,
      A.companyId,
      `aictl-kpi-${randomUUID().slice(0, 8)}@a.test`,
      pw,
    );
    const kpiRole = await seedRole(
      direct,
      A.companyId,
      `aictl-kpirole-${randomUUID().slice(0, 8)}`,
    );
    await seedRolePermission(direct, kpiRole, readKpiPerm, "ALLOW");
    await seedUserRole(direct, kpiId, kpiRole, A.companyId);

    noPermToken = await login(app, A.slug, await emailOf(direct, noPermId));
    kpiToken = await login(app, A.slug, await emailOf(direct, kpiId));
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
  });

  describe("§deny — thiếu read:kpi → 403", () => {
    it("GET /ai/insight → 403 + envelope {success:false}", async () => {
      const res = await api(app).get("/ai/insight").set("Authorization", `Bearer ${noPermToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("object");
    });
  });

  describe("§allow — read:kpi → 200 (mock Claude)", () => {
    it("GET /ai/insight → 200 + envelope {success:true,data.summary}", async () => {
      const res = await api(app).get("/ai/insight").set("Authorization", `Bearer ${kpiToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.summary).toBe("string");
      expect(res.body.data.model).toBe("claude-opus-4-8");
      // financeMasked = true vì user chỉ có read:kpi (KHÔNG view-finance).
      expect(res.body.data.financeMasked).toBe(true);
    });
  });
});
