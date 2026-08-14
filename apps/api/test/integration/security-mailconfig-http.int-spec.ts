/**
 * S10-QA-ROUTEHTTP-1 — test HTTP THẬT (supertest, đi qua guard/DTO/envelope thật) cho 5 route đứng đầu
 * bảng xếp hạng rủi ro ở `route-http-coverage.e2e-spec.ts` mà trước đây CHỈ có test ở tầng service
 * (`security-policy-crud.int-spec.ts` gọi thẳng `service.updatePolicy(...)`, KHÔNG qua HTTP):
 *   GET/PATCH /settings/security-policy · GET/PUT/POST(test) /settings/mail-config.
 *
 * 🔴 PHÁT HIỆN THẬT (không phải test hỏng — hành vi hiện tại của code):
 * `PATCH /settings/security-policy` khai `@RequirePermission(..., { isSensitive: true, requiresReauth:
 * true })`. `PermissionGuard` coi route có cả hai cờ đó là "reveal-secret class" và ép
 * `needsObjectGrant = isSensitive && requiresReauth` (permission.decide.ts:93) — tức bắt buộc một
 * OBJECT-LEVEL ALLOW gắn với `resourceId` cụ thể. Nhưng route này KHÔNG có `:id` param (chính sách bảo
 * mật là 1-hàng/công ty, không phải object có id) nên `resourceId` LUÔN LÀ `null`
 * (permission.guard.ts:122) ⇒ object-tier bị bỏ qua ⇒ `needsObjectGrant` luôn true ⇒ **deny-object-required
 * VĨNH VIỄN cho MỌI actor, kể cả actor có ALLOW company-level đầy đủ**. Toàn bộ codebase KHÔNG có nơi nào
 * gán `req.reauthContext` (grep xác nhận chỉ xuất hiện ở `permission.guard.ts` + spec của chính nó) — nên
 * kể cả nếu object-tier có chạy, `isReauthValid` cũng luôn false. Route này hiện KHÔNG THỂ gọi thành công
 * qua bất kỳ đường nào. Test dưới đây GHIM đúng hành vi hiện tại (403 `deny-object-required` dù actor có
 * đủ quyền company-level) — KHÔNG tự nới guard hay tự thêm reauth wiring (ngoài phạm vi lane QA).
 *
 * GATE CỨNG `hasDb && LANE_DB` — DB cô lập (S10-QA-ROUTEHTTP-1 cần Postgres thật cho withTenant/RLS).
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
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = "Passw0rd!s10qarh1";

describe.skipIf(!hasLaneDb)(
  "S10-QA-ROUTEHTTP-1 — HTTP thật: security-policy + mail-config (5 route top-risk)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];
    let tAdmin = "";
    let tNoPerm = "";

    async function login(slug: string, email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    const authGet = (t: string, u: string) =>
      request(app.getHttpServer()).get(u).set("Authorization", `Bearer ${t}`);
    const authPut = (t: string, u: string) =>
      request(app.getHttpServer()).put(u).set("Authorization", `Bearer ${t}`);
    const authPatch = (t: string, u: string) =>
      request(app.getHttpServer()).patch(u).set("Authorization", `Bearer ${t}`);
    const authPost = (t: string, u: string) =>
      request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "s10qarh1");
      companyIds.push(A.companyId);

      const emailAdmin = `admin-${randomUUID().slice(0, 8)}@s10qarh1.local`;
      const emailNoPerm = `noperm-${randomUUID().slice(0, 8)}@s10qarh1.local`;
      const uAdmin = await seedUser(direct, A.companyId, emailAdmin, hash);
      const uNoPerm = await seedUser(direct, A.companyId, emailNoPerm, hash);

      const roleAdmin = await seedRole(direct, A.companyId, `s10qarh1-admin-${uAdmin.slice(0, 8)}`);
      for (const [action, resource] of [
        ["configure-security-policy", "company"],
        ["configure-mail", "company"],
      ] as const) {
        const permId = await seedPermissionCatalog(direct, action, resource, true);
        await seedRolePermission(direct, roleAdmin, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, uAdmin, roleAdmin, A.companyId);

      // uNoPerm: role tồn tại nhưng KHÔNG grant nào (đo đúng nhánh deny-default, không phải role thiếu).
      const roleEmpty = await seedRole(
        direct,
        A.companyId,
        `s10qarh1-empty-${uNoPerm.slice(0, 8)}`,
      );
      await seedUserRole(direct, uNoPerm, roleEmpty, A.companyId);

      tAdmin = await login(A.slug, emailAdmin);
      tNoPerm = await login(A.slug, emailNoPerm);
    });

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app?.close();
    });

    // ── GET /settings/security-policy ─────────────────────────────────────
    it("ALLOW: GET /settings/security-policy → 200, envelope đúng hình (default khi chưa cấu hình)", async () => {
      const res = await authGet(tAdmin, "/settings/security-policy");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        ipRestrictionEnabled: expect.any(Boolean),
        allowlistCidrs: expect.any(Array),
        timeRestrictionEnabled: expect.any(Boolean),
      });
    });

    it("DENY: GET /settings/security-policy không quyền → 403", async () => {
      const res = await authGet(tNoPerm, "/settings/security-policy");
      expect(res.status).toBe(403);
    });

    // ── PATCH /settings/security-policy — GHIM phát hiện thật (xem docblock đầu file) ──────────────
    it("🔴 PHÁT HIỆN: PATCH /settings/security-policy → 403 deny-object-required NGAY CẢ VỚI actor có ALLOW company-level đầy đủ (route hiện không thể gọi thành công qua HTTP)", async () => {
      const res = await authPatch(tAdmin, "/settings/security-policy").send({
        ipRestrictionEnabled: true,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("DENY: PATCH /settings/security-policy không quyền → 403", async () => {
      const res = await authPatch(tNoPerm, "/settings/security-policy").send({
        ipRestrictionEnabled: true,
      });
      expect(res.status).toBe(403);
    });

    // ── PUT /settings/mail-config ─────────────────────────────────────────
    it("ALLOW: PUT /settings/mail-config upsert → 200/201, envelope KHÔNG lộ password, hasPassword=true", async () => {
      const res = await authPut(tAdmin, "/settings/mail-config").send({
        host: "smtp.s10qarh1.invalid",
        port: 587,
        username: "smtp-user",
        fromEmail: "noreply@s10qarh1.invalid",
        password: "smtp-secret-pw-1",
      });
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      expect(res.body.data.hasPassword).toBe(true);
      expect(res.body.data.password).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain("smtp-secret-pw-1");
    });

    it("DENY: PUT /settings/mail-config không quyền → 403", async () => {
      const res = await authPut(tNoPerm, "/settings/mail-config").send({
        host: "smtp.s10qarh1.invalid",
        port: 587,
        username: "smtp-user",
        fromEmail: "noreply@s10qarh1.invalid",
        password: "smtp-secret-pw-1",
      });
      expect(res.status).toBe(403);
    });

    it("400: PUT /settings/mail-config port ngoài range (DTO Zod chặn ở HTTP boundary, không phải service)", async () => {
      const res = await authPut(tAdmin, "/settings/mail-config").send({
        host: "smtp.s10qarh1.invalid",
        port: 0,
        username: "smtp-user",
        fromEmail: "noreply@s10qarh1.invalid",
        password: "smtp-secret-pw-1",
      });
      expect(res.status).toBe(400);
    });

    // ── GET /settings/mail-config ─────────────────────────────────────────
    it("ALLOW: GET /settings/mail-config → 200, danh sách config KHÔNG lộ password", async () => {
      const res = await authGet(tAdmin, "/settings/mail-config");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(Array.isArray(res.body.data.configs)).toBe(true);
      expect(res.body.data.configs.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.body)).not.toContain("smtp-secret-pw-1");
    });

    it("DENY: GET /settings/mail-config không quyền → 403", async () => {
      const res = await authGet(tNoPerm, "/settings/mail-config");
      expect(res.status).toBe(403);
    });

    // ── POST /settings/mail-config/test ─────────────────────────────────────
    it("ALLOW: POST /settings/mail-config/test host không kết nối được → 2xx + { ok:false } (KHÔNG throw, KHÔNG lộ credential)", async () => {
      const res = await authPost(tAdmin, "/settings/mail-config/test").send({
        host: "127.0.0.1",
        port: 65500,
        username: "smtp-user",
        password: "smtp-secret-pw-probe",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.ok).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain("smtp-secret-pw-probe");
    });

    it("DENY: POST /settings/mail-config/test không quyền → 403", async () => {
      const res = await authPost(tNoPerm, "/settings/mail-config/test").send({
        host: "127.0.0.1",
        port: 65500,
        username: "smtp-user",
        password: "smtp-secret-pw-probe",
      });
      expect(res.status).toBe(403);
    });
  },
);
