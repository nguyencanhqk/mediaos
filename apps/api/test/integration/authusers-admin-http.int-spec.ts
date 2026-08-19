/**
 * S10-QA-ROUTEHTTP-2 (file 2/3) — test HTTP THẬT (supertest) cho 3 route risk=5 còn nợ:
 *
 *   risk 5 · DELETE /auth/users/:id                 [AuthUsersController#softDelete]    perm=delete:user
 *   risk 5 · POST   /auth/users/:id/restore         [AuthUsersController#restore]       perm=restore:user
 *   risk 5 · POST   /auth/users/:id/password/reset  [AuthUsersController#resetPassword] perm=reset-password:user
 *
 * VÌ SAO PHỦ TẦNG SERVICE KHÔNG ĐỦ: guard chain · `ParseUUIDPipe` · envelope/filter CHỈ chạy trên
 * đường HTTP. `auth-users-admin.int-spec.ts` gọi thẳng service ⇒ ba lớp đó chưa từng chạy cho 3 route
 * này (đó là lý do census `route-http-coverage.e2e-spec.ts` xếp chúng vào nhóm CHƯA PHỦ).
 *
 * HỆ QUẢ QUAN SÁT ĐƯỢC (không assert suông status code):
 *   - soft-delete  ⇒ user KHÔNG đăng nhập được nữa + `GET /auth/users/:id` trả 404
 *   - restore      ⇒ user hiện lại ở `GET /auth/users/:id` (200) và ĐĂNG NHẬP LẠI ĐƯỢC
 *   - reset        ⇒ `tempPassword` trả về ĐĂNG NHẬP THẬT được, mật khẩu CŨ hết hiệu lực
 *
 * 3 cặp quyền đều `is_sensitive=true` (mig 0476) ⇒ wildcard KHÔNG thoả cổng. Actor test là user
 * company-scope thường, KHÔNG phải super-admin (SA = tautology). Ca DENY dùng role RỖNG (deny-default)
 * và role mang cặp KHÁC (`view:user`) để chứng minh cổng khớp ĐÚNG CẶP.
 *
 * BẪY THỨ TỰ: mỗi ca tự tạo TARGET riêng. Dùng chung một target thì ca restore phụ thuộc ca delete
 * chạy trước — vitest đổi thứ tự là đỏ ngẫu nhiên.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5). Mật khẩu fixture ghép chuỗi qua helper dùng chung.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
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

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s10rh2f2");

/** Cặp quyền + cờ is_sensitive THẬT của catalog (đo trên lane DB, không đoán). */
const PAIRS = {
  view: { action: "view", resource: "user", sensitive: false },
  delete: { action: "delete", resource: "user", sensitive: true },
  restore: { action: "restore", resource: "user", sensitive: true },
  resetPassword: { action: "reset-password", resource: "user", sensitive: true },
} as const;

interface PermissionPair {
  action: string;
  resource: string;
  sensitive: boolean;
}

describe.skipIf(!hasLaneDb)(
  "S10-QA-ROUTEHTTP-2 — HTTP thật: auth/users (soft-delete · restore · admin reset password)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let tAdminA = "";
    let tEmptyA = "";
    let tViewOnlyA = "";
    let tAdminB = "";
    let adminAUserId = "";
    const password = new PasswordService();

    const http = () => request(app.getHttpServer());
    const authGet = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
    const authPost = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
    const authDelete = (t: string, u: string) =>
      http().delete(u).set("Authorization", `Bearer ${t}`);

    /** Đăng nhập, KHÔNG assert — dùng cho ca cần đo "đăng nhập có còn được không". */
    async function tryLogin(slug: string, email: string, plain = LOGIN_PW) {
      return http().post("/auth/login").send({ companySlug: slug, email, password: plain });
    }

    async function login(slug: string, email: string): Promise<string> {
      const res = await tryLogin(slug, email);
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    /** User thường của tenant (mục tiêu thao tác) — KHÔNG role, KHÔNG grant. */
    async function newTarget(tenant: SeededTenant, tag: string) {
      const email = `${tag}-${randomUUID().slice(0, 8)}@s10rh2f2.local`;
      const id = await seedUser(direct, tenant.companyId, email, await password.hash(LOGIN_PW));
      return { id, email };
    }

    /** Actor có đúng các cặp quyền yêu cầu; trả { token, userId }. */
    async function actor(
      tenant: SeededTenant,
      tag: string,
      pairs: ReadonlyArray<PermissionPair>,
    ): Promise<{ token: string; userId: string }> {
      const { id, email } = await newTarget(tenant, tag);
      const roleId = await seedRole(
        direct,
        tenant.companyId,
        `s10rh2f2-${tag}-${randomUUID().slice(0, 8)}`,
      );
      for (const p of pairs) {
        const permId = await seedPermissionCatalog(direct, p.action, p.resource, p.sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, id, roleId, tenant.companyId);
      return { token: await login(tenant.slug, email), userId: id };
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10rh2f2a");
      B = await seedCompany(direct, "s10rh2f2b");
      companyIds.push(A.companyId, B.companyId);

      const admin = await actor(A, "admin", [
        PAIRS.view,
        PAIRS.delete,
        PAIRS.restore,
        PAIRS.resetPassword,
      ]);
      tAdminA = admin.token;
      adminAUserId = admin.userId;
      tEmptyA = (await actor(A, "empty", [])).token;
      tViewOnlyA = (await actor(A, "viewonly", [PAIRS.view])).token;
      tAdminB = (
        await actor(B, "adminb", [PAIRS.view, PAIRS.delete, PAIRS.restore, PAIRS.resetPassword])
      ).token;
    }, 180_000);

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app?.close();
    });

    // ── 1. DELETE /auth/users/:id (xoá MỀM) ───────────────────────────────
    it("ALLOW: DELETE /auth/users/:id → 200 + user HẾT đăng nhập được và biến khỏi GET /auth/users/:id", async () => {
      const target = await newTarget(A, "del-ok");
      // Trước khi xoá: đăng nhập ĐƯỢC (nếu không, ca DENY phía dưới sẽ xanh rỗng).
      expect((await tryLogin(A.slug, target.email)).status).toBe(200);

      const res = await authDelete(tAdminA, `/auth/users/${target.id}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ id: target.id });

      // HỆ QUẢ #1: không đăng nhập được nữa. #2: đọc lại → 404 (soft-delete ẩn khỏi read path).
      expect((await tryLogin(A.slug, target.email)).status).not.toBe(200);
      const read = await authGet(tAdminA, `/auth/users/${target.id}`);
      expect(read.status, JSON.stringify(read.body)).toBe(404);
    });

    it("DENY: DELETE /auth/users/:id với role RỖNG → 403 và hàng KHÔNG bị xoá", async () => {
      const target = await newTarget(A, "del-deny");
      const res = await authDelete(tEmptyA, `/auth/users/${target.id}`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      // Chứng minh guard chặn TRƯỚC khi chạm hàng — user vẫn đăng nhập được.
      expect((await tryLogin(A.slug, target.email)).status).toBe(200);
    });

    it("DENY: DELETE /auth/users/:id với cặp KHÁC (view:user) → 403 — cổng khớp ĐÚNG CẶP", async () => {
      const target = await newTarget(A, "del-wrongpair");
      const res = await authDelete(tViewOnlyA, `/auth/users/${target.id}`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("CROSS-TENANT: admin B xoá user của A → 404 GIỐNG HỆT id ma (không rò tồn tại) và user A còn sống", async () => {
      const target = await newTarget(A, "del-cross");
      const crossed = await authDelete(tAdminB, `/auth/users/${target.id}`);
      const ghost = await authDelete(tAdminB, `/auth/users/${randomUUID()}`);
      expect(crossed.status, JSON.stringify(crossed.body)).toBe(404);
      expect(ghost.status).toBe(404);
      expect(crossed.body.message).toEqual(ghost.body.message);
      expect((await tryLogin(A.slug, target.email)).status).toBe(200);
    });

    it("400: tự xoá chính mình → 400 (chống tự khoá)", async () => {
      const res = await authDelete(tAdminA, `/auth/users/${adminAUserId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });

    it("400: :id không phải UUID → 400 ở ParseUUIDPipe (không tới service)", async () => {
      const res = await authDelete(tAdminA, "/auth/users/khong-phai-uuid");
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });

    // ── 2. POST /auth/users/:id/restore ───────────────────────────────────
    it("ALLOW: POST /auth/users/:id/restore → 200 + user ĐĂNG NHẬP LẠI được và hiện lại ở GET", async () => {
      const target = await newTarget(A, "res-ok");
      expect((await authDelete(tAdminA, `/auth/users/${target.id}`)).status).toBe(200);
      expect((await tryLogin(A.slug, target.email)).status).not.toBe(200);

      const res = await authPost(tAdminA, `/auth/users/${target.id}/restore`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ id: target.id });

      // HỆ QUẢ: đọc lại 200 VÀ đăng nhập lại được — khôi phục THẬT, không chỉ đổi cờ hiển thị.
      const read = await authGet(tAdminA, `/auth/users/${target.id}`);
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      expect((await tryLogin(A.slug, target.email)).status).toBe(200);
    });

    it("DENY: POST /auth/users/:id/restore với role RỖNG → 403 và user vẫn ở trạng thái đã xoá", async () => {
      const target = await newTarget(A, "res-deny");
      expect((await authDelete(tAdminA, `/auth/users/${target.id}`)).status).toBe(200);

      const res = await authPost(tEmptyA, `/auth/users/${target.id}/restore`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect((await tryLogin(A.slug, target.email)).status).not.toBe(200);
    });

    it("404: restore user ĐANG SỐNG (chưa xoá) → 404", async () => {
      const target = await newTarget(A, "res-live");
      const res = await authPost(tAdminA, `/auth/users/${target.id}/restore`);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("CROSS-TENANT: admin B restore user đã xoá của A → 404 và user A VẪN ở trạng thái đã xoá", async () => {
      const target = await newTarget(A, "res-cross");
      expect((await authDelete(tAdminA, `/auth/users/${target.id}`)).status).toBe(200);

      const crossed = await authPost(tAdminB, `/auth/users/${target.id}/restore`);
      expect(crossed.status, JSON.stringify(crossed.body)).toBe(404);
      expect((await tryLogin(A.slug, target.email)).status).not.toBe(200);
    });

    // ── 3. POST /auth/users/:id/password/reset ────────────────────────────
    it("ALLOW: POST /auth/users/:id/password/reset → 200 + tempPassword ĐĂNG NHẬP THẬT được, mật khẩu CŨ hết hiệu lực", async () => {
      const target = await newTarget(A, "pw-ok");
      const res = await authPost(tAdminA, `/auth/users/${target.id}/password/reset`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const temp = res.body.data.tempPassword as string;
      expect(typeof temp).toBe("string");
      expect(temp.length).toBeGreaterThan(0);
      expect(res.body.data.revokedSessionCount).toBeGreaterThanOrEqual(0);

      // HỆ QUẢ: mật khẩu ĐÃ đổi thật — cũ hỏng, temp dùng được.
      expect((await tryLogin(A.slug, target.email, LOGIN_PW)).status).not.toBe(200);
      expect((await tryLogin(A.slug, target.email, temp)).status).toBe(200);
    });

    it("DENY: POST /auth/users/:id/password/reset với role RỖNG → 403 và mật khẩu CŨ vẫn dùng được", async () => {
      const target = await newTarget(A, "pw-deny");
      const res = await authPost(tEmptyA, `/auth/users/${target.id}/password/reset`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      // Guard chặn TRƯỚC service: mật khẩu không bị đổi.
      expect((await tryLogin(A.slug, target.email, LOGIN_PW)).status).toBe(200);
    });

    it("DENY: POST /auth/users/:id/password/reset với cặp KHÁC (view:user) → 403", async () => {
      const target = await newTarget(A, "pw-wrongpair");
      const res = await authPost(tViewOnlyA, `/auth/users/${target.id}/password/reset`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("CROSS-TENANT: admin B reset mật khẩu user của A → 404 và mật khẩu CŨ của A vẫn dùng được", async () => {
      const target = await newTarget(A, "pw-cross");
      const crossed = await authPost(tAdminB, `/auth/users/${target.id}/password/reset`);
      expect(crossed.status, JSON.stringify(crossed.body)).toBe(404);
      expect((await tryLogin(A.slug, target.email, LOGIN_PW)).status).toBe(200);
    });

    it("400: tự reset mật khẩu chính mình → 400 (đường đúng là change-password)", async () => {
      const res = await authPost(tAdminA, `/auth/users/${adminAUserId}/password/reset`);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });
  },
);
