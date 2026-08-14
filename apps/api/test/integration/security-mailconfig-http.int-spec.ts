/**
 * S10-QA-ROUTEHTTP-1 — test HTTP THẬT (supertest, đi qua guard/DTO/envelope thật) cho 5 route đứng đầu
 * bảng xếp hạng rủi ro ở `route-http-coverage.e2e-spec.ts` mà trước đây CHỈ có test ở tầng service
 * (`security-policy-crud.int-spec.ts` gọi thẳng `service.updatePolicy(...)`, KHÔNG qua HTTP):
 *   GET/PATCH /settings/security-policy · GET/PUT/POST(test) /settings/mail-config.
 *
 * ĐẾM ĐÚNG ĐỘ PHỦ (đừng thổi số): file này phủ THẬT 4 route — PUT /settings/mail-config (risk 5) ·
 * POST /settings/mail-config/test (risk 5) · GET /settings/security-policy (risk 3) ·
 * GET /settings/mail-config (risk 3). `PATCH /settings/security-policy` (risk 5) **KHÔNG tính là đã
 * phủ**: nó chỉ có ca GHIM BUG 403, không có và không thể có ca ALLOW 2xx cho tới khi KI-065 được sửa.
 *
 * 🔴 PHÁT HIỆN THẬT (không phải test hỏng — hành vi hiện tại của code) — KI-065 (RELEASE-02),
 * sửa ở WO kế thừa S10-QA-ROUTEHTTP-2:
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
 * Ca ghim assert cả LÝ DO deny, không chỉ status: xem khối comment ngay trên ca đó.
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
import { loginPasswordFixture, smtpPasswordFixture } from "../helpers/fixture-secrets";
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

// Fixture giống-secret PHẢI ghép chuỗi qua helper dùng chung (CLAUDE.md §5) — không literal trong spec.
// SMTP_PW_STORED / SMTP_PW_PROBE cố ý dùng hai tag KHÔNG lồng nhau: assert "không lộ password" dùng
// `not.toContain`, tag này là tiền tố của tag kia thì hai ca sẽ kiểm chéo nhau và mất nghĩa.
const LOGIN_PW = loginPasswordFixture("s10qarh1");
const SMTP_PW_STORED = smtpPasswordFixture("s10qarh1-store");
const SMTP_PW_PROBE = smtpPasswordFixture("s10qarh1-probe");

describe.skipIf(!hasLaneDb)(
  "S10-QA-ROUTEHTTP-1 — HTTP thật: security-policy + mail-config (4 route phủ thật + 1 ghim bug KI-065)",
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
    //
    // 🔴 ĐÂY LÀ TEST GHIM BUG, KHÔNG PHẢI TEST HÀNH VI MONG MUỐN. Bug: KI-065 (RELEASE-02) —
    // "PATCH /settings/security-policy không thể gọi thành công qua HTTP với bất kỳ actor nào".
    // Sửa bug là việc của WO kế thừa **S10-QA-ROUTEHTTP-2** (mang theo danh sách route risk≥5 còn nợ),
    // KHÔNG phải của lane QA này.
    //
    // KHI AI ĐÓ VÁ GUARD/REAUTH-WIRING: test này sẽ ĐỎ. Đó là tín hiệu ĐÚNG — hãy XOÁ ca ghim này và
    // thay bằng cặp ALLOW (actor đủ quyền ⇒ 2xx + envelope) / DENY (actor thiếu quyền ⇒ 403
    // `deny-default`), rồi đóng KI-065. TUYỆT ĐỐI KHÔNG "sửa cho khớp" bằng cách nới assert.
    //
    // VÌ SAO ASSERT LÝ DO CHỨ KHÔNG CHỈ STATUS: route này 403 với MỌI actor, nên một assert chỉ đo
    // `status === 403` sẽ vẫn xanh sau khi guard được vá một nửa (vd đổi sang `deny-reauth-required`
    // hay `deny-default`) ⇒ ghim hỏng, bug lặng lẽ đổi hình. Ghim đúng lý do `deny-object-required`
    // (`PermissionGuard` ném `Permission denied: ${decision.reason}`) mới bắt được thay đổi.
    //
    // KHÔNG có ca "DENY: actor không quyền → 403" cho route này: vì actor ĐỦ quyền cũng nhận 403,
    // ca đó XANH RỖNG — nó không phân biệt được guard đang chặn vì thiếu quyền hay vì route chết
    // (bẫy "deny-cases-vacuous-without-allow-case"). Route này KHÔNG được tính là "đã phủ" cho tới
    // khi có ca ALLOW 2xx thật.
    it("🔴 GHIM BUG (KI-065): PATCH /settings/security-policy → 403 deny-object-required NGAY CẢ VỚI actor có ALLOW company-level đầy đủ", async () => {
      const res = await authPatch(tAdmin, "/settings/security-policy").send({
        ipRestrictionEnabled: true,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      // Lý do deny PHẢI là deny-object-required — xem giải thích ngay trên.
      expect(res.body.message, JSON.stringify(res.body)).toContain("deny-object-required");
      expect(res.body.error?.message, JSON.stringify(res.body)).toContain("deny-object-required");
    });

    // ── PUT /settings/mail-config ─────────────────────────────────────────
    it("ALLOW: PUT /settings/mail-config upsert → 200/201, envelope KHÔNG lộ password, hasPassword=true", async () => {
      const res = await authPut(tAdmin, "/settings/mail-config").send({
        host: "smtp.s10qarh1.invalid",
        port: 587,
        username: "smtp-user",
        fromEmail: "noreply@s10qarh1.invalid",
        password: SMTP_PW_STORED,
      });
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      expect(res.body.data.hasPassword).toBe(true);
      expect(res.body.data.password).toBeUndefined();
      // So với CHÍNH giá trị vừa gửi (không so literal chép tay) — đổi fixture thì assert vẫn còn nghĩa.
      expect(JSON.stringify(res.body)).not.toContain(SMTP_PW_STORED);
    });

    it("DENY: PUT /settings/mail-config không quyền → 403", async () => {
      const res = await authPut(tNoPerm, "/settings/mail-config").send({
        host: "smtp.s10qarh1.invalid",
        port: 587,
        username: "smtp-user",
        fromEmail: "noreply@s10qarh1.invalid",
        password: SMTP_PW_STORED,
      });
      expect(res.status).toBe(403);
    });

    it("400: PUT /settings/mail-config port ngoài range (DTO Zod chặn ở HTTP boundary, không phải service)", async () => {
      const res = await authPut(tAdmin, "/settings/mail-config").send({
        host: "smtp.s10qarh1.invalid",
        port: 0,
        username: "smtp-user",
        fromEmail: "noreply@s10qarh1.invalid",
        password: SMTP_PW_STORED,
      });
      expect(res.status).toBe(400);
    });

    // ── GET /settings/mail-config ─────────────────────────────────────────
    it("ALLOW: GET /settings/mail-config → 200, danh sách config KHÔNG lộ password", async () => {
      const res = await authGet(tAdmin, "/settings/mail-config");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(Array.isArray(res.body.data.configs)).toBe(true);
      expect(res.body.data.configs.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.body)).not.toContain(SMTP_PW_STORED);
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
        password: SMTP_PW_PROBE,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.ok).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain(SMTP_PW_PROBE);
    });

    it("DENY: POST /settings/mail-config/test không quyền → 403", async () => {
      const res = await authPost(tNoPerm, "/settings/mail-config/test").send({
        host: "127.0.0.1",
        port: 65500,
        username: "smtp-user",
        password: SMTP_PW_PROBE,
      });
      expect(res.status).toBe(403);
    });
  },
);
