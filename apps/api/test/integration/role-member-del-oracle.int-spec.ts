/**
 * S10-SEC-ROLEMEMBERDEL-1 (KI-074) — CROWN-JEWEL. Tín hiệu VẮNG MẶT của tư cách thành viên role trên
 * `DELETE /permissions/users/:userId/roles/:roleId`, đo ở tầng HTTP THẬT.
 *
 * CHỦ TRƯƠNG ĐÃ KÝ 2026-08-24 — hướng (b), `docs/DECISIONS/DECISIONS-10_Role_Membership_Absence_Signal.md`:
 * GIỮ **404** cho actor có `view:user` ở scope `Company`/`System`; **204** cho phần còn lại.
 *
 * VÌ SAO FILE RIÊNG (không nhét vào `identity-projection-scope.int-spec.ts`): ca ALLOW ở đây **gỡ vai
 * THẬT**, làm hỏng fixture thành viên mà suite kia dựa vào (`roleOther` phải CÓ thành viên, nếu không
 * R-T1/R-T2 xanh rỗng). Tự seed, tự dọn.
 *
 * TẦNG NÀY đo cái mà tầng unit (`src/permission/permission-admin.ki074.spec.ts`) KHÔNG đo được, vì ở
 * đó resolver bị mock:
 *   • **4 hình dạng wildcard** của cặp `view:user` trên ENGINE thật (D-W1..W4) —
 *     `action IN ('view','*') AND resource_type IN ('user','*')`, HAI VẾ ĐỘC LẬP;
 *   • **exact THẮNG wildcard** (D-W4): `*:*@Company` + `view:user@Own` ⇒ TỤT xuống 204;
 *   • **`is_sensitive` của catalog là một CỔNG** của route (D-S1);
 *   • **ba lớp role** của ranh (2): tenant khác / system / operator (D-X1/X2/X3).
 *
 * ⚠️ ACTOR KHÔNG PHẢI SUPER-ADMIN. SA được `SuperAdminBootstrapRepository.grantPermissionWithScope`
 * cấp toàn catalog ở `data_scope='System'` ⇒ mọi ca DENY sẽ là tautology.
 *
 * ⚠️ PROD 2026-08-24 đo được **0 vai** giữ `view:user` hẹp hơn `Company` ⇒ hình dạng lỗ phải **TỰ
 * GIEO**, không nghiệm thu được bằng dữ liệu thật.
 *
 * ⚠️ Cache quyền TTL 300s + scheduler TẮT khi `NODE_ENV='test'` ⇒ mỗi actor gọi route BỊ GATE đúng
 * một lần, cache-lạnh. `resolveStrongestScope` đọc `getCompanyRoleGrantsWithScope` (KHÔNG cache) nên
 * không dính bẫy này, nhưng `assertCan` thì có.
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
import { OPERATOR_ROLE_IDS } from "../../src/permission/operator-roles";
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
const LOGIN_PW = loginPasswordFixture("ki074del");

/**
 * ⚠️ LITERAL CÓ CHỦ ĐÍCH — đừng import hằng số của `src/**` vào đây. Spec seed grant theo cặp NÀY rồi
 * gọi route thật; nếu nó đọc chính hằng số mà service đọc thì hai vế không bao giờ lệch được.
 */
const VIEW_USER = { action: "view", resource: "user", sensitive: false } as const;
const ASSIGN_ROLE = { action: "assign-role", resource: "user", sensitive: true } as const;

type Scope = "Own" | "Team" | "Department" | "Company" | "System";
/** Một grant để gieo: cặp (có thể wildcard) + scope. */
interface GrantSpec {
  action: string;
  resource: string;
  sensitive: boolean;
  scope: Scope;
}

describe.skipIf(!hasLaneDb)(
  "S10-SEC-ROLEMEMBERDEL-1 (KI-074) — DELETE role-member: 404 CÓ ĐIỀU KIỆN, không phải 204 mù",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];
    const password = new PasswordService();

    const http = () => request(app.getHttpServer());
    const authGet = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
    const authPost = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
    const authDelete = (t: string, u: string) =>
      http().delete(u).set("Authorization", `Bearer ${t}`);

    async function login(slug: string, email: string): Promise<string> {
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    /** User trần + token. */
    async function newUser(tenant: SeededTenant, tag: string) {
      const email = `${tag}-${randomUUID().slice(0, 8)}@ki074.local`;
      const id = await seedUser(direct, tenant.companyId, email, await password.hash(LOGIN_PW));
      return { id, email, slug: tenant.slug };
    }

    /** User + một role mang đúng tập grant đã cho + token đăng nhập sau khi gắn role. */
    async function actorWith(tenant: SeededTenant, tag: string, grants: readonly GrantSpec[]) {
      const u = await newUser(tenant, tag);
      const roleId = await seedRole(
        direct,
        tenant.companyId,
        `ki074-${tag}-${randomUUID().slice(0, 8)}`,
      );
      for (const g of grants) {
        const permId = await seedPermissionCatalog(direct, g.action, g.resource, g.sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", g.scope);
      }
      await seedUserRole(direct, u.id, roleId, tenant.companyId);
      return { ...u, roleId, token: await login(tenant.slug, u.email) };
    }

    const assignAtCompany: GrantSpec = { ...ASSIGN_ROLE, scope: "Company" };
    const viewUserAt = (scope: Scope): GrantSpec => ({ ...VIEW_USER, scope });

    // ── lưới ──────────────────────────────────────────────────────────────
    /** `view:user@Company` — hình dạng PROD của người trực ca. GIỮ 404. */
    let aCompany: Awaited<ReturnType<typeof actorWith>>;
    /** `view:user@Own` — hình dạng LỖ. Tự gieo (PROD 0 vai). → 204. */
    let aOwn: Awaited<ReturnType<typeof actorWith>>;
    /** KHÔNG có `view:user` ⇒ resolver trả `null` ⇒ 204 (ranh 1). */
    let aNoDir: Awaited<ReturnType<typeof actorWith>>;

    /** Role đích — PHẢI mang một cặp quyền THẬT để D-A0/D-A3 đo được hệ quả, không assert suông. */
    let roleTarget = "";
    /**
     * ⚠️ BA người giữ `roleTarget`, không phải hai — và mỗi người gọi route BỊ GATE đúng MỘT LẦN.
     *
     * Cache quyền (`CachedPermissionRepository`, TTL 300s) chỉ bị xoá khi `permission.changed` được
     * GIAO qua outbox, mà `worker-scheduler.service.ts:37` TẮT mọi interval khi `NODE_ENV='test'`
     * ⇒ trong int-spec KHÔNG ai tick outbox ⇒ mục cache đọc TRƯỚC khi gỡ vai sẽ sống tới hết TTL.
     * Đo "cùng một user, trước rồi sau" vì thế đo TRÚNG CACHE CŨ, không đo quyết định mới (bản đầu
     * của ca này đã đỏ đúng như vậy: 200 thay vì 403 — kể cả sau khi đăng nhập LẠI, vì cache khoá
     * theo user chứ không theo token).
     *
     * Nên tách vai trò: `prover` chứng minh `roleTarget` THẬT SỰ cấp quyền (ALLOW đối chứng),
     * `victim` bị gỡ, `keep` không bị gỡ — cả `victim` lẫn `keep` đều CACHE-LẠNH cho tới sau D-A1.
     */
    let prover: Awaited<ReturnType<typeof newUser>> & { token: string };
    /** Giữ `roleTarget`, sẽ bị gỡ ở D-A1. CACHE-LẠNH tới D-A3. */
    let victim: Awaited<ReturnType<typeof newUser>> & { token: string };
    /** Cũng giữ `roleTarget`, KHÔNG bị gỡ — đối chứng chặn D-A3 xanh vì lý do khác. CACHE-LẠNH. */
    let keep: Awaited<ReturnType<typeof newUser>> & { token: string };
    /** KHÔNG giữ `roleTarget` — chủ thể của mọi ca nhánh ÂM. */
    let stranger: Awaited<ReturnType<typeof newUser>>;

    /** Role company-scoped của tenant B — ranh (2) hàng 1. KHÔNG dùng system role ở đây. */
    let roleTenantB = "";
    /** Role SYSTEM (`company_id IS NULL`) — ranh (2) hàng 2. */
    let roleSystem = "";

    const delUrl = (userId: string, roleId: string) =>
      `/permissions/users/${userId}/roles/${roleId}`;

    // ── đếm có LỌC (không đếm toàn cục — lane DB dùng chung, [[parallel-int-specs-share-one-outbox]]) ──
    /**
     * ⚠️ CỐ Ý KHÔNG lọc `object_type='user_role'`: đã có `company_id` + `actor_user_id` thì thêm vế
     * đó chỉ làm assert HẸP đi — một hồi quy ghi audit giả dưới `object_type` KHÁC sẽ vô hình.
     * Bỏ vế đó là chặt hơn và không tốn gì (FULL gate security-reviewer).
     */
    async function countAuditBy(actorUserId: string): Promise<number> {
      const r = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_logs
          WHERE company_id=$1 AND actor_user_id=$2`,
        [A.companyId, actorUserId],
      );
      return Number(r.rows[0].n);
    }
    async function countSecurityEventsFor(userId: string): Promise<number> {
      const r = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM user_security_events
          WHERE company_id=$1 AND user_id=$2`,
        [A.companyId, userId],
      );
      return Number(r.rows[0].n);
    }
    async function countOutboxFor(userId: string): Promise<number> {
      const r = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM outbox_events
          WHERE event_type='permission.changed'
            AND payload->>'companyId'=$1 AND payload->>'userId'=$2`,
        [A.companyId, userId],
      );
      return Number(r.rows[0].n);
    }
    async function countActiveUserRoles(userId: string, roleId: string): Promise<number> {
      const r = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM user_roles
          WHERE company_id=$1 AND user_id=$2 AND role_id=$3 AND deleted_at IS NULL`,
        [A.companyId, userId, roleId],
      );
      return Number(r.rows[0].n);
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "ki074a");
      B = await seedCompany(direct, "ki074b");
      companyIds.push(A.companyId, B.companyId);

      aCompany = await actorWith(A, "company", [assignAtCompany, viewUserAt("Company")]);
      aOwn = await actorWith(A, "own", [assignAtCompany, viewUserAt("Own")]);
      aNoDir = await actorWith(A, "nodir", [assignAtCompany]);

      // Role đích mang `view:user@Company` THẬT ⇒ thành viên của nó gọi được `GET /auth/users`.
      // Đó là hệ quả quan sát được của D-A1, thay cho một assert suông "đã gỡ".
      roleTarget = await seedRole(direct, A.companyId, `ki074-target-${randomUUID().slice(0, 8)}`);
      const viewUserPermId = await seedPermissionCatalog(
        direct,
        VIEW_USER.action,
        VIEW_USER.resource,
        VIEW_USER.sensitive,
      );
      await seedRolePermission(direct, roleTarget, viewUserPermId, "ALLOW", "Company");

      const p = await newUser(A, "prover");
      prover = { ...p, token: "" };
      await seedUserRole(direct, prover.id, roleTarget, A.companyId);
      prover.token = await login(A.slug, prover.email);

      const v = await newUser(A, "victim");
      victim = { ...v, token: "" };
      await seedUserRole(direct, victim.id, roleTarget, A.companyId);
      victim.token = await login(A.slug, victim.email);

      const k = await newUser(A, "keep");
      keep = { ...k, token: "" };
      await seedUserRole(direct, keep.id, roleTarget, A.companyId);
      keep.token = await login(A.slug, keep.email);

      stranger = await newUser(A, "stranger");

      roleTenantB = await seedRole(direct, B.companyId, `ki074-b-${randomUUID().slice(0, 8)}`);

      // Role SYSTEM: `company_id IS NULL` ⇒ RLS `roles_tenant_isolation` (vế `OR company_id IS NULL`)
      // cho MỌI tenant thấy. `seedRole` gắn company nên phải INSERT tay.
      const sysName = `ki074-system-${randomUUID().slice(0, 8)}`;
      const sys = await direct.query<{ id: string }>(
        `INSERT INTO roles (company_id, name, description) VALUES (NULL, $1, $2) RETURNING id`,
        [sysName, "KI-074 fixture — system role"],
      );
      roleSystem = sys.rows[0].id;
    }, 180_000);

    afterAll(async () => {
      // `roles` company_id IS NULL không thuộc tenant nào ⇒ cleanupTenants KHÔNG dọn. Dọn tay.
      if (roleSystem) {
        await direct.query(`DELETE FROM user_roles WHERE role_id = $1`, [roleSystem]);
        await direct.query(`DELETE FROM roles WHERE id = $1`, [roleSystem]);
      }
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app?.close();
    });

    // ── D-S1: cờ catalog là một CỔNG của route ────────────────────────────
    it("D-S1 — `view:user` là is_sensitive=FALSE; lật cờ này biến route thành 204-mù trong im lặng", async () => {
      // `resolveStrongestScope` tính effectivelySensitive = (opts?.isSensitive ?? false) ||
      // allowMatches.some(g => g.isSensitive) — vế thứ HAI đọc CATALOG. Chỉ cần một grant khớp
      // ('view','user') — kể cả hàng ('*','*') — có is_sensitive=true là toàn bộ resolution rơi về
      // nhánh exact-only ⇒ mọi actor wildcard-only tụt `null` ⇒ 204 ⇒ MẤT tín hiệu 404.
      // ⇒ Bản vá KI-074 đúng nhờ DỮ LIỆU này, không nhờ code. Migration nào định lật nó phải đọc
      // DECISIONS-10 §6 trước.
      const r = await direct.query<{ action: string; is_sensitive: boolean }>(
        `SELECT action, is_sensitive FROM permissions
          WHERE (action, resource_type) IN (('view','user'), ('*','*'))`,
      );
      expect(
        r.rows.length,
        "catalog thiếu cặp ('view','user') — seed hỏng, không phải cờ đổi",
      ).toBeGreaterThan(0);
      for (const row of r.rows) {
        expect(
          row.is_sensitive,
          `cặp khớp view:user có is_sensitive=true (action=${row.action})`,
        ).toBe(false);
      }
    });

    // ── nhánh ÂM: `stranger` KHÔNG giữ `roleTarget` ───────────────────────
    it("D-A2 — actor `view:user@Company` vẫn nhận 404 (tín hiệu vận hành mà auth-users-api.ts:136 dựa vào)", async () => {
      const res = await authDelete(aCompany.token, delUrl(stranger.id, roleTarget));
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("D-N1 + D-N2 — actor `view:user@Own` nhận 204 IM LẶNG, và KHÔNG ghi một hàng nào (ranh 3)", async () => {
      const auditBefore = await countAuditBy(aOwn.id);
      const secBefore = await countSecurityEventsFor(stranger.id);
      const outboxBefore = await countOutboxFor(stranger.id);
      const rowsBefore = await countActiveUserRoles(stranger.id, roleTarget);

      const res = await authDelete(aOwn.token, delUrl(stranger.id, roleTarget));
      expect(res.status, JSON.stringify(res.body)).toBe(204);

      // Δ0 trên CẢ BỐN đường ghi. Đếm có LỌC theo actor/subject — đếm toàn cục trên lane DB dùng
      // chung là flaky ([[parallel-int-specs-share-one-outbox]]).
      expect(await countAuditBy(aOwn.id), "audit_logs").toBe(auditBefore);
      expect(await countSecurityEventsFor(stranger.id), "user_security_events").toBe(secBefore);
      expect(await countOutboxFor(stranger.id), "outbox permission.changed").toBe(outboxBefore);
      expect(await countActiveUserRoles(stranger.id, roleTarget), "user_roles").toBe(rowsBefore);
    });

    it("D-N3 — actor KHÔNG có `view:user` (resolver → null) nhận 204, KHÔNG 404 (ranh 1)", async () => {
      // `null` nghĩa "KHÔNG có thẩm quyền", KHÔNG phải Company. Đây là nhánh dễ viết ngược nhất.
      const res = await authDelete(aNoDir.token, delUrl(stranger.id, roleTarget));
      expect(res.status, JSON.stringify(res.body)).toBe(204);
    });

    // ── ranh (2): ba lớp role, ba kết cục ─────────────────────────────────
    it("D-X1 — role company-scoped của TENANT KHÁC ⇒ 404 kể cả actor hẹp (BẤT BIẾN #1)", async () => {
      // ⚠️ PHẢI là role company-scoped của B, KHÔNG phải system role: RLS giấu cái thứ nhất, KHÔNG
      // giấu cái thứ hai. Dùng nhầm là pin nhầm mệnh đề (xem D-X2).
      const res = await authDelete(aOwn.token, delUrl(stranger.id, roleTenantB));
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("D-X2 — role SYSTEM (`company_id IS NULL`) ⇒ 204 với actor hẹp — hành vi ĐƯỢC KÝ, không phải rò", async () => {
      // RLS `roles_tenant_isolation` USING có vế `OR company_id IS NULL` ⇒ system role THẤY ĐƯỢC ở
      // mọi tenant ⇒ `findAssignableRole` trả hàng ⇒ rơi xuống nhánh scope. Không phá ranh (2):
      // system role không thuộc tenant nào. DECISIONS-10 §R2 bảng ba lớp role.
      const res = await authDelete(aOwn.token, delUrl(stranger.id, roleSystem));
      expect(res.status, JSON.stringify(res.body)).toBe(204);
    });

    it("D-X3 — role OPERATOR-audience ⇒ 404 (cạnh duy nhất phân biệt findAssignableRole với SELECT trần)", async () => {
      // `notOperatorRole()` loại `platform-admin` (aud='operator', company_id IS NULL nên RLS KHÔNG
      // giấu). Ai "đơn giản hoá" findAssignableRole thành `WHERE id = :id` sẽ mở đường chạm role
      // control-plane — ca này là thứ duy nhất bắt được.
      const res = await authDelete(aOwn.token, delUrl(stranger.id, OPERATOR_ROLE_IDS[0]));
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("D-X4 — nền của 'D3 không thêm bit nào': POST đã cho bit role-tồn-tại MIỄN PHÍ, hai thông điệp khác nhau", async () => {
      // Nếu ai vá `assignRole` sau này thì lập luận "0 bit mới" của ranh (2) mất nền và phải mở lại.
      // Ca này là chỗ điều đó nổ ra, thay vì im lặng trôi.
      const auditBefore = await countAuditBy(aOwn.id);
      const badRole = await authPost(aOwn.token, `/permissions/users/${stranger.id}/roles`).send({
        roleId: randomUUID(),
      });
      const badUser = await authPost(aOwn.token, `/permissions/users/${randomUUID()}/roles`).send({
        roleId: roleTarget,
      });
      expect(badRole.status).toBe(404);
      expect(badUser.status).toBe(404);
      const msg = (r: { body: { error?: { message?: string }; message?: string } }) =>
        r.body?.error?.message ?? r.body?.message ?? "";
      expect(msg(badRole)).not.toBe(msg(badUser));
      // 0 ghi ở CẢ HAI nhánh — bit đó MIỄN PHÍ, không chỉ "đã lộ". Đây là vế mạnh của lập luận.
      expect(await countAuditBy(aOwn.id), "POST nhánh 404 phải ném TRƯỚC mọi ghi").toBe(
        auditBefore,
      );
    });

    // ── D6: 4 hình dạng wildcard trên ENGINE thật (tầng unit mock resolver nên KHÔNG đo được) ──
    it("D-W1 — `*:*@Company` (không có cặp exact) ⇒ vẫn 404", async () => {
      const a = await actorWith(A, "w-star-star", [
        assignAtCompany,
        { action: "*", resource: "*", sensitive: false, scope: "Company" },
      ]);
      expect((await authDelete(a.token, delUrl(stranger.id, roleTarget))).status).toBe(404);
    });

    it("D-W2 — `view:*@Company` ⇒ 404 (vế resource wildcard)", async () => {
      const a = await actorWith(A, "w-view-star", [
        assignAtCompany,
        { action: "view", resource: "*", sensitive: false, scope: "Company" },
      ]);
      expect((await authDelete(a.token, delUrl(stranger.id, roleTarget))).status).toBe(404);
    });

    it("D-W3 — `*:user@Company` ⇒ 404 (vế action wildcard — HAI VẾ ĐỘC LẬP)", async () => {
      const a = await actorWith(A, "w-star-user", [
        assignAtCompany,
        { action: "*", resource: "user", sensitive: false, scope: "Company" },
      ]);
      expect((await authDelete(a.token, delUrl(stranger.id, roleTarget))).status).toBe(404);
    });

    it("D-W4 — `*:*@Company` + `view:user@Own` ⇒ **204**: exact THẮNG wildcard, TỤT scope (siết có chủ ý)", async () => {
      // Cặp non-sensitive ⇒ `eligible = exact.length > 0 ? exact : allowMatches`
      // (permission.service.ts:606-607). Một vai rộng được cấp THÊM một grant hẹp exact sẽ NGHÈO ĐI
      // ở cặp đó. Hành vi đã ký (DECISIONS-10 §5) — và là thứ mà tầng unit U4 KHÔNG chứng minh được.
      const a = await actorWith(A, "w-exact-wins", [
        assignAtCompany,
        { action: "*", resource: "*", sensitive: false, scope: "Company" },
        viewUserAt("Own"),
      ]);
      expect((await authDelete(a.token, delUrl(stranger.id, roleTarget))).status).toBe(204);
    });

    // ── nhánh DƯƠNG: gỡ THẬT — chặn mọi ca trên khỏi xanh-RỖNG ────────────
    it("D-A0 → D-A1 → D-A3 — actor hẹp GỠ ĐƯỢC THẬT: 204 + tombstone + audit + event + nạn nhân MẤT quyền", async () => {
      // D-A0 (đối chứng ALLOW): `roleTarget` THẬT SỰ cấp quyền đọc `/auth/users`. Thiếu bước này
      // thì 403 ở D-A3 có thể đúng vì nạn nhân CHƯA BAO GIỜ có quyền
      // ([[deny-cases-vacuous-without-allow-case]]).
      // ⚠️ Đo bằng `prover`, KHÔNG bằng `victim`: gọi route bị gate bằng chính victim ở đây sẽ NẠP
      // cache quyền 300s của victim, và D-A3 sẽ đo trúng cache cũ (200) thay vì quyết định mới.
      expect((await authGet(prover.token, "/auth/users")).status, "D-A0 prover").toBe(200);

      const auditBefore = await countAuditBy(aOwn.id);
      const secBefore = await countSecurityEventsFor(victim.id);
      const outboxBefore = await countOutboxFor(victim.id);

      // D-A1: cùng mã 204 như D-N1 — ở tầng HTTP hai nhánh KHÔNG phân biệt được. Đó là mệnh đề của WO.
      const res = await authDelete(aOwn.token, delUrl(victim.id, roleTarget));
      expect(res.status, JSON.stringify(res.body)).toBe(204);

      // Cái phân biệt chúng nằm ở DB — tức ở phía PHÒNG THỦ.
      expect(await countActiveUserRoles(victim.id, roleTarget)).toBe(0);
      const tomb = await direct.query<{ deleted_by: string; id: string }>(
        `SELECT id, deleted_by FROM user_roles
          WHERE company_id=$1 AND user_id=$2 AND role_id=$3 AND deleted_at IS NOT NULL`,
        [A.companyId, victim.id, roleTarget],
      );
      expect(tomb.rows, "tombstone forensic (BẤT BIẾN #2 — KHÔNG hard-delete)").toHaveLength(1);
      expect(tomb.rows[0].deleted_by).toBe(aOwn.id);

      expect(await countAuditBy(aOwn.id)).toBe(auditBefore + 1);
      expect(await countSecurityEventsFor(victim.id)).toBe(secBefore + 1);
      expect(await countOutboxFor(victim.id)).toBe(outboxBefore + 1);

      // audit trỏ ID HÀNG THẬT, không phải một chiếu rút gọn (bất biến #2).
      const audit = await direct.query<{ object_id: string }>(
        `SELECT object_id FROM audit_logs
          WHERE company_id=$1 AND action='RoleRevoked' AND actor_user_id=$2
          ORDER BY created_at DESC LIMIT 1`,
        [A.companyId, aOwn.id],
      );
      expect(audit.rows[0].object_id).toBe(tomb.rows[0].id);

      // D-A3: hệ quả THẬT, đo bằng quyền. Cả hai lần đọc dưới đây là lần ĐẦU của user đó ⇒ đi thẳng
      // vào DB, không qua cache cũ. `keep` = 200 chặn ca `victim` = 403 xanh vì lý do khác (vd cả
      // hai cùng hỏng vì seed sai).
      expect((await authGet(victim.token, "/auth/users")).status, "D-A3 victim sau khi gỡ").toBe(
        403,
      );
      expect((await authGet(keep.token, "/auth/users")).status, "D-A3 keep vẫn giữ").toBe(200);
    });
  },
);
