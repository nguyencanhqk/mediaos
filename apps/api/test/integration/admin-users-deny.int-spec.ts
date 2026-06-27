/**
 * ACCT-2 — HTTP deny-path: AdminUsersController (supertest + Nest app thật, PermissionGuard wired).
 *
 * Routes (prefix con `users/admin` — tránh va chạm route với UserInvitesController @Controller('users')):
 *   GET    /users/admin              — list      (manage:user)
 *   GET    /users/admin/:id          — getOne    (manage:user)
 *   PATCH  /users/admin/:id          — update    (manage:user)
 *   POST   /users/admin/:id/suspend     — SENSITIVE (suspend:user is_sensitive=true)
 *   POST   /users/admin/:id/reactivate  — SENSITIVE (suspend:user)
 *   DELETE /users/admin/:id          — soft-delete SENSITIVE (delete-user:user is_sensitive=true)
 *
 * Cases:
 *  §deny           — user role rỗng (KHÔNG manage:user) → MỌI route 403 envelope {success:false,error} + 0 side-effect.
 *  §wildcard       — user '*:*' (non-sensitive) gọi suspend/delete → vẫn 403 (sensitive chặn *:*).
 *  §rls            — admin tenant A thao tác user tenant B → 404 (RLS che) + row B KHÔNG đổi.
 *  §self-guard     — admin tự suspend/delete CHÍNH MÌNH → 400 (chống lockout).
 *  §no-hard-delete — sau DELETE row VẪN tồn tại vật lý (deleted_at NOT NULL, count KHÔNG giảm).
 *  §allow          — company-admin (role 0001 + sensitive grants) → 200 thành công.
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
  seedPermissionCatalog,
  seedRolePermission,
  type SeededTenant,
} from "../helpers/seed";

const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";
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

/** Grant sensitive perm cho company-admin role 0001 (suspend:user / delete-user:user). */
async function grantSensitiveToAdmin(direct: Pool): Promise<void> {
  for (const action of ["suspend", "delete-user"]) {
    const permId = await seedPermissionCatalog(direct, action, "user", true);
    await seedRolePermission(direct, COMPANY_ADMIN_ROLE_ID, permId, "ALLOW");
  }
}

async function userRow(
  direct: Pool,
  id: string,
): Promise<{ status: string; deleted_at: Date | null } | undefined> {
  const r = await direct.query(`SELECT status, deleted_at FROM users WHERE id = $1`, [id]);
  return r.rows[0] as { status: string; deleted_at: Date | null } | undefined;
}

async function countUsers(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(`SELECT count(*)::int AS n FROM users WHERE company_id = $1`, [
    companyId,
  ]);
  return r.rows[0].n as number;
}

describe.skipIf(!hasDb)("ACCT-2 admin users controller HTTP deny-path", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let noPermToken: string;
  let wildcardToken: string;
  let adminToken: string;
  let adminId: string;
  let targetAId: string; // user thường ở A để thao tác
  let targetBId: string; // user ở B (cross-tenant target)
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "auA");
    B = await seedCompany(direct, "auB");
    companyIds.push(A.companyId, B.companyId);
    await grantSensitiveToAdmin(direct);

    const pw = await hashedPw();

    // noPermUser: role rỗng → không có manage:user
    const noPermId = await seedUser(direct, A.companyId, `au-noperm-${randomUUID().slice(0, 8)}@a.test`, pw);
    const emptyRole = await seedRole(direct, A.companyId, `au-empty-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, noPermId, emptyRole, A.companyId);

    // wildcardUser: '*:*' ALLOW (non-sensitive) → KHÔNG được kế thừa suspend/delete sensitive.
    const wildId = await seedUser(direct, A.companyId, `au-wild-${randomUUID().slice(0, 8)}@a.test`, pw);
    const wildRole = await seedRole(direct, A.companyId, `au-wild-${randomUUID().slice(0, 8)}`);
    const wildPerm = await seedPermissionCatalog(direct, "*", "*", false);
    await seedRolePermission(direct, wildRole, wildPerm, "ALLOW");
    await seedUserRole(direct, wildId, wildRole, A.companyId);

    // adminUser: company-admin (role 0001 → mọi non-sensitive + 2 sensitive grant ở trên).
    adminId = await seedUser(direct, A.companyId, `au-admin-${randomUUID().slice(0, 8)}@a.test`, pw);
    await seedUserRole(direct, adminId, COMPANY_ADMIN_ROLE_ID, A.companyId);

    // Targets
    targetAId = await seedUser(direct, A.companyId, `au-tgt-${randomUUID().slice(0, 8)}@a.test`, pw);
    targetBId = await seedUser(direct, B.companyId, `au-tgtB-${randomUUID().slice(0, 8)}@b.test`, pw);

    // Login từng actor bằng email THẬT đã seed (đọc lại từ DB).
    const noPermEmail = await emailOf(direct, noPermId);
    const wildEmail = await emailOf(direct, wildId);
    const adminEmail = await emailOf(direct, adminId);
    noPermToken = await login(app, A.slug, noPermEmail);
    wildcardToken = await login(app, A.slug, wildEmail);
    adminToken = await login(app, A.slug, adminEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // ── §deny — user không quyền → 403 envelope, 0 side-effect ──────────────────

  describe("§deny — thiếu manage:user → 403 + 0 side-effect", () => {
    it("GET /users → 403", async () => {
      const res = await api(app).get("/users/admin").set("Authorization", `Bearer ${noPermToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("object");
    });

    it("GET /users/:id → 403", async () => {
      const res = await api(app)
        .get(`/users/admin/${targetAId}`)
        .set("Authorization", `Bearer ${noPermToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it("PATCH /users/:id → 403 + status/fullName KHÔNG đổi", async () => {
      const before = await userRow(direct, targetAId);
      const res = await api(app)
        .patch(`/users/admin/${targetAId}`)
        .set("Authorization", `Bearer ${noPermToken}`)
        .send({ fullName: "Hacked" });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect((await userRow(direct, targetAId))?.status).toBe(before?.status);
    });

    it("POST /users/:id/suspend → 403 + status KHÔNG đổi", async () => {
      const before = await userRow(direct, targetAId);
      const res = await api(app)
        .post(`/users/admin/${targetAId}/suspend`)
        .set("Authorization", `Bearer ${noPermToken}`)
        .send({ reason: "deny test" });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect((await userRow(direct, targetAId))?.status).toBe(before?.status);
    });

    it("POST /users/:id/reactivate → 403", async () => {
      const res = await api(app)
        .post(`/users/admin/${targetAId}/reactivate`)
        .set("Authorization", `Bearer ${noPermToken}`)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it("DELETE /users/:id → 403 + deleted_at vẫn NULL", async () => {
      const res = await api(app)
        .delete(`/users/admin/${targetAId}`)
        .set("Authorization", `Bearer ${noPermToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect((await userRow(direct, targetAId))?.deleted_at).toBeNull();
    });
  });

  // ── §wildcard — '*:*' KHÔNG bypass cổng nhạy cảm ────────────────────────────

  describe("§wildcard — '*:*' (non-sensitive) KHÔNG kế thừa suspend/delete", () => {
    it("POST /users/:id/suspend với '*:*' → 403 + status KHÔNG đổi", async () => {
      const before = await userRow(direct, targetAId);
      const res = await api(app)
        .post(`/users/admin/${targetAId}/suspend`)
        .set("Authorization", `Bearer ${wildcardToken}`)
        .send({ reason: "wildcard test" });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect((await userRow(direct, targetAId))?.status).toBe(before?.status);
    });

    it("DELETE /users/:id với '*:*' → 403 + deleted_at vẫn NULL", async () => {
      const res = await api(app)
        .delete(`/users/admin/${targetAId}`)
        .set("Authorization", `Bearer ${wildcardToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect((await userRow(direct, targetAId))?.deleted_at).toBeNull();
    });
  });

  // ── §rls — cross-tenant target → 404 (RLS che, không lộ tồn tại) ────────────

  describe("§rls — admin A thao tác user B → 404 + row B KHÔNG đổi", () => {
    it("GET /users/:id (id thuộc B) → 404", async () => {
      const res = await api(app)
        .get(`/users/admin/${targetBId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("POST /users/:id/suspend (id thuộc B) → 404 + B status KHÔNG đổi", async () => {
      const before = await userRow(direct, targetBId);
      const res = await api(app)
        .post(`/users/admin/${targetBId}/suspend`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "cross-tenant" });
      expect(res.status).toBe(404);
      expect((await userRow(direct, targetBId))?.status).toBe(before?.status);
    });

    it("DELETE /users/:id (id thuộc B) → 404 + B deleted_at vẫn NULL", async () => {
      const res = await api(app)
        .delete(`/users/admin/${targetBId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      expect((await userRow(direct, targetBId))?.deleted_at).toBeNull();
    });
  });

  // ── §self-guard — admin KHÔNG tự suspend/delete chính mình ──────────────────

  describe("§self-guard — actor ≠ target cho suspend/delete (chống lockout)", () => {
    it("POST /users/:id/suspend chính mình → 400 + status KHÔNG đổi", async () => {
      const before = await userRow(direct, adminId);
      const res = await api(app)
        .post(`/users/admin/${adminId}/suspend`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "self" });
      expect([400, 409]).toContain(res.status);
      expect(res.body.success).toBe(false);
      expect((await userRow(direct, adminId))?.status).toBe(before?.status);
    });

    it("DELETE /users/:id chính mình → 400 + deleted_at vẫn NULL", async () => {
      const res = await api(app)
        .delete(`/users/admin/${adminId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect([400, 409]).toContain(res.status);
      expect((await userRow(direct, adminId))?.deleted_at).toBeNull();
    });
  });

  // ── §allow + §no-hard-delete — admin có quyền → 200; DELETE = soft-delete ───

  describe("§allow + §no-hard-delete — company-admin", () => {
    it("GET /users → 200 envelope + danh sách", async () => {
      const res = await api(app).get("/users/admin").set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.users)).toBe(true);
    });

    it("DTO list KHÔNG chứa passwordHash", async () => {
      const res = await api(app).get("/users/admin").set("Authorization", `Bearer ${adminToken}`);
      const rows = res.body.data.users as Array<Record<string, unknown>>;
      for (const r of rows) {
        expect(r).not.toHaveProperty("passwordHash");
        expect(r).not.toHaveProperty("password_hash");
      }
    });

    it("POST suspend → 200 status='suspended'; reactivate → 'active'", async () => {
      const victim = await seedUser(direct, A.companyId, `au-v-${randomUUID().slice(0, 8)}@a.test`, await hashedPw());
      const sus = await api(app)
        .post(`/users/admin/${victim}/suspend`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "ok" });
      expect(sus.status).toBe(200);
      expect((await userRow(direct, victim))?.status).toBe("suspended");

      const re = await api(app)
        .post(`/users/admin/${victim}/reactivate`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});
      expect(re.status).toBe(200);
      expect((await userRow(direct, victim))?.status).toBe("active");
    });

    it("DELETE = soft-delete: deleted_at set + row VẪN tồn tại vật lý (count KHÔNG giảm)", async () => {
      const victim = await seedUser(direct, A.companyId, `au-d-${randomUUID().slice(0, 8)}@a.test`, await hashedPw());
      const before = await countUsers(direct, A.companyId);
      const res = await api(app)
        .delete(`/users/admin/${victim}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const row = await userRow(direct, victim);
      expect(row?.deleted_at).not.toBeNull(); // soft-delete
      expect(await countUsers(direct, A.companyId)).toBe(before); // KHÔNG hard-delete (row vẫn còn)
    });
  });
});
