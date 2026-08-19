/**
 * S10-QA-ROUTEHTTP-1 — test HTTP THẬT (supertest, đi qua guard/DTO/envelope thật) cho 5 route đứng đầu
 * bảng xếp hạng rủi ro ở `route-http-coverage.e2e-spec.ts` mà trước đây CHỈ có test ở tầng service
 * (`security-policy-crud.int-spec.ts` gọi thẳng `service.updatePolicy(...)`, KHÔNG qua HTTP):
 *   GET/PATCH /settings/security-policy · GET/PUT/POST(test) /settings/mail-config.
 *
 * ĐẾM ĐÚNG ĐỘ PHỦ (đừng thổi số): file này phủ THẬT 5 route — `PATCH /settings/security-policy`
 * (risk 5 — có ALLOW 2xx THẬT từ 19/08/2026, khi `S10-QA-SECPOLICY-GATE-1` đóng KI-065) ·
 * `PUT /settings/mail-config` (risk 5) · `POST /settings/mail-config/test` (risk 5) ·
 * `GET /settings/security-policy` (risk 3) · `GET /settings/mail-config` (risk 3).
 *
 * KI-065 ĐÃ ĐÓNG — giữ LỊCH SỬ ở đây để không ai vô tình dựng lại đúng cái bẫy đó:
 * `PATCH /settings/security-policy` từng khai `@RequirePermission(..., { isSensitive: true,
 * requiresReauth: true })`. `permission.decide.ts:93` tính `needsObjectGrant = isSensitive &&
 * requiresReauth`, mà route này KHÔNG có `:id` ⇒ `resourceId` luôn `null` ⇒ object-tier bị bỏ qua ⇒
 * **403 `deny-object-required` VĨNH VIỄN cho MỌI actor**, kể cả actor có ALLOW company-level đúng cặp.
 * Lối thoát còn lại (cửa sổ re-auth) cũng bất khả thi: KHÔNG nơi nào trong `apps/api/src` GHI
 * `req.reauthContext`. Bản vá = hướng (a) của KI-065 (ADR `DECISIONS-09`): **bỏ `requiresReauth` khỏi
 * decorator, GIỮ `isSensitive`** (wildcard `*:*` vẫn KHÔNG đủ), và **không chạm một dòng nào** của
 * permission engine ⇒ route nhạy cảm khác không hề bị nới. Ca ghim 403 cũ đã được **LẬT** sang ALLOW
 * 2xx + DENY thật — KHÔNG nới assert, KHÔNG xoá-cho-xanh. Cổng chống tái diễn:
 * `test/foundation/reauth-reachability.e2e-spec.ts` (route khai `requiresReauth` mà không có step-up
 * thật ⇒ ĐỎ) + `src/security-policy/security-policy.permission-contract.spec.ts` (metadata THẬT của
 * decorator nạp thẳng vào `decideCan`).
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
  "S10-QA-ROUTEHTTP-1 + S10-QA-SECPOLICY-GATE-1 — HTTP thật: security-policy + mail-config (5 route phủ thật, KI-065 đã đóng)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    // Công ty THỨ HAI — chỉ dùng cho ca cross-tenant của PATCH /settings/security-policy.
    let B: SeededTenant;
    const companyIds: string[] = [];
    let tAdmin = "";
    let tNoPerm = "";
    let tBAdmin = "";
    /** id actor gọi PATCH — ca BẤT BIẾN #4 assert chính id này nằm trong exemptUserIds. */
    let adminUserId = "";

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
      adminUserId = uAdmin;

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

      // Công ty B (cross-tenant): admin RIÊNG, quyền RIÊNG, chỉ đủ đổi policy của CHÍNH B.
      B = await seedCompany(direct, "s10qarh1b");
      companyIds.push(B.companyId);
      const emailBAdmin = `admin-${randomUUID().slice(0, 8)}@s10qarh1b.local`;
      const uBAdmin = await seedUser(direct, B.companyId, emailBAdmin, hash);
      const roleBAdmin = await seedRole(
        direct,
        B.companyId,
        `s10qarh1b-admin-${uBAdmin.slice(0, 8)}`,
      );
      // Cặp đã có trong catalog TOÀN CỤC với is_sensitive=true — truyền ĐÚNG giá trị đó (helper NÉM
      // nếu fixture đòi đổi cờ: test-fixture-stamps-global-permission-catalog).
      const permSecPolicy = await seedPermissionCatalog(
        direct,
        "configure-security-policy",
        "company",
        true,
      );
      await seedRolePermission(direct, roleBAdmin, permSecPolicy, "ALLOW", "Company");
      await seedUserRole(direct, uBAdmin, roleBAdmin, B.companyId);

      tAdmin = await login(A.slug, emailAdmin);
      tNoPerm = await login(A.slug, emailNoPerm);
      tBAdmin = await login(B.slug, emailBAdmin);
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

    // ── PATCH /settings/security-policy — ĐÃ LẬT khỏi ca ghim bug (KI-065 ĐÓNG 19/08/2026) ────────
    //
    // Bản trước của file này có ca "🔴 GHIM BUG (KI-065)" assert 403 `deny-object-required` cho MỌI
    // actor. `S10-QA-SECPOLICY-GATE-1` vá theo hướng (a) — xem docblock đầu file + ADR `DECISIONS-09`.
    // Ca ghim đó bị **XOÁ và thay bằng ALLOW 2xx thật**, KHÔNG phải nới assert cho khớp code
    // (`tests-can-pin-a-hole-open`). Ca DENY dưới đây chỉ CÓ NGHĨA vì đã có ca ALLOW đứng cạnh — trước
    // bản vá nó là xanh-RỖNG (`deny-cases-vacuous-without-allow-case`).
    //
    // ASSERT LÝ DO, KHÔNG CHỈ STATUS: `deny-sensitive` (thiếu grant) khác hẳn `deny-object-required`
    // (route chết). Gắn lại `requiresReauth` ⇒ ca ALLOW ĐỎ và ca DENY đổi lý do: hai tín hiệu.

    it("ALLOW: PATCH /settings/security-policy → 2xx và GHI THẬT (đọc lại bằng GET thấy giá trị mới)", async () => {
      const res = await authPatch(tAdmin, "/settings/security-policy").send({
        ipRestrictionEnabled: true,
        allowlistCidrs: ["10.11.12.0/24"],
      });
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      expect(res.body.data.ipRestrictionEnabled).toBe(true);
      expect(res.body.data.allowlistCidrs).toContain("10.11.12.0/24");

      // Đọc lại qua HTTP: chứng minh đã ghi xuống DB, không phải echo body.
      const after = await authGet(tAdmin, "/settings/security-policy");
      expect(after.status, JSON.stringify(after.body)).toBe(200);
      expect(after.body.data.ipRestrictionEnabled).toBe(true);
      expect(after.body.data.allowlistCidrs).toContain("10.11.12.0/24");
    });

    it("BẤT BIẾN #4 (chống tự-khoá): actor gọi PATCH LUÔN có mặt trong exemptUserIds dù body không gửi", async () => {
      const res = await authPatch(tAdmin, "/settings/security-policy").send({
        timeRestrictionEnabled: true,
      });
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      expect(res.body.data.exemptUserIds, JSON.stringify(res.body)).toContain(adminUserId);
    });

    it("AUDIT: PATCH ghi `security_policy.updated` vào audit_logs (append-only) đúng actor + after", async () => {
      const res = await authPatch(tAdmin, "/settings/security-policy").send({
        autoLogoutMinutes: 45,
      });
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

      const rows = await direct.query(
        `SELECT actor_user_id, before, after FROM audit_logs
          WHERE company_id = $1 AND action = 'security_policy.updated'
          ORDER BY created_at DESC LIMIT 1`,
        [A.companyId],
      );
      expect(rows.rows.length, "KHÔNG có hàng audit nào cho security_policy.updated").toBe(1);
      expect(rows.rows[0].actor_user_id).toBe(adminUserId);
      expect(rows.rows[0].after).toMatchObject({ autoLogoutMinutes: 45 });
    });

    it("DENY: PATCH /settings/security-policy thiếu quyền → 403 `deny-sensitive` (assert LÝ DO, không chỉ status)", async () => {
      const res = await authPatch(tNoPerm, "/settings/security-policy").send({
        ipRestrictionEnabled: false,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.message, JSON.stringify(res.body)).toContain("deny-sensitive");
      // Chốt ngược: KHÔNG được là `deny-object-required` — lý do đó nghĩa là route chết trở lại.
      expect(res.body.message, JSON.stringify(res.body)).not.toContain("deny-object-required");
    });

    it("CỜ HIỂN THỊ (nửa thứ hai của KI-065): /auth/me trả `configure-security-policy:company` cho actor có grant", async () => {
      // Vá route ở BE mà quên allowlist thì màn console `settings/security-policy` VẪN render EmptyState
      // "không có quyền" với chính company-admin — cặp is_sensitive bị `getCapabilities()` lọc sạch, chỉ
      // `SENSITIVE_CAPABILITY_ALLOWLIST` mới surface (lớp lỗi capability-allowlist-hides-admin-screens,
      // đã lặp 9+ lần). Đo ở đây bằng CHÍNH /auth/me thay vì tin vào hằng số trong mã.
      const me = await authGet(tAdmin, "/auth/me");
      expect(me.status, JSON.stringify(me.body)).toBe(200);
      const caps = me.body.data.capabilities as Record<string, boolean>;
      expect(caps["configure-security-policy:company"], JSON.stringify(caps)).toBe(true);

      // Actor KHÔNG có grant thì cặp phải VẮNG (allowlist là cờ hiển thị grant-bound, không phải cờ bật-cho-mọi-người).
      const meNoPerm = await authGet(tNoPerm, "/auth/me");
      expect(meNoPerm.status).toBe(200);
      expect(
        (meNoPerm.body.data.capabilities as Record<string, boolean>)[
          "configure-security-policy:company"
        ],
      ).toBeUndefined();
    });

    it("CROSS-TENANT: admin công ty B PATCH → chỉ policy B đổi, policy A KHÔNG suy suyển (companyId từ JWT)", async () => {
      // NEO TUYỆT ĐỐI trước khi so trước/sau: nếu `getPolicy` thoái hoá thành "luôn trả DEFAULT" thì
      // `toEqual` vẫn xanh mà không chứng minh được gì (ca này phải tự đủ, không dựa vào ca chạy trước).
      const anchor = await authPatch(tAdmin, "/settings/security-policy").send({
        autoLogoutMinutes: 33,
      });
      expect(anchor.status, JSON.stringify(anchor.body)).toBeLessThan(300);

      const beforeA = await authGet(tAdmin, "/settings/security-policy");
      expect(beforeA.status, JSON.stringify(beforeA.body)).toBe(200);
      expect(beforeA.body.data.autoLogoutMinutes, "neo hỏng ⇒ phép so trước/sau vô nghĩa").toBe(33);

      const patchB = await authPatch(tBAdmin, "/settings/security-policy").send({
        autoLogoutMinutes: 7,
        ipRestrictionEnabled: false,
      });
      expect(patchB.status, JSON.stringify(patchB.body)).toBeLessThan(300);
      expect(patchB.body.data.autoLogoutMinutes).toBe(7);

      // So TOÀN BỘ DTO của A trước/sau — mạnh hơn so từng field (bắt cả rò field không ai nghĩ tới).
      const afterA = await authGet(tAdmin, "/settings/security-policy");
      expect(afterA.status, JSON.stringify(afterA.body)).toBe(200);
      expect(afterA.body.data.autoLogoutMinutes).toBe(33); // KHÔNG bị ghi đè bởi giá trị 7 của B
      expect(afterA.body.data).toEqual(beforeA.body.data);
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
