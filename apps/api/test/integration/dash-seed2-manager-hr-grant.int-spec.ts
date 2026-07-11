import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { PermissionService } from "../../src/permission/permission.service";

/**
 * S4-DASH-SEED-2 (🔴 RED, zone=red, FULL gate) — backfill grant (read,dashboard) cho role GLOBAL
 * `manager` + `hr` bị lỡ ở blanket 0100, RED-trước (mig 0488).
 *
 * ═══ ROOT CAUSE ═══
 *   Mig 0100 (idx 53, when 1717500100000) grant (read,dashboard) cho MỌI system role thời điểm đó bằng
 *   `INSERT ... roles r CROSS JOIN permissions p WHERE p.resource_type='dashboard'`. Blanket đó chạy TRƯỚC
 *   khi 2 role canonical `manager` + `hr` ra đời (mig 0444, idx 127, when 1717500620000) ⇒ 2 role này KHÔNG
 *   bao giờ nhận (read,dashboard). Hệ quả: GET /dashboard/* 403 cho persona manager/hr (2/4 persona
 *   S4-DASH-BE-1). 0488 backfill đúng 2 cặp còn thiếu — per-pair, ON CONFLICT DO NOTHING, KHÔNG blanket mới.
 *
 * ═══ RED-before-GREEN ═══
 *   Chạy trên DB migrate tới TRƯỚC 0488 (head-1 = 0487) → ĐỎ vì:
 *     • (a)/(a') manager/hr KHÔNG có row (read,dashboard) — 0 row;
 *     • (b) tập role có (read,dashboard) chỉ gồm 10 role legacy (0005/0019/0074), THIẾU {manager,hr};
 *     • (d) engine can(read:dashboard)=false cho user gắn manager/hr;
 *     • (e) GET /dashboard/summary = 403 cho manager JWT + hr JWT.
 *   Sau apply 0488 → GREEN (12 role, +2 row, can()=true, 200).
 *
 * ═══ Gate CỨNG `hasDb && LANE_DB` ═══ (memory integration-test-lane-db-gate)
 *   .env trỏ DB dev chung ⇒ hasDb=true nhưng assertion chạm role_permissions GLOBAL của DB chung = đỏ-giả.
 *   CHỈ chạy khi LANE_DB set (DB cô lập mediaos_dashseed2, chain 0000→head sạch).
 *
 * ═══ BẤT BIẾN kiểm chứng ═══
 *   • data_scope: mirror ĐÚNG giá trị 0100 đã set cho 10 role cũ = 'Company' (empirically verified trên
 *     LANE_DB: employee/company-admin read:dashboard = Company). KHÔNG 'Own' — least-privilege của 0484 là
 *     cho cặp view-*:dashboard KHÁC, không phải (read,dashboard).
 *   • EXACT-SET (b): loại TRỪ 'platform-admin' (mig 0230) — role này cũng lỡ blanket 0100 với CÙNG cơ chế
 *     nhưng NGOÀI phạm vi WO (SaaS/platform-tier, không thuộc 4 persona canonical). KHÔNG grant, KHÔNG assert.
 *   • Per-pair ONLY: chỉ +2 row (manager|hr, read:dashboard); các grant KHÁC của manager/hr (0444 view:me,
 *     0484 view-employee/manager/hr:dashboard) KHÔNG bị đụng.
 *   • Idempotent bộ-ba (role_id,permission_id,data_scope): re-INSERT ON CONFLICT(role_id,permission_id,
 *     effect) DO NOTHING → count không đổi, scope không drift.
 */

const runIsolatedDb = hasDb && !!process.env.LANE_DB;

// Tập role GLOBAL (company_id IS NULL, deleted_at IS NULL) có (read,dashboard) ALLOW SAU 0488.
//   = 10 role legacy blanket-0100 (0005/0019/0074) ∪ {manager, hr} (backfill 0488).
//   CỐ Ý loại 'platform-admin' (0230): lỡ CÙNG cơ chế nhưng ngoài scope WO (không grant/không assert).
const EXPECTED_DASHBOARD_ROLES = [
  "channel-manager",
  "company-admin",
  "editor",
  "employee",
  "finance-manager",
  "hr",
  "hr-manager",
  "manager",
  "project-manager",
  "qa-reviewer",
  "script-writer",
  "uploader",
].sort();

const BACKFILLED_ROLES = ["manager", "hr"] as const;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 1 — Grant backfill (directPool, DB-level, CHỈ ĐỌC). Mirror task-recon-grants.int-spec.ts Phần 1.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!runIsolatedDb)(
  "S4-DASH-SEED-2 grant backfill (mig 0488, DB cô lập LANE_DB) — read-only",
  () => {
    const direct = directPool();

    afterAll(async () => {
      await direct.end();
    });

    /** Row (read,dashboard) ALLOW của 1 role GLOBAL (data_scope kèm). */
    async function readDashboardRows(role: string): Promise<Array<{ data_scope: string }>> {
      const res = await direct.query<{ data_scope: string }>(
        `SELECT rp.data_scope
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name = $1 AND r.company_id IS NULL AND r.deleted_at IS NULL
            AND rp.effect = 'ALLOW'
            AND p.action = 'read' AND p.resource_type = 'dashboard'`,
        [role],
      );
      return res.rows;
    }

    // ── (a)/(a') manager + hr có ĐÚNG 1 row (read,dashboard) ALLOW @Company ─────────────
    for (const role of BACKFILLED_ROLES) {
      it(`(a) ${role} có đúng 1 grant (read:dashboard) ALLOW data_scope=Company`, async () => {
        const rows = await readDashboardRows(role);
        expect(rows.length, `${role} phải có đúng 1 row (read,dashboard) sau 0488`).toBe(1);
        expect(rows[0].data_scope, `${role} read:dashboard scope phải mirror 0100 = Company`).toBe(
          "Company",
        );
      });
    }

    // ── (b) EXACT-SET các role có (read,dashboard) == 12 name kỳ vọng (loại platform-admin) ──
    it("(b) tập role có (read:dashboard) == 12 name kỳ vọng (10 legacy ∪ {manager,hr}, LOẠI platform-admin)", async () => {
      const res = await direct.query<{ name: string }>(
        `SELECT DISTINCT r.name
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE p.action = 'read' AND p.resource_type = 'dashboard'
            AND rp.effect = 'ALLOW' AND r.company_id IS NULL AND r.deleted_at IS NULL
          ORDER BY r.name`,
      );
      const actual = res.rows.map((x) => x.name);
      expect(
        actual,
        `grant-set (read:dashboard) phải hội tụ ĐÚNG 12 role. actual=${JSON.stringify(actual)}`,
      ).toEqual(EXPECTED_DASHBOARD_ROLES);
      // Neo tường minh: platform-admin (0230) CỐ Ý ngoài scope — không được silently grant.
      expect(actual, "platform-admin PHẢI ngoài tập (out-of-scope WO)").not.toContain(
        "platform-admin",
      );
    });
  },
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 2 — Engine can() + HTTP đường thật (deny→allow qua ranh giới migration). Mirror task-recon Phần 2.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const LOGIN_PW = "Passw0rd!dashseed2";

describe.skipIf(!runIsolatedDb)(
  "S4-DASH-SEED-2 engine can() + GET /dashboard/summary (DB cô lập LANE_DB)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let perm: PermissionService;
    let A: SeededTenant;
    let mgrUser = "";
    let hrUser = "";
    let tokenMgr = "";
    let tokenHr = "";
    let tokenNoRole = "";

    async function canonicalRoleId(name: string): Promise<string> {
      const r = await direct.query(
        "SELECT id FROM roles WHERE name = $1 AND company_id IS NULL AND deleted_at IS NULL",
        [name],
      );
      if (r.rows.length === 0) {
        throw new Error(`[dashseed2] canonical role không tồn tại: ${name} (mig 0444 phải chạy)`);
      }
      return r.rows[0].id as string;
    }

    async function login(email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: A.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    function getSummary(token: string) {
      return request(app.getHttpServer())
        .get("/dashboard/summary")
        .set("Authorization", `Bearer ${token}`);
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      perm = app.get(PermissionService, { strict: false });

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "dashseed2");

      const roleMgr = await canonicalRoleId("manager");
      const roleHr = await canonicalRoleId("hr");

      mgrUser = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, hash);
      hrUser = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
      // User thứ 3 KHÔNG role — negative control HTTP 403 (deny-by-default, gate read:dashboard là THẬT).
      await seedUser(direct, A.companyId, `norole@${A.slug}.test`, hash);

      await seedUserRole(direct, mgrUser, roleMgr, A.companyId);
      await seedUserRole(direct, hrUser, roleHr, A.companyId);

      tokenMgr = await login(`mgr@${A.slug}.test`);
      tokenHr = await login(`hr@${A.slug}.test`);
      tokenNoRole = await login(`norole@${A.slug}.test`);
    });

    afterAll(async () => {
      if (direct && A) await cleanupTenants(direct, [A.companyId]);
      await direct?.end();
      await app?.close();
    });

    // ── Positive control: role wired đúng (manager/hr có view:me từ 0444) ────────────────
    // Chứng minh 403 pre-migration là do THIẾU grant read:dashboard, KHÔNG do role/user hỏng.
    it("positive control: manager + hr có view:me (0444) → can()=true (role wired đúng)", async () => {
      for (const uid of [mgrUser, hrUser]) {
        const d = await perm.can({
          userId: uid,
          companyId: A.companyId,
          action: "view",
          resourceType: "me",
        });
        expect(d.allow, `user ${uid} phải có view:me`).toBe(true);
      }
    });

    // ── (d) engine can(read:dashboard)=true cho manager + hr (SAU 0488) ──────────────────
    it("(d) engine can(read:dashboard)=true cho manager + hr", async () => {
      for (const uid of [mgrUser, hrUser]) {
        const d = await perm.can({
          userId: uid,
          companyId: A.companyId,
          action: "read",
          resourceType: "dashboard",
        });
        expect(d.allow, `can(read:dashboard) phải ALLOW cho user ${uid} (backfill 0488)`).toBe(
          true,
        );
      }
    });

    // ── (e) GET /dashboard/summary: 403→200 cho manager + hr qua ranh giới migration ─────
    it("(e) manager GET /dashboard/summary → 200 (read:dashboard từ 0488)", async () => {
      const res = await getSummary(tokenMgr);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("(e) hr GET /dashboard/summary → 200 (read:dashboard từ 0488)", async () => {
      const res = await getSummary(tokenHr);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ── Negative control: user KHÔNG role vẫn 403 (gate read:dashboard là THẬT, không nới ngầm) ──
    it("user KHÔNG role GET /dashboard/summary → 403 (deny-by-default tầng HTTP)", async () => {
      const res = await getSummary(tokenNoRole);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });
  },
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 3 — Idempotent (directPool, MUTATION). Đặt CUỐI CÙNG để re-INSERT không nhiễm sang phần khác.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!runIsolatedDb)(
  "S4-DASH-SEED-2 idempotent (mig 0488, DB cô lập LANE_DB) — mutation LAST",
  () => {
    const direct = directPool();

    afterAll(async () => {
      await direct.end();
    });

    // ── (c) Idempotent bộ-ba: re-apply INSERT ON CONFLICT KHÔNG drift scope, count không đổi ──
    it("(c) re-INSERT ON CONFLICT — count (manager|hr, read:dashboard) không đổi, scope không drift", async () => {
      const snapshot = async () =>
        (
          await direct.query<{ k: string }>(
            `SELECT r.name || '|' || rp.data_scope AS k
               FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
              WHERE r.name = ANY($1) AND r.company_id IS NULL AND r.deleted_at IS NULL
                AND rp.effect = 'ALLOW' AND p.action = 'read' AND p.resource_type = 'dashboard'
              ORDER BY k`,
            [BACKFILLED_ROLES],
          )
        ).rows
          .map((x) => x.k)
          .join("\n");

      const before = await snapshot();
      // Bộ đôi grant phải TỒN TẠI trước khi test idempotency (điều kiện tiên quyết = migration đã chạy).
      expect(before, "manager|Company phải có sau 0488").toContain("manager|Company");
      expect(before, "hr|Company phải có sau 0488").toContain("hr|Company");

      // Re-apply với scope SAI ('Own') → ON CONFLICT(role_id,permission_id,effect) DO NOTHING KHÔNG ghi đè.
      await direct.query(
        `INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
         SELECT r.id, p.id, 'ALLOW', 'Own'
           FROM roles r CROSS JOIN permissions p
          WHERE r.name = ANY($1) AND r.company_id IS NULL AND r.deleted_at IS NULL
            AND p.action = 'read' AND p.resource_type = 'dashboard'
         ON CONFLICT (role_id, permission_id, effect) DO NOTHING`,
        [BACKFILLED_ROLES],
      );

      const after = await snapshot();
      expect(after, "re-INSERT ON CONFLICT KHÔNG được drift scope (bộ-ba bất biến)").toBe(before);
      expect(after, "manager read:dashboard vẫn = Company (KHÔNG bị Own ghi đè)").toContain(
        "manager|Company",
      );
      expect(after, "hr read:dashboard vẫn = Company (KHÔNG bị Own ghi đè)").toContain(
        "hr|Company",
      );
    });
  },
);
