/**
 * S14-SEC-CAPWILDCARD-1 — `/auth/me` `capabilities` + `scopes` = phép chiếu quyết định `can()` ở tầng
 * CÔNG TY, trên Postgres THẬT (ADR `DECISIONS-13` §4; plan §9.2 #6, #10, #13, #14(b), #24, §15.9-F5).
 *
 *   #6   role employee (0008) giữ grant EXACT `view-own:adjustment` (sensitive, NGOÀI allowlist —
 *        mig 0454) ⇒ khoá CÓ trên `/auth/me.capabilities` (màn tự-phục-vụ của chính nhân viên).
 *   #10  keyset `/auth/me.scopes` === keyset `/auth/me.capabilities` (sau merge allowlist).
 *   #13/#24 + #14(b) catalog SỐNG: mọi hàng `permissions.action ILIKE 'reveal%'` (≥ 2 hàng) được grant
 *        EXACT cho một actor ⇒ không khoá nào trong số đó xuất hiện ở `capabilities` (SAU merge allowlist)
 *        lẫn `scopes`; cặp đối chứng `request-break-glass:break-glass` (sensitive, ngoài allowlist) CÓ.
 *
 * Seed cặp xong ⇒ `resetCatalogSnapshotForTest()` (plan §13.2: phải reset CẢ HAI ảnh chụp catalog —
 * ảnh cờ sensitive của `can()` và ảnh danh sách cặp của capabilities).
 *
 * Gate cứng `hasDb && LANE_DB` (CLAUDE §9.5). App dựng qua `applyMainPipeline` (ratchet pipeline-parity).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { PermissionService } from "../../src/permission/permission.service";
import { applyMainPipeline } from "../helpers/bootstrap-app";
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

const runDb = hasDb && Boolean(process.env.LANE_DB);
const TAG = randomUUID().slice(0, 8);
const LOGIN_PW = ["Passw0rd", "capwild", "99"].join("!");
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008";
const REQUEST_BREAK_GLASS = ["request-break-glass", "break-glass"] as const;

interface MeBody {
  capabilities: Record<string, boolean>;
  scopes: Record<string, string[]>;
}

describe.skipIf(!runDb)("S14-SEC-CAPWILDCARD-1 /auth/me capabilities = can() tầng công ty", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let employeeToken: string;
  let revealToken: string;
  let revealKeys: string[] = [];
  const companyIds: string[] = [];

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function me(token: string): Promise<MeBody> {
    const res = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as MeBody;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "capwild");
    companyIds.push(A.companyId);
    const pw = await new PasswordService().hash(LOGIN_PW);

    const empEmail = `emp-${TAG}@capwild.test`;
    const emp = await seedUser(direct, A.companyId, empEmail, pw);
    await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

    // #14(b): catalog SỐNG của lane — không chép danh sách tay.
    const live = await direct.query<{ id: string; action: string; resource_type: string }>(
      `SELECT id, action, resource_type FROM permissions WHERE action ILIKE 'reveal%'`,
    );
    revealKeys = live.rows.map((r) => `${r.action}:${r.resource_type}`);

    const revealEmail = `rvl-${TAG}@capwild.test`;
    const revealUser = await seedUser(direct, A.companyId, revealEmail, pw);
    const revealRole = await seedRole(direct, A.companyId, `capwild-rvl-${TAG}`);
    for (const row of live.rows) {
      await seedRolePermission(direct, revealRole, row.id, "ALLOW");
    }
    const requestPerm = await seedPermissionCatalog(direct, ...REQUEST_BREAK_GLASS, true);
    await seedRolePermission(direct, revealRole, requestPerm, "ALLOW");
    await seedUserRole(direct, revealUser, revealRole, A.companyId);

    app.get(PermissionService).resetCatalogSnapshotForTest();
    employeeToken = await login(empEmail);
    revealToken = await login(revealEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  it("#6 employee (0008) ⇒ capabilities['view-own:adjustment'] === true (sensitive, ngoài allowlist)", async () => {
    const body = await me(employeeToken);
    expect(body.capabilities["view-own:adjustment"]).toBe(true);
    expect(body.scopes["view-own:adjustment"]).toEqual(["Own"]);
  });

  it("#10 keyset scopes === keyset capabilities trên /auth/me (employee + actor reveal)", async () => {
    for (const token of [employeeToken, revealToken]) {
      const body = await me(token);
      expect(Object.keys(body.scopes).sort()).toEqual(Object.keys(body.capabilities).sort());
    }
  });

  it("#14(b) catalog sống có ≥ 2 hàng action reveal* — sàn chống xanh-rỗng", () => {
    expect(revealKeys.length, revealKeys.join(", ")).toBeGreaterThanOrEqual(2);
  });

  it("#13/#24 grant EXACT mọi hàng reveal* ⇒ VẮNG ở capabilities (sau merge allowlist) + scopes; request-break-glass CÓ", async () => {
    const body = await me(revealToken);
    for (const key of revealKeys) {
      expect(key in body.capabilities, `capabilities lộ ${key}`).toBe(false);
      expect(key in body.scopes, `scopes lộ ${key}`).toBe(false);
    }
    expect(body.capabilities[REQUEST_BREAK_GLASS.join(":")]).toBe(true);
  });
});
