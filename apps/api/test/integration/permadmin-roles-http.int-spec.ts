/**
 * S10-QA-ROUTEHTTP-2 (file 3/3 — CROWN-JEWEL) — test HTTP THẬT cho 6 route risk=5 còn nợ, tất cả đều
 * là đường LEO THANG ĐẶC QUYỀN:
 *
 *   risk 5 · POST   /permissions/users/:userId/roles           [assignRole]             perm=assign-role:user
 *   risk 5 · DELETE /permissions/users/:userId/roles/:roleId   [revokeRole]             perm=assign-role:user
 *   risk 5 · PUT    /permissions/object                        [setObjectPermission]    perm=grant-object-permission:permission
 *   risk 5 · DELETE /permissions/object                        [removeObjectPermission] perm=grant-object-permission:permission
 *   risk 5 · DELETE /auth/roles/:id                            [deleteRole]             perm=delete:role
 *   risk 5 · DELETE /auth/roles/:id/permissions                [revokePermission]       perm=assign:permission
 *
 * HỆ QUẢ QUAN SÁT ĐƯỢC — đo bằng QUYỀN THẬT của một user thứ hai (`subject`), không assert suông:
 * subject không role bị 403 ở `GET /auth/users`; được gán role mang `view:user` ⇒ 200; bị thu role /
 * xoá role / gỡ grant ⇒ 403.
 *
 * ⚠️ MẪU ĐỐI CHỨNG A/B — VÌ SAO KHÔNG ĐO "cùng một user, trước rồi sau". Cache quyền
 * (`CachedPermissionRepository`, TTL 300s) chỉ được xoá khi sự kiện `permission.changed` ĐƯỢC GIAO
 * qua outbox (`permission.module.ts:80`), mà `worker-scheduler.service.ts:37` TẮT mọi interval khi
 * `NODE_ENV='test'` ⇒ trong int-spec KHÔNG có ai tick outbox ⇒ mục cache đọc trước khi đổi quyền sẽ
 * SỐNG nguyên vẹn tới hết TTL. Gọi route bị gate TRƯỚC rồi lại sau khi đổi quyền do đó đo TRÚNG cache
 * cũ, không đo quyết định mới — và pin "403 sau khi được gán quyền" sẽ là GHIM MỘT HIỆN VẬT MÔI
 * TRƯỜNG TEST, không phải bug sản phẩm (ở PROD scheduler bật, invalidate đi sau ≤ `OUTBOX_POLL_MS`,
 * mặc định 5000ms).
 * Nên mỗi ca dùng HAI user cache-LẠNH: `keep` (giữ quyền) và `changed` (bị thu quyền), cả hai chỉ gọi
 * route bị gate MỘT LẦN sau khi mọi mutation đã xong. `keep`=200 chặn ca `changed`=403 xanh rỗng, và
 * cả hai lần đọc đều đi thẳng vào DB thật.
 *
 * ⚠️ VÌ SAO ROUTE OBJECT-PERMISSION (9·10) KHÔNG ĐO BẰNG "lật quyết định của một route đọc".
 * `permission.guard.ts:120` chỉ chuyển `resourceId` xuống engine cho LỚP reveal-secret
 * (`isSensitive && requiresReauth`); mọi route khác chạy type-level với `resourceId = undefined` ⇒
 * `decideCan` BỎ QUA hoàn toàn tầng object. Nên object-grant KHÔNG lật được `GET /auth/users/:id`.
 * Viết ca "object DENY ⇒ 403" ở đây sẽ là assert BỊA (nó xanh vì lý do khác). Hệ quả THẬT đo được là:
 * hàng `object_permissions` xuất hiện/biến mất + `audit_logs` ghi ObjectPermissionSet/Removed
 * (append-only, BẤT BIẾN #2) + DELETE lần hai trả 404.
 *
 * AUDIT (yêu cầu riêng của nhóm crown-jewel): mỗi ca ALLOW của 4 route permission kiểm `audit_logs`
 * có hàng ĐÚNG action + đúng company — chứng minh mutation quyền không bao giờ đi lặng.
 *
 * ACTOR KHÔNG PHẢI SUPER-ADMIN. DENY dùng role RỖNG (deny-default). Không seed cặp `*:*` (catalog
 * TOÀN CỤC — thêm là đóng dấu vĩnh viễn lên lane DB dùng chung của CI).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
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
const LOGIN_PW = loginPasswordFixture("s10rh2f3");

/** Cặp quyền + cờ is_sensitive THẬT của catalog (đo trên lane DB, không đoán). */
const PAIRS = {
  assignRole: { action: "assign-role", resource: "user", sensitive: true },
  grantObject: { action: "grant-object-permission", resource: "permission", sensitive: true },
  assignPermission: { action: "assign", resource: "permission", sensitive: true },
  deleteRole: { action: "delete", resource: "role", sensitive: false },
  viewUser: { action: "view", resource: "user", sensitive: false },
  viewPermission: { action: "view", resource: "permission", sensitive: false },
} as const;

interface PermissionPair {
  action: string;
  resource: string;
  sensitive: boolean;
}

describe.skipIf(!hasLaneDb)(
  "S10-QA-ROUTEHTTP-2 — HTTP thật: permission-admin + role-admin (6 route leo thang đặc quyền)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let tAdminA = "";
    let tEmptyA = "";
    let tAdminB = "";
    let permViewUserId = "";
    const password = new PasswordService();

    const http = () => request(app.getHttpServer());
    const authGet = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
    const authPost = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
    const authPut = (t: string, u: string) => http().put(u).set("Authorization", `Bearer ${t}`);
    const authDelete = (t: string, u: string) =>
      http().delete(u).set("Authorization", `Bearer ${t}`);

    async function login(slug: string, email: string): Promise<string> {
      const res = await http().post("/auth/login").send({
        companySlug: slug,
        email,
        password: LOGIN_PW,
      });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    /** User trần (không role) + token của chính nó. */
    async function newSubject(tenant: SeededTenant, tag: string) {
      const email = `${tag}-${randomUUID().slice(0, 8)}@s10rh2f3.local`;
      const id = await seedUser(direct, tenant.companyId, email, await password.hash(LOGIN_PW));
      return { id, email, token: await login(tenant.slug, email) };
    }

    async function actor(
      tenant: SeededTenant,
      tag: string,
      pairs: ReadonlyArray<PermissionPair>,
    ): Promise<string> {
      const s = await newSubject(tenant, tag);
      const roleId = await seedRole(
        direct,
        tenant.companyId,
        `s10rh2f3-${tag}-${randomUUID().slice(0, 8)}`,
      );
      for (const p of pairs) {
        const permId = await seedPermissionCatalog(direct, p.action, p.resource, p.sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, s.id, roleId, tenant.companyId);
      // Token lấy SAU khi gắn role (grant đọc theo request nên không bắt buộc, nhưng giữ tường minh).
      return login(tenant.slug, s.email);
    }

    /** Role rỗng-người, mang đúng `view:user` — dùng làm "quyền cấp phát được" cho subject. */
    async function newViewUserRole(tag: string): Promise<string> {
      const roleId = await seedRole(
        direct,
        A.companyId,
        `s10rh2f3-${tag}-${randomUUID().slice(0, 8)}`,
      );
      await seedRolePermission(direct, roleId, permViewUserId, "ALLOW", "Company");
      return roleId;
    }

    /** Đếm hàng audit theo action trong tenant A (append-only ⇒ chỉ tăng). */
    async function auditCount(action: string, objectType: string): Promise<number> {
      const res = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_logs
          WHERE company_id = $1 AND action = $2 AND object_type = $3`,
        [A.companyId, action, objectType],
      );
      return Number(res.rows[0].n);
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10rh2f3a");
      B = await seedCompany(direct, "s10rh2f3b");
      companyIds.push(A.companyId, B.companyId);

      permViewUserId = await seedPermissionCatalog(
        direct,
        PAIRS.viewUser.action,
        PAIRS.viewUser.resource,
        PAIRS.viewUser.sensitive,
      );

      const adminPairs = [
        PAIRS.assignRole,
        PAIRS.grantObject,
        PAIRS.assignPermission,
        PAIRS.deleteRole,
        PAIRS.viewUser,
        PAIRS.viewPermission,
      ];
      tAdminA = await actor(A, "admin", adminPairs);
      tEmptyA = await actor(A, "empty", []);
      tAdminB = await actor(B, "adminb", adminPairs);
    }, 180_000);

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app?.close();
    });

    // ── 7. POST /permissions/users/:userId/roles ──────────────────────────
    it("ALLOW: gán role → được 200 ở GET /auth/users (đối chứng: user không role → 403) + audit RoleAssigned", async () => {
      const granted = await newSubject(A, "assign-ok");
      const control = await newSubject(A, "assign-ctl");
      const roleId = await newViewUserRole("assign-ok");
      const auditBefore = await auditCount("RoleAssigned", "user_role");

      const res = await authPost(tAdminA, `/permissions/users/${granted.id}/roles`).send({
        roleId,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toMatchObject({ userId: granted.id, roleId });

      // HỆ QUẢ trên đường HTTP thật: hai user cache-LẠNH, mỗi user đọc ĐÚNG MỘT lần (docblock A/B).
      expect((await authGet(granted.token, "/auth/users")).status).toBe(200);
      expect((await authGet(control.token, "/auth/users")).status).toBe(403);
      expect(await auditCount("RoleAssigned", "user_role")).toBe(auditBefore + 1);
    });

    it("DENY: gán role với role RỖNG → 403 và subject KHÔNG được nâng quyền", async () => {
      const subject = await newSubject(A, "assign-deny");
      const roleId = await newViewUserRole("assign-deny");

      const res = await authPost(tEmptyA, `/permissions/users/${subject.id}/roles`).send({
        roleId,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect((await authGet(subject.token, "/auth/users")).status).toBe(403);
    });

    it("DTO 400 ở BIÊN: roleId không phải UUID → 400 (Zod chặn trước service)", async () => {
      const subject = await newSubject(A, "assign-dto");
      const res = await authPost(tAdminA, `/permissions/users/${subject.id}/roles`).send({
        roleId: "khong-phai-uuid",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });

    it("400: :userId không phải UUID → 400 ở ParseUUIDPipe", async () => {
      const roleId = await newViewUserRole("assign-badparam");
      const res = await authPost(tAdminA, "/permissions/users/khong-phai-uuid/roles").send({
        roleId,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });

    it("CROSS-TENANT: admin B gán role của A cho user của A → KHÔNG thành công và subject vẫn 403", async () => {
      const subject = await newSubject(A, "assign-cross");
      const roleId = await newViewUserRole("assign-cross");

      const res = await authPost(tAdminB, `/permissions/users/${subject.id}/roles`).send({
        roleId,
      });
      expect(res.status, JSON.stringify(res.body)).not.toBe(201);
      expect(res.status).toBeGreaterThanOrEqual(400);
      // Điều QUAN TRỌNG nhất: không có leo thang xuyên tenant.
      expect((await authGet(subject.token, "/auth/users")).status).toBe(403);
    });

    // ── 8. DELETE /permissions/users/:userId/roles/:roleId ────────────────
    it("ALLOW: thu role → 204 + người bị thu 403 trong khi người GIỮ role vẫn 200 + audit RoleRevoked", async () => {
      const revoked = await newSubject(A, "revoke-ok");
      const keep = await newSubject(A, "revoke-keep");
      const roleId = await newViewUserRole("revoke-ok");
      for (const u of [revoked, keep]) {
        expect(
          (await authPost(tAdminA, `/permissions/users/${u.id}/roles`).send({ roleId })).status,
        ).toBe(201);
      }
      const auditBefore = await auditCount("RoleRevoked", "user_role");

      const res = await authDelete(tAdminA, `/permissions/users/${revoked.id}/roles/${roleId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(204);

      // ĐỐI CHỨNG: `keep` = 200 chứng minh role THẬT SỰ mở quyền ⇒ `revoked` = 403 không xanh rỗng.
      expect((await authGet(keep.token, "/auth/users")).status).toBe(200);
      expect((await authGet(revoked.token, "/auth/users")).status).toBe(403);
      expect(await auditCount("RoleRevoked", "user_role")).toBe(auditBefore + 1);
    });

    it("DENY: thu role với role RỖNG → 403 và subject GIỮ NGUYÊN quyền", async () => {
      const subject = await newSubject(A, "revoke-deny");
      const roleId = await newViewUserRole("revoke-deny");
      expect(
        (await authPost(tAdminA, `/permissions/users/${subject.id}/roles`).send({ roleId })).status,
      ).toBe(201);

      const res = await authDelete(tEmptyA, `/permissions/users/${subject.id}/roles/${roleId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect((await authGet(subject.token, "/auth/users")).status).toBe(200);
    });

    it("CROSS-TENANT: admin B thu role của user A → không thành công, subject A GIỮ quyền", async () => {
      const subject = await newSubject(A, "revoke-cross");
      const roleId = await newViewUserRole("revoke-cross");
      expect(
        (await authPost(tAdminA, `/permissions/users/${subject.id}/roles`).send({ roleId })).status,
      ).toBe(201);

      const res = await authDelete(tAdminB, `/permissions/users/${subject.id}/roles/${roleId}`);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect((await authGet(subject.token, "/auth/users")).status).toBe(200);
    });

    // ── 9 + 10. PUT / DELETE /permissions/object ──────────────────────────
    /** Body object-permission hợp lệ cho `subjectId` (objectId ngẫu nhiên — tầng object không cần FK). */
    const objectBody = (subjectId: string, objectId: string) => ({
      subjectType: "user" as const,
      subjectId,
      action: PAIRS.viewUser.action,
      resourceType: PAIRS.viewUser.resource,
      objectType: "user",
      objectId,
      effect: "ALLOW" as const,
    });

    async function objectRowCount(subjectId: string, objectId: string): Promise<number> {
      const res = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM object_permissions
          WHERE company_id = $1 AND subject_id = $2 AND object_id = $3`,
        [A.companyId, subjectId, objectId],
      );
      return Number(res.rows[0].n);
    }

    it("ALLOW: PUT /permissions/object → 200 + hàng object_permissions THẬT + audit ObjectPermissionSet", async () => {
      const subject = await newSubject(A, "objset-ok");
      const objectId = randomUUID();
      const auditBefore = await auditCount("ObjectPermissionSet", "object_permission");
      expect(await objectRowCount(subject.id, objectId)).toBe(0);

      const res = await authPut(tAdminA, "/permissions/object").send(
        objectBody(subject.id, objectId),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ subjectId: subject.id, objectId, effect: "ALLOW" });

      expect(await objectRowCount(subject.id, objectId)).toBe(1);
      expect(await auditCount("ObjectPermissionSet", "object_permission")).toBe(auditBefore + 1);
    });

    it("DENY: PUT /permissions/object với role RỖNG → 403 và KHÔNG có hàng nào được ghi", async () => {
      const subject = await newSubject(A, "objset-deny");
      const objectId = randomUUID();
      const res = await authPut(tEmptyA, "/permissions/object").send(
        objectBody(subject.id, objectId),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(await objectRowCount(subject.id, objectId)).toBe(0);
    });

    it("DTO 400 ở BIÊN: effect ngoài enum → 400", async () => {
      const subject = await newSubject(A, "objset-dto");
      const res = await authPut(tAdminA, "/permissions/object").send({
        ...objectBody(subject.id, randomUUID()),
        effect: "MAYBE",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });

    it("ALLOW: DELETE /permissions/object → 204 + hàng biến mất + audit ObjectPermissionRemoved; xoá lại → 404", async () => {
      const subject = await newSubject(A, "objdel-ok");
      const objectId = randomUUID();
      const body = objectBody(subject.id, objectId);
      expect((await authPut(tAdminA, "/permissions/object").send(body)).status).toBe(200);
      const auditBefore = await auditCount("ObjectPermissionRemoved", "object_permission");

      const res = await authDelete(tAdminA, "/permissions/object").send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(204);
      expect(await objectRowCount(subject.id, objectId)).toBe(0);
      expect(await auditCount("ObjectPermissionRemoved", "object_permission")).toBe(
        auditBefore + 1,
      );

      // Xoá lần hai: KHÔNG được 204 im lặng (nuốt lỗi) — phải nói rõ không tìm thấy.
      const again = await authDelete(tAdminA, "/permissions/object").send(body);
      expect(again.status, JSON.stringify(again.body)).toBe(404);
    });

    it("DENY: DELETE /permissions/object với role RỖNG → 403 và hàng VẪN CÒN", async () => {
      const subject = await newSubject(A, "objdel-deny");
      const objectId = randomUUID();
      const body = objectBody(subject.id, objectId);
      expect((await authPut(tAdminA, "/permissions/object").send(body)).status).toBe(200);

      const res = await authDelete(tEmptyA, "/permissions/object").send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(await objectRowCount(subject.id, objectId)).toBe(1);
    });

    // ── 11. DELETE /auth/roles/:id ────────────────────────────────────────
    it("ALLOW: xoá role → 200 + THÀNH VIÊN mất quyền (cascade thật) trong khi thành viên role KHÁC vẫn 200", async () => {
      const affected = await newSubject(A, "roledel-ok");
      const keep = await newSubject(A, "roledel-keep");
      const roleDeleted = await newViewUserRole("roledel-ok");
      // `keep` thuộc một role KHÁC cũng mang view:user — chứng minh 403 của `affected` đến từ việc XOÁ
      // role, không phải vì route tự nó không cho ai vào.
      const roleKept = await newViewUserRole("roledel-keep");
      expect(
        (
          await authPost(tAdminA, `/permissions/users/${affected.id}/roles`).send({
            roleId: roleDeleted,
          })
        ).status,
      ).toBe(201);
      expect(
        (await authPost(tAdminA, `/permissions/users/${keep.id}/roles`).send({ roleId: roleKept }))
          .status,
      ).toBe(201);

      const res = await authDelete(tAdminA, `/auth/roles/${roleDeleted}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expect((await authGet(keep.token, "/auth/users")).status).toBe(200);
      expect((await authGet(affected.token, "/auth/users")).status).toBe(403);
    });

    it("DENY: xoá role với role RỖNG → 403 và role vẫn dùng được", async () => {
      const subject = await newSubject(A, "roledel-deny");
      const roleId = await newViewUserRole("roledel-deny");
      expect(
        (await authPost(tAdminA, `/permissions/users/${subject.id}/roles`).send({ roleId })).status,
      ).toBe(201);

      const res = await authDelete(tEmptyA, `/auth/roles/${roleId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect((await authGet(subject.token, "/auth/users")).status).toBe(200);
    });

    it("404: xoá role id không tồn tại → 404; CROSS-TENANT: admin B xoá role của A → 404 và role còn sống", async () => {
      const roleId = await newViewUserRole("roledel-cross");
      const ghost = await authDelete(tAdminA, `/auth/roles/${randomUUID()}`);
      expect(ghost.status, JSON.stringify(ghost.body)).toBe(404);

      const crossed = await authDelete(tAdminB, `/auth/roles/${roleId}`);
      expect(crossed.status, JSON.stringify(crossed.body)).toBe(404);
      expect(crossed.body.message).toEqual(ghost.body.message);

      // Role của A còn sống: gán cho subject vẫn nâng được quyền.
      const subject = await newSubject(A, "roledel-crosschk");
      expect(
        (await authPost(tAdminA, `/permissions/users/${subject.id}/roles`).send({ roleId })).status,
      ).toBe(201);
      expect((await authGet(subject.token, "/auth/users")).status).toBe(200);
    });

    // ── 12. DELETE /auth/roles/:id/permissions ────────────────────────────
    it("ALLOW: gỡ grant khỏi role → 204 + thành viên mất quyền + grant biến khỏi GET :id/permissions", async () => {
      const affected = await newSubject(A, "permrev-ok");
      const keep = await newSubject(A, "permrev-keep");
      const roleId = await newViewUserRole("permrev-ok");
      // `keep` ở role KHÁC vẫn giữ nguyên grant — đối chứng chống 403 xanh rỗng.
      const roleKept = await newViewUserRole("permrev-keep");
      expect(
        (await authPost(tAdminA, `/permissions/users/${affected.id}/roles`).send({ roleId }))
          .status,
      ).toBe(201);
      expect(
        (await authPost(tAdminA, `/permissions/users/${keep.id}/roles`).send({ roleId: roleKept }))
          .status,
      ).toBe(201);

      const res = await authDelete(tAdminA, `/auth/roles/${roleId}/permissions`).send({
        action: PAIRS.viewUser.action,
        resourceType: PAIRS.viewUser.resource,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(204);

      expect((await authGet(keep.token, "/auth/users")).status).toBe(200);
      expect((await authGet(affected.token, "/auth/users")).status).toBe(403);
      const listed = await authGet(tAdminA, `/auth/roles/${roleId}/permissions`);
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      // Envelope: data = { grants: [...] } (RolePermissionGrantsDto), KHÔNG phải mảng phẳng.
      const pairs = (
        listed.body.data.grants as Array<{ action: string; resourceType: string }>
      ).map((g) => `${g.action}:${g.resourceType}`);
      expect(pairs).not.toContain(`${PAIRS.viewUser.action}:${PAIRS.viewUser.resource}`);
    });

    it("DENY: gỡ grant với role RỖNG → 403 và thành viên GIỮ quyền", async () => {
      const subject = await newSubject(A, "permrev-deny");
      const roleId = await newViewUserRole("permrev-deny");
      expect(
        (await authPost(tAdminA, `/permissions/users/${subject.id}/roles`).send({ roleId })).status,
      ).toBe(201);

      const res = await authDelete(tEmptyA, `/auth/roles/${roleId}/permissions`).send({
        action: PAIRS.viewUser.action,
        resourceType: PAIRS.viewUser.resource,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect((await authGet(subject.token, "/auth/users")).status).toBe(200);
    });

    it("DTO 400 ở BIÊN: body thiếu `action` → 400", async () => {
      const roleId = await newViewUserRole("permrev-dto");
      const res = await authDelete(tAdminA, `/auth/roles/${roleId}/permissions`).send({
        resourceType: PAIRS.viewUser.resource,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });

    it("CROSS-TENANT: admin B gỡ grant khỏi role của A → 404 và thành viên của A GIỮ quyền", async () => {
      const subject = await newSubject(A, "permrev-cross");
      const roleId = await newViewUserRole("permrev-cross");
      expect(
        (await authPost(tAdminA, `/permissions/users/${subject.id}/roles`).send({ roleId })).status,
      ).toBe(201);

      const res = await authDelete(tAdminB, `/auth/roles/${roleId}/permissions`).send({
        action: PAIRS.viewUser.action,
        resourceType: PAIRS.viewUser.resource,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect((await authGet(subject.token, "/auth/users")).status).toBe(200);
    });
  },
);
