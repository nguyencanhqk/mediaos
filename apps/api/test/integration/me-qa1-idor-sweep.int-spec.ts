import "reflect-metadata";

import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ME_ERROR_CODES } from "@mediaos/contracts";
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

/**
 * S5-ME-QA-1 — QA ME: IDOR sweep + cross-user/cross-tenant deny + aggregation degraded + preference policy.
 * Postgres THẬT qua đường HTTP-đầy-đủ (JwtAuthGuard → CompanyGuard → PermissionGuard → controller ME →
 * service → repository). Nguồn: SPEC-09 §19 (nghiệm thu) + §20 (test scenario) · QA-05 · IMP02-STORY-120.
 *
 * Gate `hasDb && LANE_DB` (DB cô lập `mediaos_meqa1`): thiếu LANE_DB → SKIP (lane-db-guard đếm), KHÔNG
 * chạy trên `mediaos` dùng chung (false-red). Xem CLAUDE.md §9 + memory integration-test-lane-db-gate.
 *
 * Cross-user/cross-tenant REVOKE session (SPEC-09 §20.4) đã phủ ĐẦY ĐỦ ở auth-session-selfservice.int-spec.ts
 * (revoke phiên user khác → 404 + RLS cross-tenant + no-secret) — done_when "tái dùng nếu đã phủ, chỉ bổ
 * khuyết" ⇒ KHÔNG nhân bản ở đây. Phân loại infra-'error' của aggregation (§20.5 ATT lỗi/TASK timeout/NOTI
 * lỗi) + mapping bất thường >1 employee (§20.2 → 409) đã phủ ở unit me-aggregation.service.spec.ts /
 * me-current-person.resolver.spec.ts (DB partial-unique chặn seed 2-active) — ở đây phủ 3 dạng degraded
 * TẤT ĐỊNH (forbidden / module_disabled / unlinked) cùng bất biến "1 nguồn hỏng ≠ toàn trang 500" (§19.10).
 */

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const PASSWORD = "Passw0rd!meqa1";

/** Cặp quyền (tuple engine mig 0495) — `is_sensitive` KHỚP NGUYÊN VĂN (chống canonical-seed-pin flip). */
type Pair = readonly [action: string, resourceType: string, sensitive: boolean];
const ME_ACCESS: Pair = ["access", "me", false];
/** Cặp NGUỒN mỗi section (re-check in-process TRƯỚC khi đọc — SPEC-09 §11.2). */
const ME_SOURCE_PAIRS: readonly Pair[] = [
  ["read", "employee", false],
  ["view-own", "attendance", true],
  ["view-own", "leave-balance", false],
  ["read", "task", false],
  ["read", "notification", false],
];
/** Preferences/avatar own-scope. */
const ME_SELF_PAIRS: readonly Pair[] = [
  ["view", "user-preference", false],
  ["update", "user-preference", false],
  ["update", "avatar", false],
];
const ME_FULL_PAIRS: readonly Pair[] = [ME_ACCESS, ...ME_SELF_PAIRS, ...ME_SOURCE_PAIRS];

const VALID_SECTION_STATUS = ["ok", "error", "forbidden", "unlinked_employee", "module_disabled"];

/** Chuỗi con KHÔNG BAO GIỜ được xuất hiện trong response ME (BẤT BIẾN #3 + §17.1). So khớp lower-case. */
const SECRET_PII_SUBSTRINGS = [
  // KHÔNG dùng bare "password" — trùng tên EVENT-TYPE hợp lệ 'PASSWORD_CHANGED' (không phải secret).
  "password_hash",
  "salary",
  "identity_number",
  "identitynumber",
  "bank_account",
  "bankaccount",
  "refresh_token",
  "refreshtoken",
  "secret_ciphertext",
];

interface SeededUser {
  userId: string;
  employeeId: string | null;
  email: string;
  token: string;
}

describe.skipIf(!hasLaneDb)(
  "S5-ME-QA-1 ME /me/* IDOR sweep + cross-scope deny + degraded + prefs",
  () => {
    let app: INestApplication;
    let direct: Pool;
    const companyIds: string[] = [];

    // Tenant A (chủ đạo) — userA đầy đủ; userA2 peer cùng company (cross-user); userAP thiếu read:employee
    // (degraded-forbidden); userW dùng cho ghi preference/notification; userNoPerm không có access:me.
    let A: SeededTenant;
    let userA: SeededUser;
    let userA2: SeededUser;
    let userAP: SeededUser;
    let userW: SeededUser;
    let userNoPerm: SeededUser;
    // Có access:me nhưng THIẾU cặp per-route (view/update:user-preference, update:avatar) — chứng minh mỗi
    // controller ME gate ĐÚNG cặp riêng, KHÔNG phải chỉ access:me (mis-wire sẽ lọt nếu chỉ test access:me).
    let userSelfDenied: SeededUser;
    // Tenant B — cross-tenant peer.
    let B: SeededTenant;
    let userB: SeededUser;
    // Tenant C — user CHƯA liên kết employee (unlinked).
    let C: SeededTenant;
    let userC: SeededUser;
    // Tenant D — module LEAVE bị tắt (module_disabled).
    let D: SeededTenant;
    let userD: SeededUser;

    // ── helpers ──────────────────────────────────────────────────────────────────
    function http() {
      return request(app.getHttpServer());
    }

    async function login(slug: string, email: string): Promise<string> {
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: slug, email, password: PASSWORD });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    async function seedEmployee(companyId: string, userId: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
        [companyId, userId],
      );
      return r.rows[0].id as string;
    }

    async function grant(
      companyId: string,
      userId: string,
      label: string,
      pairs: readonly Pair[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `meqa1-${label}-${userId.slice(0, 8)}`);
      for (const [action, resourceType, sensitive] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resourceType, sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Own");
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    /** Seed 1 user (hash pw), tùy chọn liên kết employee + cấp cặp quyền, rồi login lấy token. */
    async function seedUserFull(
      tenant: SeededTenant,
      label: string,
      opts: { linked?: boolean; pairs?: readonly Pair[] } = {},
    ): Promise<SeededUser> {
      const email = `meqa1-${label}-${randomUUID().slice(0, 8)}@x.test`;
      const hash = await new PasswordService().hash(PASSWORD);
      const userId = await seedUser(direct, tenant.companyId, email, hash);
      const employeeId =
        opts.linked === false ? null : await seedEmployee(tenant.companyId, userId);
      if (opts.pairs && opts.pairs.length) await grant(tenant.companyId, userId, label, opts.pairs);
      const token = await login(tenant.slug, email);
      return { userId, employeeId, email, token };
    }

    async function seedPref(companyId: string, userId: string, theme: string): Promise<void> {
      await direct.query(
        `INSERT INTO user_preferences (company_id, user_id, theme) VALUES ($1, $2, $3)
       ON CONFLICT (company_id, user_id) DO UPDATE SET theme = EXCLUDED.theme`,
        [companyId, userId, theme],
      );
    }

    async function seedSecurityEvent(
      companyId: string,
      userId: string,
      eventType: string,
      ip: string,
      ua: string,
    ): Promise<void> {
      await direct.query(
        `INSERT INTO user_security_events (company_id, user_id, event_type, severity, ip_address, user_agent)
       VALUES ($1, $2, $3, 'medium', $4, $5)`,
        [companyId, userId, eventType, ip, ua],
      );
    }

    async function seedFile(
      companyId: string,
      ownerUserId: string,
      opts: { mime?: string; uploadStatus?: string } = {},
    ): Promise<string> {
      // storage_path phải nằm trong prefix tenant + mọi segment an toàn (không dấu chấm) — xem storage-key.ts.
      const key = `${companyId}/me-avatar/${randomUUID()}`;
      const r = await direct.query(
        `INSERT INTO files
         (company_id, original_name, stored_name, mime_type, file_size_bytes,
          storage_provider, storage_path, upload_status, scan_status, owner_user_id, uploaded_by, visibility)
       VALUES ($1, 'avatar', 'avatar-stored', $4, 2048,
          'MinIO', $2, $5, 'Clean', $3, $3, 'Private') RETURNING id`,
        [companyId, key, ownerUserId, opts.mime ?? "image/png", opts.uploadStatus ?? "Uploaded"],
      );
      return r.rows[0].id as string;
    }

    function authGet(token: string, url: string, query?: Record<string, string>) {
      const r = http().get(url).set("Authorization", `Bearer ${token}`);
      return query ? r.query(query) : r;
    }

    function assertNoSecrets(body: unknown): void {
      const raw = JSON.stringify(body).toLowerCase();
      for (const s of SECRET_PII_SUBSTRINGS) expect(raw, `leak "${s}"`).not.toContain(s);
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();

      A = await seedCompany(direct, "meqa1-a");
      B = await seedCompany(direct, "meqa1-b");
      C = await seedCompany(direct, "meqa1-c");
      D = await seedCompany(direct, "meqa1-d");
      companyIds.push(A.companyId, B.companyId, C.companyId, D.companyId);

      userA = await seedUserFull(A, "a", { pairs: ME_FULL_PAIRS });
      userA2 = await seedUserFull(A, "a2", { pairs: ME_FULL_PAIRS });
      // userAP: đầy đủ TRỪ read:employee → section HR degrade 'forbidden'.
      userAP = await seedUserFull(A, "ap", {
        pairs: ME_FULL_PAIRS.filter(([a, r]) => !(a === "read" && r === "employee")),
      });
      userW = await seedUserFull(A, "w", { pairs: ME_FULL_PAIRS });
      userNoPerm = await seedUserFull(A, "noperm", { pairs: [] });
      // Chỉ access:me — dùng deny per-route (preferences/avatar gate cặp riêng, KHÔNG phải access:me).
      userSelfDenied = await seedUserFull(A, "selfdenied", { pairs: [ME_ACCESS] });

      userB = await seedUserFull(B, "b", { pairs: ME_FULL_PAIRS });
      userC = await seedUserFull(C, "c", { linked: false, pairs: ME_FULL_PAIRS });
      userD = await seedUserFull(D, "d", { pairs: ME_FULL_PAIRS });

      // Preferences phân biệt được để chứng minh cô lập cross-user/cross-tenant.
      await seedPref(A.companyId, userA.userId, "dark");
      await seedPref(A.companyId, userA2.userId, "light");
      await seedPref(B.companyId, userB.userId, "light");

      // Security events có IP/UA THÔ → phải bị mask ở response (§10.6/§17.1).
      //  - userA (chủ thể): event của CHÍNH mình PHẢI hiện (+ mask).
      //  - userA2 (CÙNG tenant A): dùng chứng minh khoá cross-user Ở TẦNG APP (WHERE user_id=token), KHÔNG
      //    do RLS — mig 0495 "CROSS-USER KHÔNG DO RLS". Nếu khoá user_id bị gỡ, activity của A sẽ nuốt cả
      //    event/login_log của A2 (cùng company) mà RLS + masking VẪN xanh ⇒ phải assert vắng tường minh.
      //  - userB (tenant B): khoá cross-TENANT (RLS company_id).
      await seedSecurityEvent(
        A.companyId,
        userA.userId,
        "PASSWORD_CHANGED",
        "203.0.113.7",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      );
      await seedSecurityEvent(
        A.companyId,
        userA2.userId,
        "ROLE_ASSIGNED",
        "203.0.113.99",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
      );
      await seedSecurityEvent(
        B.companyId,
        userB.userId,
        "USER_LOCKED",
        "198.51.100.9",
        "Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0",
      );

      // Tenant D: tắt module LEAVE (company_settings) → leave section 'module_disabled'.
      await direct.query(
        `INSERT INTO company_settings (company_id, setting_key, setting_value, value_type, category, module_code, status)
       VALUES ($1, 'module.LEAVE.enabled', 'false'::jsonb, 'Boolean', 'module', 'LEAVE', 'Active')`,
        [D.companyId],
      );

      // Tenant A: 1 notification_rules bắt buộc (mandatory) để chứng minh không opt-out được.
      await direct.query(
        `INSERT INTO notification_rules (company_id, notification_type, enabled, mandatory)
       VALUES ($1, 'general', true, true)
       ON CONFLICT (company_id, notification_type) DO UPDATE SET mandatory = true`,
        [A.companyId],
      );
    });

    afterAll(async () => {
      if (direct && companyIds.length) {
        // employee_profiles KHÔNG nằm trong cleanupTenants — xoá tường minh (user_id CASCADE cũng phủ, belt).
        for (const companyId of companyIds) {
          await direct
            .query("DELETE FROM employee_profiles WHERE company_id = $1", [companyId])
            .catch(() => undefined);
        }
        await cleanupTenants(direct, companyIds);
      }
      await app?.close();
      await direct?.end();
    });

    // ── T12: auth gates (§20.1) ────────────────────────────────────────────────────
    describe("auth gate", () => {
      it("(deny) GET /me KHÔNG token → 401", async () => {
        const res = await http().get("/me");
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      });

      it("(deny) GET /me có token nhưng THIẾU access:me → 403", async () => {
        const res = await authGet(userNoPerm.token, "/me");
        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      });
    });

    // ── Per-route permission gate — mỗi controller ME gate ĐÚNG cặp riêng (không phải chỉ access:me) ──
    describe("per-route permission gate (có access:me nhưng THIẾU cặp per-route → 403)", () => {
      it("có access:me → GET /me = 200 (chứng minh gate dưới đây là cặp KHÁC, không phải access:me)", async () => {
        const res = await authGet(userSelfDenied.token, "/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });

      it("(deny) THIẾU view:user-preference → GET /me/preferences = 403", async () => {
        const res = await authGet(userSelfDenied.token, "/me/preferences");
        expect(res.status).toBe(403);
      });

      it("(deny) THIẾU update:user-preference → PATCH /me/preferences = 403", async () => {
        const res = await http()
          .patch("/me/preferences")
          .set("Authorization", `Bearer ${userSelfDenied.token}`)
          .send({ theme: "dark" });
        expect(res.status).toBe(403);
      });

      it("(deny) THIẾU update:avatar → POST /me/avatar = 403", async () => {
        const res = await http()
          .post("/me/avatar")
          .set("Authorization", `Bearer ${userSelfDenied.token}`)
          .send({ fileId: randomUUID() });
        expect(res.status).toBe(403);
      });
    });

    // ── T1: IDOR sweep mọi GET /me/* (§14.4/§16/§20.6) ─────────────────────────────
    describe("IDOR sweep — foreign user_id/employee_id qua query bị BỎ QUA (owner 100% từ token)", () => {
      const GET_ROUTES = [
        "/me",
        "/me/overview",
        "/me/attendance-summary",
        "/me/leave-summary",
        "/me/task-summary",
        "/me/notification-summary",
        "/me/preferences",
        "/me/security/activity",
      ] as const;

      for (const url of GET_ROUTES) {
        // Target CÙNG TENANT (userA2) — mạnh hơn cross-tenant: RLS KHÔNG cứu 1 endpoint honor-param (A2 cùng
        // company đi qua RLS) ⇒ nếu route lỡ đọc user_id/employee_id thì tampered SẼ lệch baseline (A2 có
        // pref/activity/identity RIÊNG đã seed). Bằng nhau ⇒ owner thực sự 100% từ token.
        it(`${url}: response GIỐNG HỆT khi truyền ?user_id=<A2 cùng tenant>&employee_id=<empA2>`, async () => {
          const tamper = { user_id: userA2.userId, employee_id: userA2.employeeId ?? randomUUID() };
          const baseline = await authGet(userA.token, url);
          const tampered = await authGet(userA.token, url, tamper);
          expect(baseline.status, `baseline ${url}: ${JSON.stringify(baseline.body)}`).toBe(200);
          expect(tampered.status, `tampered ${url}: ${JSON.stringify(tampered.body)}`).toBe(200);
          // Chỉ so `data` (+`pagination`) — `meta.timestamp` trong envelope là volatile.
          expect(tampered.body.data).toEqual(baseline.body.data);
          if (baseline.body.pagination) {
            expect(tampered.body.pagination).toEqual(baseline.body.pagination);
          }
        });
      }

      it("PATCH /me/preferences body chứa user_id lạ → 400 (schema .strict() từ chối key thừa)", async () => {
        const res = await http()
          .patch("/me/preferences")
          .set("Authorization", `Bearer ${userW.token}`)
          .send({ theme: "dark", user_id: userB.userId });
        expect(res.status).toBe(400);
      });

      it("PATCH /me/preferences?user_id=<A2 cùng tenant> ghi vào CHÍNH caller (không đụng A2)", async () => {
        // Target CÙNG TENANT: nếu upsert honor-param user_id thì ghi 'dark' sẽ LANDE trên A2 (RLS cho phép
        // cùng company) ⇒ a2After lệch 'light'. Khoá `WHERE user_id=token` là hàng rào duy nhất ở đây.
        const patched = await http()
          .patch("/me/preferences")
          .set("Authorization", `Bearer ${userW.token}`)
          .query({ user_id: userA2.userId })
          .send({ theme: "dark" });
        expect(patched.status, JSON.stringify(patched.body)).toBe(200);
        // Caller (W) đổi thành dark; A2 (cùng tenant) KHÔNG đổi (vẫn 'light' như seed) — ghi đúng owner token.
        const wAfter = await authGet(userW.token, "/me/preferences");
        expect(wAfter.body.data.theme).toBe("dark");
        const a2After = await authGet(userA2.token, "/me/preferences");
        expect(a2After.body.data.theme).toBe("light");
      });
    });

    // ── T3: IDOR avatar — không gắn được file của người khác/tenant khác ─────────────
    describe("IDOR avatar — file ownership + cross-tenant", () => {
      it("POST /me/avatar với file của USER KHÁC (cùng tenant) → 403", async () => {
        const foreignFile = await seedFile(A.companyId, userA2.userId);
        const res = await http()
          .post("/me/avatar")
          .set("Authorization", `Bearer ${userA.token}`)
          .send({ fileId: foreignFile });
        expect(res.status).toBe(403);
      });

      it("POST /me/avatar với file của TENANT KHÁC → 404 (RLS không thấy)", async () => {
        const bFile = await seedFile(B.companyId, userB.userId);
        const res = await http()
          .post("/me/avatar")
          .set("Authorization", `Bearer ${userA.token}`)
          .send({ fileId: bFile });
        expect(res.status).toBe(404);
      });

      it("POST /me/avatar fileId không tồn tại (+ body user_id lạ bị strip) → 404", async () => {
        const res = await http()
          .post("/me/avatar")
          .set("Authorization", `Bearer ${userA.token}`)
          .send({ fileId: randomUUID(), user_id: userB.userId, employee_id: userB.employeeId });
        expect(res.status).toBe(404);
      });
    });

    // ── T4/T5: cross-user + cross-tenant deny (preferences/activity) ─────────────────
    describe("cross-user + cross-tenant deny", () => {
      it("cross-user: A và A2 (cùng tenant) đọc preference RIÊNG của mình", async () => {
        const a = await authGet(userA.token, "/me/preferences");
        const a2 = await authGet(userA2.token, "/me/preferences");
        expect(a.body.data.theme).toBe("dark");
        expect(a2.body.data.theme).toBe("light");
      });

      it("cross-USER (CÙNG tenant): activity của A CHỨA event CỦA MÌNH nhưng KHÔNG chứa của A2 (khoá user_id APP-LEVEL, KHÔNG do RLS)", async () => {
        const res = await authGet(userA.token, "/me/security/activity");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const items = res.body.data as Array<Record<string, unknown>>;
        // Có event CỦA CHÍNH A (không phải list rỗng — chống pass giả vì response trống).
        expect(items.some((i) => i.eventType === "PASSWORD_CHANGED")).toBe(true);
        // A2 cùng company A ⇒ RLS cho qua; hàng rào DUY NHẤT là `WHERE user_id = token` (mig 0495
        // "CROSS-USER KHÔNG DO RLS"). Gỡ khoá → event/login_log của A2 lọt vào → assert dưới ĐỎ.
        const raw = JSON.stringify(res.body);
        expect(raw).not.toContain("203.0.113.99"); // IP thô của event A2 (cùng tenant)
        expect(raw).not.toContain("ROLE_ASSIGNED"); // event chỉ seed cho A2
      });

      it("cross-TENANT: activity của A KHÔNG chứa event/IP của tenant B (RLS company_id)", async () => {
        const res = await authGet(userA.token, "/me/security/activity");
        expect(res.status).toBe(200);
        const raw = JSON.stringify(res.body);
        expect(raw).not.toContain("198.51.100.9"); // IP thô của userB
        expect(raw).not.toContain("USER_LOCKED"); // event chỉ seed cho userB
      });
    });

    // ── T7/T8: aggregation degraded — 1 nguồn hỏng, HTTP 200, section khác ok (§19.10/§20.5) ─
    describe("aggregation degraded — HTTP 200, section khác vẫn ok", () => {
      it("userA (đủ quyền): GET /me/overview → 200, identity đúng, hr/task/notification = ok", async () => {
        const res = await authGet(userA.token, "/me/overview");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const ov = res.body.data;
        expect(ov.identity.account.userId).toBe(userA.userId);
        expect(ov.identity.linkStatus).toBe("linked");
        expect(ov.hr.status).toBe("ok");
        expect(ov.task.status).toBe("ok");
        expect(ov.notification.status).toBe("ok");
        for (const key of ["hr", "attendance", "leave", "task", "notification"]) {
          expect(VALID_SECTION_STATUS).toContain(ov[key].status);
          if (ov[key].status !== "ok") expect(ov[key].data).toBeNull();
        }
      });

      it("(degraded-forbidden) thiếu read:employee → overview.hr='forbidden', KHÔNG 500, section khác ok", async () => {
        const res = await authGet(userAP.token, "/me/overview");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const ov = res.body.data;
        expect(ov.hr.status).toBe("forbidden");
        expect(ov.hr.data).toBeNull();
        expect(ov.task.status).toBe("ok");
        expect(ov.notification.status).toBe("ok");
      });

      it("(degraded-module_disabled) tenant D tắt LEAVE → overview.leave='module_disabled', section khác ok", async () => {
        const res = await authGet(userD.token, "/me/overview");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const ov = res.body.data;
        expect(ov.leave.status).toBe("module_disabled");
        expect(ov.leave.data).toBeNull();
        expect(ov.task.status).toBe("ok");
        expect(ov.notification.status).toBe("ok");
      });

      it("(degraded-unlinked) tenant C chưa liên kết → GET /me linkStatus 'unlinked'; overview hr/att/leave unlinked, task/noti ok", async () => {
        const me = await authGet(userC.token, "/me");
        expect(me.status, JSON.stringify(me.body)).toBe(200);
        expect(me.body.data.linkStatus).toBe("unlinked");
        expect(me.body.data.employee).toBeNull();

        const ov = await authGet(userC.token, "/me/overview");
        expect(ov.status).toBe(200);
        const d = ov.body.data;
        expect(d.hr.status).toBe("unlinked_employee");
        expect(d.attendance.status).toBe("unlinked_employee");
        expect(d.leave.status).toBe("unlinked_employee");
        expect(d.task.status).toBe("ok");
        expect(d.notification.status).toBe("ok");
      });
    });

    // ── T9: company khóa timezone (ME-DEC-008 / §20.6) ──────────────────────────────
    describe("preference policy — company khóa timezone", () => {
      it("PATCH /me/preferences/appearance timezone override (chưa mở policy) → 422 TIMEZONE_OVERRIDE_DENIED", async () => {
        const res = await http()
          .patch("/me/preferences/appearance")
          .set("Authorization", `Bearer ${userW.token}`)
          .send({ timezone: "Asia/Tokyo" });
        expect(res.status).toBe(422);
        expect(JSON.stringify(res.body)).toContain(ME_ERROR_CODES.TIMEZONE_OVERRIDE_DENIED);
      });

      it("PATCH timezone=null (revert-to-inherit) LUÔN được phép → 200", async () => {
        const res = await http()
          .patch("/me/preferences/appearance")
          .set("Authorization", `Bearer ${userW.token}`)
          .send({ timezone: null });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });

      it("PATCH theme (không timezone) → 200 (đổi giao diện không cần policy)", async () => {
        const res = await http()
          .patch("/me/preferences/appearance")
          .set("Authorization", `Bearer ${userW.token}`)
          .send({ theme: "light" });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.theme).toBe("light");
      });
    });

    // ── T10: notification bắt buộc không tắt được (§19.12/§20.6) ─────────────────────
    describe("notification preference — mandatory không opt-out", () => {
      it("PUT /notifications/preferences {mandatory 'general', enabled:false} → 400", async () => {
        const res = await http()
          .put("/notifications/preferences")
          .set("Authorization", `Bearer ${userW.token}`)
          .send({ notificationType: "general", enabled: false });
        expect(res.status).toBe(400);
      });

      it("PUT {mandatory 'general', enabled:true} → 200 (chỉ chặn TẮT, không chặn bật)", async () => {
        const res = await http()
          .put("/notifications/preferences")
          .set("Authorization", `Bearer ${userW.token}`)
          .send({ notificationType: "general", enabled: true });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });

      it("PUT {type thường 'task_assigned', enabled:false} → 200 (opt-out thường vẫn hoạt động)", async () => {
        const res = await http()
          .put("/notifications/preferences")
          .set("Authorization", `Bearer ${userW.token}`)
          .send({ notificationType: "task_assigned", enabled: false });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });
    });

    // ── T11: field nhạy cảm — mask + không secret (§17/§20.3) ─────────────────────────
    describe("field nhạy cảm — masking + no-secret leak", () => {
      it("GET /me + /me/overview KHÔNG lộ salary/PII/secret", async () => {
        const me = await authGet(userA.token, "/me");
        const ov = await authGet(userA.token, "/me/overview");
        expect(me.status).toBe(200);
        expect(ov.status).toBe(200);
        assertNoSecrets(me.body);
        assertNoSecrets(ov.body);
      });

      it("GET /me/security/activity mask IP (a.b.*.*) + UA thành nhãn; KHÔNG lộ IP/UA thô", async () => {
        const res = await authGet(userA.token, "/me/security/activity");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const items = res.body.data as Array<Record<string, unknown>>;
        const event = items.find((i) => i.eventType === "PASSWORD_CHANGED");
        expect(event, "seeded security event phải xuất hiện").toBeTruthy();
        expect(event!.ipMasked).toBe("203.0.*.*");
        expect(event!.device).toBe("Chrome trên Windows");

        const raw = JSON.stringify(res.body);
        expect(raw).not.toContain("203.0.113.7"); // IP thô
        expect(raw).not.toContain("KHTML"); // mảnh UA thô
        expect(raw).not.toContain("AppleWebKit");
        assertNoSecrets(res.body);
      });
    });

    // ── Avatar deny-path + happy-path (own-scope, tái dùng FileService) ──────────────────────
    describe("avatar own-scope deny-path + happy-path", () => {
      it("(deny) POST /me/avatar khi user CHƯA liên kết employee → 409 ME-ERR-UNLINKED-EMPLOYEE", async () => {
        // userC (tenant C) chưa liên kết ⇒ resolveOwnEmployeeIdOrThrow ném TRƯỚC khi chạm file.
        const res = await http()
          .post("/me/avatar")
          .set("Authorization", `Bearer ${userC.token}`)
          .send({ fileId: randomUUID() });
        expect(res.status).toBe(409);
        expect(JSON.stringify(res.body)).toContain(ME_ERROR_CODES.UNLINKED_EMPLOYEE);
      });

      it("(deny) POST /me/avatar file KHÔNG phải ảnh (application/pdf) của chính mình → 415", async () => {
        const pdf = await seedFile(A.companyId, userA.userId, { mime: "application/pdf" });
        const res = await http()
          .post("/me/avatar")
          .set("Authorization", `Bearer ${userA.token}`)
          .send({ fileId: pdf });
        expect(res.status).toBe(415);
      });

      it("(deny) POST /me/avatar file CHƯA upload xong (Pending) → 409", async () => {
        const pending = await seedFile(A.companyId, userA.userId, { uploadStatus: "Pending" });
        const res = await http()
          .post("/me/avatar")
          .set("Authorization", `Bearer ${userA.token}`)
          .send({ fileId: pending });
        expect(res.status).toBe(409);
      });

      it("POST /me/avatar file CỦA CHÍNH MÌNH (Uploaded/image) → 201 + downloadUrl; DELETE → 204 idempotent", async () => {
        const ownFile = await seedFile(A.companyId, userA.userId);
        const post = await http()
          .post("/me/avatar")
          .set("Authorization", `Bearer ${userA.token}`)
          .send({ fileId: ownFile });
        expect(post.status, JSON.stringify(post.body)).toBe(201);
        expect(post.body.data.fileId).toBe(ownFile);
        expect(typeof post.body.data.downloadUrl).toBe("string");

        const set = await direct.query(`SELECT avatar_url FROM employee_profiles WHERE id = $1`, [
          userA.employeeId,
        ]);
        expect(set.rows[0].avatar_url).toBe(ownFile);

        const del1 = await http()
          .delete("/me/avatar")
          .set("Authorization", `Bearer ${userA.token}`);
        expect(del1.status).toBe(204);
        const cleared = await direct.query(
          `SELECT avatar_url FROM employee_profiles WHERE id = $1`,
          [userA.employeeId],
        );
        expect(cleared.rows[0].avatar_url).toBeNull();

        // Idempotent: DELETE lần 2 khi KHÔNG có avatar → vẫn 204.
        const del2 = await http()
          .delete("/me/avatar")
          .set("Authorization", `Bearer ${userA.token}`);
        expect(del2.status).toBe(204);
      });
    });
  },
);
