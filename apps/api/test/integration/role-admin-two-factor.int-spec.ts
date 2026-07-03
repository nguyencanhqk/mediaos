/**
 * S2-AUTH-BE-11 — HTTP int-spec: cờ `requiresTwoFactor` trên role write API (POST/PATCH /auth/roles).
 *
 *  §create  — company-admin POST kèm requiresTwoFactor:true → roles.requires_two_factor=true (DB thật)
 *             + audit_logs 'RoleCreated' after.requiresTwoFactor=true (CÙNG tx với mutation).
 *  §default — POST KHÔNG gửi cờ → false (optional additive, client cũ không breaking).
 *  §update  — PATCH toggle cờ → DB flip + audit 'RoleUpdated' diff before/after chứa cờ.
 *  §deny    — PATCH cờ lên SYSTEM role → 400 REJECT trước update/audit; DB giữ nguyên, KHÔNG audit rác.
 *
 * Gate: hasDb && LANE_DB (DB cô lập theo lane) — thiếu LANE_DB → SKIP để KHÔNG chạm DB dev chung 'mediaos'
 * (.env làm hasDb=true → đỏ-giả/xanh-giả) — CLAUDE.md §9.5, memory integration-test-lane-db-gate.
 * Mirror wiring: auth-roles-permissions.int-spec.ts (Nest app thật + supertest + seed helpers).
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
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001"; // system role (mig 0120: requires_two_factor=true)
const PASSWORD = ["Passw0rd", "R2fa", "77"].join("");

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function emailOf(direct: Pool, userId: string): Promise<string> {
  const r = await direct.query(`SELECT email FROM users WHERE id = $1`, [userId]);
  return r.rows[0].email as string;
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.accessToken as string;
}

async function roleFlagInDb(direct: Pool, roleId: string): Promise<boolean> {
  const r = await direct.query(`SELECT requires_two_factor FROM roles WHERE id = $1`, [roleId]);
  expect(r.rows.length).toBe(1);
  return r.rows[0].requires_two_factor as boolean;
}

/** Audit rows cho 1 role, mới nhất trước. payload before/after là jsonb (đã mask). */
async function auditRowsFor(direct: Pool, roleId: string) {
  const r = await direct.query(
    `SELECT action, before, after FROM audit_logs
      WHERE object_type = 'role' AND object_id = $1
      ORDER BY created_at DESC`,
    [roleId],
  );
  return r.rows as Array<{ action: string; before: unknown; after: unknown }>;
}

// Gate hasDb && LANE_DB: thiếu DB lane cô lập → SKIP (KHÔNG chạm 'mediaos' dev chung). CLAUDE.md §9.5.
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)(
  "S2-AUTH-BE-11 role write requiresTwoFactor (POST/PATCH /auth/roles)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let adminToken: string;
    const companyIds: string[] = [];

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();

      A = await seedCompany(direct, "r2fa");
      companyIds.push(A.companyId);
      const adminId = await seedUser(
        direct,
        A.companyId,
        `r2fa-admin-${randomUUID().slice(0, 8)}@a.test`,
        await hashedPw(),
      );
      await seedUserRole(direct, adminId, COMPANY_ADMIN_ROLE_ID, A.companyId);
      // company-admin bị mig 0120 ép 2FA — enroll không cần cho login (mustSetupTwoFactor chỉ là cờ me();
      // TwoFactorEnforcementGuard chặn tài nguyên bảo vệ khác, KHÔNG chặn /auth/roles? — nếu guard chặn,
      // login+call vẫn là bằng chứng đúng: spec này chỉ cần token hợp lệ đi qua PermissionGuard.
      adminToken = await login(app, A.slug, await emailOf(direct, adminId));
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
      await app.close();
    });

    it("§create — POST kèm requiresTwoFactor:true → DB true + audit RoleCreated after chứa cờ (cùng tx)", async () => {
      const name = `r2fa-on-${randomUUID().slice(0, 8)}`;
      const res = await api(app)
        .post("/auth/roles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name, requiresTwoFactor: true });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const roleId = res.body.data.id as string;
      expect(res.body.data.requiresTwoFactor).toBe(true);

      expect(await roleFlagInDb(direct, roleId)).toBe(true);

      const audits = await auditRowsFor(direct, roleId);
      expect(audits.length).toBeGreaterThanOrEqual(1);
      const created = audits.find((a) => a.action === "RoleCreated");
      expect(created).toBeDefined();
      expect((created!.after as Record<string, unknown>).requiresTwoFactor).toBe(true);
    });

    it("§default — POST KHÔNG gửi cờ → requires_two_factor=false (client cũ non-breaking)", async () => {
      const name = `r2fa-def-${randomUUID().slice(0, 8)}`;
      const res = await api(app)
        .post("/auth/roles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const roleId = res.body.data.id as string;
      expect(res.body.data.requiresTwoFactor).toBe(false);
      expect(await roleFlagInDb(direct, roleId)).toBe(false);
    });

    it("§update — PATCH toggle false→true → DB flip + audit RoleUpdated diff before/after chứa cờ", async () => {
      const name = `r2fa-upd-${randomUUID().slice(0, 8)}`;
      const createRes = await api(app)
        .post("/auth/roles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name });
      expect(createRes.status).toBe(201);
      const roleId = createRes.body.data.id as string;

      const res = await api(app)
        .patch(`/auth/roles/${roleId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ requiresTwoFactor: true });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.requiresTwoFactor).toBe(true);
      expect(await roleFlagInDb(direct, roleId)).toBe(true);

      const updated = (await auditRowsFor(direct, roleId)).find((a) => a.action === "RoleUpdated");
      expect(updated).toBeDefined();
      expect((updated!.before as Record<string, unknown>).requiresTwoFactor).toBe(false);
      expect((updated!.after as Record<string, unknown>).requiresTwoFactor).toBe(true);
    });

    it("§deny — PATCH cờ lên SYSTEM role → 400 REJECT trước update/audit; DB giữ nguyên, không audit rác", async () => {
      const before = await roleFlagInDb(direct, COMPANY_ADMIN_ROLE_ID); // mig 0120 seed = true
      const auditCountBefore = (await auditRowsFor(direct, COMPANY_ADMIN_ROLE_ID)).length;

      const res = await api(app)
        .patch(`/auth/roles/${COMPANY_ADMIN_ROLE_ID}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ requiresTwoFactor: false });
      expect(res.status, JSON.stringify(res.body)).toBe(400);

      expect(await roleFlagInDb(direct, COMPANY_ADMIN_ROLE_ID)).toBe(before);
      expect((await auditRowsFor(direct, COMPANY_ADMIN_ROLE_ID)).length).toBe(auditCountBefore);
    });
  },
);
