/**
 * S2-FND-BE-5 (be-permsurface) — GET /foundation/modules/my-apps per-role visibility (integration, DB cô lập).
 *
 * MỤC TIÊU: chứng minh MA TRẬN app HIỂN THỊ đo-được theo GRANT THẬT của 4 role canonical (mig 0444/0454/0455),
 * SAU khi MODULE_APP_METADATA đổi sang cặp canonical + getMyApps merge sensitive-allowlist (Option B).
 * KHÔNG hardcode toàn bộ tập app (tránh brittle với TASK/DASH/NOTI seed-drift) — chỉ assert 4 module đang
 * reconcile (HR/ATT/LEAVE/AUTH) là ĐỦ để bắt regression cặp-drift + ẩn-ngầm-do-sensitive.
 *
 *   employee(0008): read:employee(Own) ⇒ HR; view-own:attendance(SENSITIVE,0454) ⇒ ATT (chỉ hiện nhờ
 *                   Option B merge); view-own:leave(0455) ⇒ LEAVE. KHÔNG view:user/role/setting/audit-log ⇒
 *                   AUTH ẨN.
 *   manager(0010):  + view-team:attendance ⇒ vẫn HR/ATT/LEAVE; AUTH ẨN (không view:user).
 *   hr(0011):       view:user(0444) ⇒ AUTH HIỆN; HR/ATT/LEAVE HIỆN.
 *   company-admin(0001): view:user/role/foundation-setting/audit-log ⇒ AUTH HIỆN; HR/ATT/LEAVE HIỆN.
 *
 * BẰNG CHỨNG Option B (crown): employee THẤY ATT tuy view-own:attendance is_sensitive=true (getCapabilities
 * lọc bỏ) ⇒ chứng minh getMyApps merge getAllowlistedSensitiveCapabilities(); nếu merge bị gỡ → ATT biến mất
 * cho MỌI role ⇒ test RED.
 *
 * Postgres THẬT (DB cô lập mediaos_<lane>, CLAUDE §9.5). Gate `hasDb && LANE_DB` (memory:
 * integration-test-lane-db-gate). Direct pool (superuser) seed roles/users; HTTP qua app thật (guard sống).
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
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const PASSWORD = "Passw0rd!test99";

/** Role canonical hệ thống (company_id NULL). employee/company-admin (mig 0005), manager/hr (mig 0444). */
const ROLE = {
  employee: "00000000-0000-0000-0000-000000000008",
  manager: "00000000-0000-0000-0000-000000000010",
  hr: "00000000-0000-0000-0000-000000000011",
  companyAdmin: "00000000-0000-0000-0000-000000000001",
} as const;

const runDb = hasDb && Boolean(process.env.LANE_DB);

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

async function myAppCodes(
  app: INestApplication,
  token: string,
): Promise<{ codes: Set<string>; items: Array<Record<string, unknown>> }> {
  const res = await api(app)
    .get("/foundation/modules/my-apps")
    .set("Authorization", `Bearer ${token}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const items = (res.body.data as Array<Record<string, unknown>>) ?? [];
  return { codes: new Set(items.map((i) => i.module_code as string)), items };
}

describe.skipIf(!runDb)("S2-FND-BE-5 my-apps per-role visibility (canonical roles)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  const token: Record<keyof typeof ROLE, string> = {} as Record<keyof typeof ROLE, string>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "myapps");
    companyIds.push(A.companyId);
    const pw = await new PasswordService().hash(PASSWORD);

    for (const roleName of Object.keys(ROLE) as Array<keyof typeof ROLE>) {
      const email = `${roleName}-${randomUUID().slice(0, 8)}@a.test`;
      const userId = await seedUser(direct, A.companyId, email, pw);
      await seedUserRole(direct, userId, ROLE[roleName], A.companyId);
      token[roleName] = await login(app, A.slug, email);
    }
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── ATT/LEAVE/HR hiện cho MỌI role (grant Own có ở cả 4) ────────────────────────
  it("MỌI role thấy HR + ATT + LEAVE (grant Own read:employee / view-own:attendance / view-own:leave)", async () => {
    for (const roleName of Object.keys(ROLE) as Array<keyof typeof ROLE>) {
      const { codes } = await myAppCodes(app, token[roleName]);
      expect(codes.has("HR"), `${roleName} phải thấy HR`).toBe(true);
      expect(codes.has("ATT"), `${roleName} phải thấy ATT (Option B merge sensitive)`).toBe(true);
      expect(codes.has("LEAVE"), `${roleName} phải thấy LEAVE`).toBe(true);
    }
  });

  // ── AUTH/system app CHỈ hr + company-admin (view:user/role/setting/audit-log) ────
  it("AUTH (system app) ẨN cho employee + manager; HIỆN cho hr + company-admin", async () => {
    const emp = await myAppCodes(app, token.employee);
    const mgr = await myAppCodes(app, token.manager);
    const hr = await myAppCodes(app, token.hr);
    const adm = await myAppCodes(app, token.companyAdmin);

    expect(emp.codes.has("AUTH"), "employee KHÔNG được thấy AUTH").toBe(false);
    expect(mgr.codes.has("AUTH"), "manager KHÔNG được thấy AUTH").toBe(false);
    expect(hr.codes.has("AUTH"), "hr PHẢI thấy AUTH (view:user)").toBe(true);
    expect(adm.codes.has("AUTH"), "company-admin PHẢI thấy AUTH").toBe(true);
  });

  // ── BẰNG CHỨNG Option B: ATT hiện DÙ view-own:attendance is_sensitive (getCapabilities lọc bỏ) ──
  it("employee thấy ATT tuy cặp gate là SENSITIVE (chứng minh merge allowlist-sensitive, không ẩn-ngầm)", async () => {
    const { codes } = await myAppCodes(app, token.employee);
    expect(codes.has("ATT")).toBe(true);
  });

  // ── QA-04 contract: shape my-apps KHÔNG đổi + KHÔNG rò secret/storage_path ───────
  it("shape my-apps đúng contract + KHÔNG lộ secret/storage_path/password_hash", async () => {
    const { items } = await myAppCodes(app, token.companyAdmin);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      for (const key of [
        "module_code",
        "name",
        "route",
        "icon",
        "group",
        "is_active",
        "is_favorite",
        "is_recent",
        "badges",
        "required_permissions",
        "allowed_actions",
      ]) {
        expect(item, `thiếu trường '${key}' trong item my-apps`).toHaveProperty(key);
      }
      const serialized = JSON.stringify(item);
      expect(serialized).not.toMatch(/storage_path/i);
      expect(serialized).not.toMatch(/secret_ref/i);
      expect(serialized).not.toMatch(/password_hash|refresh_token/i);
    }
    // AUTH item (company-admin) phải khai required_permissions canonical (đã đổi khỏi FOUNDATION.AUDIT_LOG.VIEW).
    const authItem = items.find((i) => i.module_code === "AUTH");
    expect(authItem).toBeDefined();
    const reqPerms = (authItem?.required_permissions as string[]) ?? [];
    expect(reqPerms).toContain("AUTH.AUDIT_LOG.VIEW");
    expect(reqPerms).not.toContain("FOUNDATION.AUDIT_LOG.VIEW");
  });
});
