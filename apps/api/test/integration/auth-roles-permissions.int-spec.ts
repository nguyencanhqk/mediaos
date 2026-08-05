/**
 * S2-AUTH-BE-3 — HTTP int-spec: GET /auth/roles + /auth/permissions (read-only catalogs for assign UI).
 *
 *  §deny  — role rỗng (KHÔNG view:role / view:permission) → 403.
 *  §allow — company-admin (0444 grant view:role + view:permission) → 200 + danh sách.
 *  §no-operator — /auth/roles KHÔNG chứa role operator-audience (platform-admin …f0) — chống leo thang.
 *  §2fa-flag (S7-SEC-ROLE2FA-UI-1) — mỗi role mang `requiresTwoFactor` PHẢN CHIẾU ĐÚNG
 *             roles.requires_two_factor. Đây là ĐƯỜNG ĐỌC DUY NHẤT của màn "Sửa vai trò" (không có
 *             GET /auth/roles/:id) — thiếu cột ⇒ form prefill sai ⇒ không tắt được cờ từ UI.
 *
 * Gate: hasDb && LANE_DB (DB cô lập theo lane) — thiếu LANE_DB → SKIP để KHÔNG chạm DB dev chung 'mediaos'
 * (.env làm hasDb=true → đỏ-giả/xanh-giả) — CLAUDE.md §9.5, memory integration-test-lane-db-gate.
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
  seedRole,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";
const PLATFORM_ADMIN_ROLE_ID = "00000000-0000-0000-0000-0000000000f0";
const PASSWORD = ["Passw0rd", "Rp", "99"].join("");

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

/** Đọc cờ THẲNG từ DB — mốc so sánh cho đường đọc HTTP (không đoán theo seed). */
async function roleFlagInDb(direct: Pool, roleId: string): Promise<boolean> {
  const r = await direct.query(`SELECT requires_two_factor FROM roles WHERE id = $1`, [roleId]);
  expect(r.rows.length).toBe(1);
  return r.rows[0].requires_two_factor as boolean;
}

// Gate hasDb && LANE_DB: thiếu DB lane cô lập → SKIP (KHÔNG chạm 'mediaos' dev chung). CLAUDE.md §9.5.
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)("S2-AUTH-BE-3 /auth/roles + /auth/permissions", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let noPermToken: string;
  let adminToken: string;
  /** Role company-scope KHÔNG ép 2FA (cũng là role rỗng quyền của user deny-path). */
  let plainRoleId: string;
  /** Role company-scope CÓ requires_two_factor=true — mốc RED của S7-SEC-ROLE2FA-UI-1. */
  let twoFactorRoleId: string;
  /** Role của TENANT KHÁC, cũng ép 2FA — phải KHÔNG bao giờ xuất hiện trong list của tenant A. */
  let foreignTwoFactorRoleId: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "rpa");
    companyIds.push(A.companyId);
    const pw = await hashedPw();

    const noPermId = await seedUser(
      direct,
      A.companyId,
      `rp-np-${randomUUID().slice(0, 8)}@a.test`,
      pw,
    );
    plainRoleId = await seedRole(direct, A.companyId, `rp-empty-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, noPermId, plainRoleId, A.companyId);

    // Role ÉP 2FA — bật cờ bằng UPDATE trực tiếp (seedRole cố ý không nhận cờ; helper dùng chung, giữ
    // chữ ký tối thiểu). Đây là hàng phải hiện `requiresTwoFactor: true` ở đường đọc HTTP.
    twoFactorRoleId = await seedRole(direct, A.companyId, `rp-2fa-${randomUUID().slice(0, 8)}`);
    await direct.query(`UPDATE roles SET requires_two_factor = true WHERE id = $1`, [
      twoFactorRoleId,
    ]);

    // Tenant B — chỉ để chứng minh cột MỚI không mở đường rò chéo tenant (RLS vẫn là chốt).
    const B = await seedCompany(direct, "rpb");
    companyIds.push(B.companyId);
    foreignTwoFactorRoleId = await seedRole(
      direct,
      B.companyId,
      `rp-2fa-foreign-${randomUUID().slice(0, 8)}`,
    );
    await direct.query(`UPDATE roles SET requires_two_factor = true WHERE id = $1`, [
      foreignTwoFactorRoleId,
    ]);

    const adminId = await seedUser(
      direct,
      A.companyId,
      `rp-admin-${randomUUID().slice(0, 8)}@a.test`,
      pw,
    );
    await seedUserRole(direct, adminId, COMPANY_ADMIN_ROLE_ID, A.companyId);

    noPermToken = await login(app, A.slug, await emailOf(direct, noPermId));
    adminToken = await login(app, A.slug, await emailOf(direct, adminId));
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
  });

  it("GET /auth/roles deny role rỗng → 403", async () => {
    const res = await api(app).get("/auth/roles").set("Authorization", `Bearer ${noPermToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /auth/permissions deny role rỗng → 403", async () => {
    const res = await api(app)
      .get("/auth/permissions")
      .set("Authorization", `Bearer ${noPermToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /auth/roles admin → 200 + KHÔNG chứa role operator platform-admin", async () => {
    const res = await api(app).get("/auth/roles").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.data.roles as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(COMPANY_ADMIN_ROLE_ID);
    expect(ids).not.toContain(PLATFORM_ADMIN_ROLE_ID);
  });

  // ── §2fa-flag (S7-SEC-ROLE2FA-UI-1) ─────────────────────────────────────────────────────────
  // RED trước GREEN: trên code cũ `listRolesTx` KHÔNG select requires_two_factor ⇒ mọi hàng thiếu
  // khoá `requiresTwoFactor` (undefined) ⇒ 3 assert dưới đây đỏ. Đây là hệ quả BE của lỗi owner báo
  // 04/08: màn "Sửa vai trò" đọc catalog này để prefill, nên cột thiếu = ô "Bắt buộc 2FA" LUÔN trống.
  it("GET /auth/roles mang requiresTwoFactor phản chiếu ĐÚNG roles.requires_two_factor", async () => {
    const res = await api(app).get("/auth/roles").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = res.body.data.roles as Array<{ id: string; requiresTwoFactor?: boolean }>;

    expect(rows.find((r) => r.id === twoFactorRoleId)?.requiresTwoFactor).toBe(true);
    expect(rows.find((r) => r.id === plainRoleId)?.requiresTwoFactor).toBe(false);
    // System role: so với DB chứ KHÔNG đoán theo mig 0120 — lane CI dùng DB chung, đừng ghim seed.
    expect(rows.find((r) => r.id === COMPANY_ADMIN_ROLE_ID)?.requiresTwoFactor).toBe(
      await roleFlagInDb(direct, COMPANY_ADMIN_ROLE_ID),
    );
  });

  it("GET /auth/roles KHÔNG lộ role ép-2FA của tenant khác (cột mới không mở đường rò chéo tenant)", async () => {
    // Chứng minh dương tính trước: hàng tenant B THẬT SỰ tồn tại và THẬT SỰ mang cờ true — nếu không,
    // assert "vắng mặt" dưới đây xanh vì lý do sai (role không được gieo) chứ không vì RLS chặn.
    expect(await roleFlagInDb(direct, foreignTwoFactorRoleId)).toBe(true);

    const res = await api(app).get("/auth/roles").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.data.roles as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(twoFactorRoleId);
    expect(ids).not.toContain(foreignTwoFactorRoleId);
  });

  it("GET /auth/permissions admin → 200 + có 'view:user' catalog", async () => {
    const res = await api(app)
      .get("/auth/permissions")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const perms = res.body.data.permissions as Array<{ action: string; resourceType: string }>;
    expect(perms.some((p) => p.action === "view" && p.resourceType === "user")).toBe(true);
  });
});
