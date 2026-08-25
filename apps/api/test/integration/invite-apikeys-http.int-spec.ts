/**
 * S10-QA-ROUTEHTTP-2 (file 1/3) — test HTTP THẬT (supertest) cho 3 route risk=5 còn nợ của
 * `test/foundation/route-http-coverage.e2e-spec.ts`:
 *
 *   risk 5 · POST /users/invite          [UserInvitesController#invite]  perm=invite:user
 *   risk 5 · POST /api-keys              [ApiKeysController#create]      perm=manage:api-key
 *   risk 5 · POST /api-keys/:id/revoke   [ApiKeysController#revoke]      perm=manage:api-key
 *
 * VÌ SAO PHỦ TẦNG SERVICE KHÔNG ĐỦ. Spec sẵn có gọi THẲNG service, nên ba lớp CHỈ tồn tại trên đường
 * HTTP chưa từng chạy cho các route này:
 *   (1) `PermissionGuard` (cổng sensitive: wildcard KHÔNG thoả, cặp phải khớp CHÍNH XÁC),
 *   (2) `ZodValidationPipe` — DTO chặn ở BIÊN, trước khi service thấy dữ liệu,
 *   (3) `ResponseEnvelopeInterceptor` + `AllExceptionsFilter` — hình dạng body + ánh xạ mã HTTP.
 * App test dựng ĐÚNG như `main.ts`; thiếu pipe thì mọi ca "sai DTO → 400" xanh-giả vì service tự ném
 * 400 vì lý do KHÁC.
 *
 * LUẬT CHỐNG DENY-XANH-RỖNG. Mỗi route có ca ALLOW 2xx THẬT đặt TRƯỚC ca DENY, và ALLOW chứng minh
 * bằng HỆ QUẢ quan sát qua HTTP, không chỉ status code (bài học deny-cases-vacuous-without-allow-case).
 *
 * ⚠️ HỆ QUẢ CỦA api-key KHÔNG PHẢI "key dùng được → hết dùng được". `ApiKeyAuthGuard` ĐÃ BỊ GỠ khỏi
 * `app.module.ts` (CLEAN-DECOUPLE-1 de-media-fy) ⇒ token `mok_` KHÔNG xác thực được request nào; mọi
 * token không-JWT rơi vào `JwtAuthGuard` → 401. Nên hệ quả quan sát được ở đây là: key xuất hiện trong
 * `GET /api-keys` với `revokedAt=null` rồi CHUYỂN sang `revokedAt != null` sau khi revoke — cộng thêm
 * assert BẤT BIẾN #3 (list KHÔNG chứa token plaintext). Viết "key dùng được" sẽ là assert BỊA.
 *
 * ACTOR KHÔNG PHẢI SUPER-ADMIN. Mọi ca dùng actor company-scope thường (super-admin không canonical —
 * test bằng SA là tautology). Ca DENY có HAI hình: (a) role RỖNG ⇒ `deny-default`, (b) role có cặp
 * KHÁC (`view:user`) ⇒ chứng minh cổng khớp ĐÚNG CẶP, không phải "có grant nào cũng qua".
 *
 * KHÔNG seed cặp wildcard `*:*`: `permissions` là catalog TOÀN CỤC (không company_id, cleanupTenants
 * KHÔNG dọn) ⇒ thêm `*:*` là đóng dấu VĨNH VIỄN lên lane DB dùng chung của CI.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5). FIXTURE giống-secret ghép chuỗi qua helper dùng chung.
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
const LOGIN_PW = loginPasswordFixture("s10rh2f1");

/** Cặp quyền dùng trong file này + cờ is_sensitive THẬT của catalog (đo trên lane DB, không đoán). */
const PAIRS = {
  invite: { action: "invite", resource: "user", sensitive: true },
  approve: { action: "approve", resource: "user", sensitive: true },
  apiKey: { action: "manage", resource: "api-key", sensitive: true },
  viewUser: { action: "view", resource: "user", sensitive: false },
  viewPermission: { action: "view", resource: "permission", sensitive: false },
} as const;

interface PermissionPair {
  action: string;
  resource: string;
  sensitive: boolean;
}

describe.skipIf(!hasLaneDb)(
  "S10-QA-ROUTEHTTP-2 — HTTP thật: users/invite + api-keys (create · revoke)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let tAdminA = "";
    let tEmptyA = "";
    let tWrongPairA = "";
    let tAdminB = "";
    /** permission id của `manage:api-key` — scope hợp lệ (⊆ grant của admin). */
    let permApiKeyId = "";
    /** permission id `view:permission` — admin KHÔNG có ⇒ dùng cho ca "scope vượt quyền". */
    let permViewPermissionId = "";

    const http = () => request(app.getHttpServer());
    const authGet = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
    const authPost = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);

    async function login(slug: string, email: string): Promise<string> {
      const res = await http().post("/auth/login").send({
        companySlug: slug,
        email,
        password: LOGIN_PW,
      });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    /** Tạo user + role riêng, grant đúng các cặp yêu cầu, trả token đã đăng nhập. */
    async function actor(
      tenant: SeededTenant,
      tag: string,
      pairs: ReadonlyArray<PermissionPair>,
    ): Promise<string> {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `${tag}-${randomUUID().slice(0, 8)}@s10rh2f1.local`;
      const userId = await seedUser(direct, tenant.companyId, email, hash);
      const roleId = await seedRole(
        direct,
        tenant.companyId,
        `s10rh2f1-${tag}-${randomUUID().slice(0, 8)}`,
      );
      for (const p of pairs) {
        const permId = await seedPermissionCatalog(direct, p.action, p.resource, p.sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, userId, roleId, tenant.companyId);
      return login(tenant.slug, email);
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      // Mirror main.ts: Zod validate ở BIÊN → envelope → filter.
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10rh2f1a");
      B = await seedCompany(direct, "s10rh2f1b");
      companyIds.push(A.companyId, B.companyId);

      permApiKeyId = await seedPermissionCatalog(
        direct,
        PAIRS.apiKey.action,
        PAIRS.apiKey.resource,
        PAIRS.apiKey.sensitive,
      );
      permViewPermissionId = await seedPermissionCatalog(
        direct,
        PAIRS.viewPermission.action,
        PAIRS.viewPermission.resource,
        PAIRS.viewPermission.sensitive,
      );

      tAdminA = await actor(A, "admin", [PAIRS.invite, PAIRS.approve, PAIRS.apiKey]);
      tEmptyA = await actor(A, "empty", []);
      tWrongPairA = await actor(A, "wrongpair", [PAIRS.viewUser]);
      tAdminB = await actor(B, "adminb", [PAIRS.invite, PAIRS.approve, PAIRS.apiKey]);
    }, 180_000);

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app?.close();
    });

    // ── 1. POST /users/invite ─────────────────────────────────────────────
    const inviteEmail = () => `invitee-${randomUUID().slice(0, 8)}@s10rh2f1.local`;

    it("ALLOW: POST /users/invite → 201 + lời mời THẬT xuất hiện ở GET /users/pending", async () => {
      const email = inviteEmail();
      const res = await authPost(tAdminA, "/users/invite").send({ email, fullName: "Nguyen Test" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      // Envelope: data = { invite, emailSent } (createUserInviteResultSchema) — KHÔNG phẳng.
      expect(res.body.data.invite).toMatchObject({ email, status: "pending" });
      // Token/hash KHÔNG được lọt vào DTO (BẤT BIẾN #3).
      expect(JSON.stringify(res.body)).not.toContain("tokenHash");

      // HỆ QUẢ quan sát qua HTTP — không chỉ status code.
      const pending = await authGet(tAdminA, "/users/pending");
      expect(pending.status, JSON.stringify(pending.body)).toBe(200);
      const emails = (pending.body.data.invites as Array<{ email: string }>).map((r) => r.email);
      expect(emails).toContain(email);
    });

    it("DENY: POST /users/invite với role RỖNG → 403 (deny-default)", async () => {
      const res = await authPost(tEmptyA, "/users/invite").send({
        email: inviteEmail(),
        fullName: "Nguyen Test",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("DENY: POST /users/invite với cặp KHÁC (view:user) → 403 — cổng khớp ĐÚNG CẶP", async () => {
      const res = await authPost(tWrongPairA, "/users/invite").send({
        email: inviteEmail(),
        fullName: "Nguyen Test",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("DTO 400 ở BIÊN: POST /users/invite email sai định dạng → 400 (Zod chạy TRƯỚC service)", async () => {
      const res = await authPost(tAdminA, "/users/invite").send({
        email: "khong-phai-email",
        fullName: "Nguyen Test",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });

    it("TENANT: cùng email mời được ở CẢ hai công ty — lời mời của A không chặn B", async () => {
      const email = inviteEmail();
      const inA = await authPost(tAdminA, "/users/invite").send({ email, fullName: "Trung Ten" });
      expect(inA.status, JSON.stringify(inA.body)).toBe(201);
      const inB = await authPost(tAdminB, "/users/invite").send({ email, fullName: "Trung Ten" });
      expect(inB.status, JSON.stringify(inB.body)).toBe(201);

      // Hàng đợi của B KHÔNG thấy lời mời của A: đúng 1 hàng khớp email trong tenant B.
      const pendingB = await authGet(tAdminB, "/users/pending");
      const matchedB = (pendingB.body.data.invites as Array<{ email: string }>).filter(
        (r) => r.email === email,
      );
      expect(matchedB).toHaveLength(1);
    });

    it("CONFLICT: mời TRÙNG email trong CÙNG công ty → 409 (không nuốt lỗi thành 201)", async () => {
      const email = inviteEmail();
      const first = await authPost(tAdminA, "/users/invite").send({ email, fullName: "Trung A" });
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      const dup = await authPost(tAdminA, "/users/invite").send({ email, fullName: "Trung A" });
      expect(dup.status, JSON.stringify(dup.body)).toBe(409);
    });

    // ── 2. POST /api-keys ─────────────────────────────────────────────────
    it("ALLOW: POST /api-keys → 201 + token mok_ ĐÚNG 1 LẦN; GET /api-keys thấy key nhưng KHÔNG có token", async () => {
      const res = await authPost(tAdminA, "/api-keys").send({
        name: `pat-${randomUUID().slice(0, 8)}`,
        scopePermissionIds: [permApiKeyId],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const token = res.body.data.token as string;
      expect(token.startsWith("mok_")).toBe(true);
      expect(res.body.data.apiKey).toMatchObject({ revokedAt: null });
      expect(JSON.stringify(res.body.data.apiKey)).not.toContain(token);

      // HỆ QUẢ: key có trong list, và list KHÔNG mang token material (BẤT BIẾN #3).
      const list = await authGet(tAdminA, "/api-keys");
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      const ids = (list.body.data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toContain(res.body.data.apiKey.id);
      expect(JSON.stringify(list.body)).not.toContain(token);
    });

    it("DENY: POST /api-keys với role RỖNG → 403", async () => {
      const res = await authPost(tEmptyA, "/api-keys").send({
        name: "pat-deny",
        scopePermissionIds: [permApiKeyId],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    /**
     * ✅ ĐÃ VÁ — S10-FND-BODYVALIDATE-1 đóng KI-068 (24/08/2026). Ca này TỪNG là ghim bug và đã được
     * LẬT từ `expect(500)` sang `expect(400)` đúng như docblock cũ dặn.
     *
     * Bug cũ, giữ lại vì nó giải thích vì sao ca này tồn tại: `@Body() dto: CreateApiKeyRequest` là
     * **TYPE** (`z.infer`), không phải class `createZodDto` ⇒ metatype lúc chạy là `Object` ⇒
     * `ZodValidationPipe` (kể cả bản `@UsePipes` CẤP CLASS) không có schema để chiếu ⇒ body đi thẳng
     * vào handler ⇒ handler tự `.parse()` ném `ZodError` THÔ ⇒ `AllExceptionsFilter` chỉ hiểu
     * `ZodValidationException` của nestjs-zod ⇒ rơi nhánh **500**.
     *
     * Bản vá: `CreateApiKeyDto extends createZodDto(createApiKeyRequestSchema)` (`api-keys.dto.ts`) —
     * class THẬT ⇒ metatype tồn tại ⇒ pipe chặn ở BIÊN. `.parse()` thủ công trong handler đã bỏ.
     *
     * ⚠️ NGƯỠNG CHỐNG NỚI: assert PHẢI ở lại `400` đơn trị. Nếu ai đó gặp ca này đỏ và sửa thành
     * `expect([400, 500]).toContain(...)` thì lỗ KI-068 mở lại mà sổ vẫn ghi ĐÓNG
     * ([[tests-can-pin-a-hole-open]]).
     */
    it("KI-068 ĐÃ ĐÓNG: POST /api-keys scopePermissionIds RỖNG → 400 ở BIÊN, KHÔNG phải 500", async () => {
      const res = await authPost(tAdminA, "/api-keys").send({
        name: "pat-empty-scope",
        scopePermissionIds: [],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      // Ghim CẢ hình dạng lỗi: `ZodError` THÔ là hiện vật của đường 500 cũ. Nếu nó quay lại thì bản vá
      // đã tuột dù status tình cờ vẫn 400.
      expect(res.body.error?.type, JSON.stringify(res.body)).not.toBe("ZodError");
    });

    it("400: scope VƯỢT quyền actor → 400 (chặn PAT leo thang, nhánh service đi qua HTTP)", async () => {
      const res = await authPost(tAdminA, "/api-keys").send({
        name: "pat-exceeds",
        scopePermissionIds: [permViewPermissionId],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(JSON.stringify(res.body)).toContain("vượt quyền");
    });

    // ── 3. POST /api-keys/:id/revoke ──────────────────────────────────────
    async function createKey(token: string): Promise<string> {
      const res = await authPost(token, "/api-keys").send({
        name: `pat-${randomUUID().slice(0, 8)}`,
        scopePermissionIds: [permApiKeyId],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.apiKey.id as string;
    }

    it("ALLOW: POST /api-keys/:id/revoke → 200 + revokedAt THẬT đổi trong GET /api-keys", async () => {
      const id = await createKey(tAdminA);
      const before = await authGet(tAdminA, "/api-keys");
      const rowBefore = (before.body.data as Array<{ id: string; revokedAt: string | null }>).find(
        (r) => r.id === id,
      );
      expect(rowBefore?.revokedAt).toBeNull();

      const res = await authPost(tAdminA, `/api-keys/${id}/revoke`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.revokedAt).not.toBeNull();

      const after = await authGet(tAdminA, "/api-keys");
      const rowAfter = (after.body.data as Array<{ id: string; revokedAt: string | null }>).find(
        (r) => r.id === id,
      );
      expect(rowAfter?.revokedAt).not.toBeNull();
    });

    it("DENY: POST /api-keys/:id/revoke với role RỖNG → 403 (guard chặn TRƯỚC khi chạm hàng)", async () => {
      const id = await createKey(tAdminA);
      const res = await authPost(tEmptyA, `/api-keys/${id}/revoke`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("CROSS-TENANT: admin công ty B revoke key của A → 404 GIỐNG HỆT id không tồn tại (không rò tồn tại)", async () => {
      const idOfA = await createKey(tAdminA);
      const crossed = await authPost(tAdminB, `/api-keys/${idOfA}/revoke`);
      const ghost = await authPost(tAdminB, `/api-keys/${randomUUID()}/revoke`);
      expect(crossed.status, JSON.stringify(crossed.body)).toBe(404);
      expect(ghost.status).toBe(404);
      // Thông điệp phải TRÙNG — khác nhau là một oracle cho phép dò id tồn tại ở tenant khác.
      expect(crossed.body.message).toEqual(ghost.body.message);

      // Và key của A vẫn CHƯA bị thu hồi (B không chạm được hàng của A).
      const list = await authGet(tAdminA, "/api-keys");
      const row = (list.body.data as Array<{ id: string; revokedAt: string | null }>).find(
        (r) => r.id === idOfA,
      );
      expect(row?.revokedAt).toBeNull();
    });

    it("400: :id không phải UUID → 400 ở ParseUUIDPipe (không tới service)", async () => {
      const res = await authPost(tAdminA, "/api-keys/khong-phai-uuid/revoke");
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });
  },
);
