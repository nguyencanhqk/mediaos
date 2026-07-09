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
 * S4-TASK-RECON-1 (lane reconVerify) — đối soát grant TASK pair-drift + deny-path (mig 0480), RED-trước.
 *
 * Nguồn sự thật: docs/plans/S4-TASK-RECON-1.md · DB-06 §12.1 (TASK.TASK.COMMENT = (comment,'task')) ·
 *   migration 0480 ĐÍCH HỘI TỤ (grant-set task+project MỖI role canonical, không dư/không thiếu).
 *
 * RED-before-GREEN: chạy trên DB migrate tới TRƯỚC 0480 (head-1 = 0479) → ĐỎ vì:
 *   • catalog THIẾU cặp (comment,'task');
 *   • employee + company-admin còn (comment,'comment') legacy + residual submit/manage/assign;
 *   • grant-set task+project chưa hội tụ.
 *   Sau apply 0480 → GREEN.
 *
 * Gate CỨNG `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env trỏ DB dev chung ⇒ hasDb=true;
 *   assertion chạm role_permissions của DB chung = đỏ-giả. CHỈ chạy khi LANE_DB set (DB cô lập mediaos_<lane>).
 *
 * BẤT BIẾN kiểm chứng:
 *   • (a) catalog: (comment,'task') is_sensitive=false — cặp canonical MỚI, KHÔNG đụng is_sensitive cặp khác.
 *   • (b) EXACT grant-set task+project cho 4 role canonical == kỳ vọng (đếm không dư/không thiếu).
 *   • (c) FORBIDDEN residual {submit:task,manage:task,manage:project,assign:project,comment:comment}
 *         KHÔNG còn grant cho BẤT KỲ role canonical nào; comment:comment đã gỡ khỏi employee+company-admin.
 *   • (d) Idempotent bộ-ba (role_id,permission_id,data_scope): re-INSERT ON CONFLICT KHÔNG drift scope;
 *         re-park DELETE = 0 row.
 *   • Deny-path: POST /tasks/:taskId/comments 2xx cho employee (comment:task) · 403 role KHÔNG grant;
 *         engine can()=false employee {create,update,delete,close,archive}:project + hr {close,delete,
 *         archive,manage-member}:project + delete:task (deny-by-default: pair chưa granted / chưa có catalog).
 */

const runIsolatedDb = hasDb && !!process.env.LANE_DB;

const CANONICAL_ROLES = ["employee", "manager", "hr", "company-admin"] as const;

/**
 * ĐÍCH HỘI TỤ mig 0480 — tập grant (action:resource) trên resource task+project của MỖI role canonical.
 * Nguồn: migration 0480 header + DB-06 §12.1. So EXACT (không dư/không thiếu) → phát hiện drift 2 chiều.
 *   • company-admin: 0005 cấp ALL is_sensitive=false ⇒ 7 task + 6 project; park gỡ submit/manage:task +
 *     manage/assign:project + comment:comment; grant thêm comment:task ⇒ {create,read,update,delete,assign,
 *     comment}:task ∪ {create,read,update,delete}:project.
 *   • employee: 0005 cấp read/submit:task + comment:comment; park gỡ submit:task + comment:comment; grant
 *     comment:task ⇒ {read,comment}:task.
 *   • manager/hr (0444, chỉ AUTH/HR): KHÔNG có grant task/project ⇒ ∅.
 */
const EXPECTED_TASK_PROJECT: Record<(typeof CANONICAL_ROLES)[number], string[]> = {
  "company-admin": [
    "assign:task",
    "comment:task",
    "create:project",
    "create:task",
    "delete:project",
    "delete:task",
    "read:project",
    "read:task",
    "update:project",
    "update:task",
  ],
  employee: ["comment:task", "read:task"],
  manager: [],
  hr: [],
};

// Cặp residual TUYỆT ĐỐI KHÔNG được grant cho BẤT KỲ role canonical nào sau 0480.
const FORBIDDEN_RESIDUAL: ReadonlyArray<{ action: string; resourceType: string }> = [
  { action: "submit", resourceType: "task" },
  { action: "manage", resourceType: "task" },
  { action: "manage", resourceType: "project" },
  { action: "assign", resourceType: "project" },
  { action: "comment", resourceType: "comment" },
];

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 1 — Grant reconciliation (directPool, DB-level). Mirror hr-seed-permissions.int-spec.ts.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!runIsolatedDb)(
  "S4-TASK-RECON-1 grant reconciliation (mig 0480, DB cô lập LANE_DB)",
  () => {
    const direct = directPool();

    afterAll(async () => {
      await direct.end();
    });

    /** Tập grant (action:resource) trên resource task+project của 1 role canonical (sorted). */
    async function taskProjectGrantSet(role: string): Promise<string[]> {
      const res = await direct.query<{ action: string; resource_type: string }>(
        `SELECT p.action, p.resource_type
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name = $1 AND r.company_id IS NULL AND r.deleted_at IS NULL
            AND rp.effect = 'ALLOW'
            AND p.resource_type IN ('task','project')`,
        [role],
      );
      return res.rows.map((x) => `${x.action}:${x.resource_type}`).sort();
    }

    // ── (a) Catalog cặp canonical MỚI (comment,'task') is_sensitive=false ─────────────
    it("(a) catalog có đúng 1 row (comment:task) is_sensitive=false", async () => {
      const res = await direct.query<{ is_sensitive: boolean }>(
        `SELECT is_sensitive FROM permissions WHERE action='comment' AND resource_type='task'`,
      );
      expect(res.rows.length, "(comment:task) phải tồn tại sau 0480").toBe(1);
      expect(res.rows[0].is_sensitive, "(comment:task) is_sensitive phải = false").toBe(false);
    });

    // ── (b) EXACT grant-set task+project cho 4 role canonical == kỳ vọng (không dư/thiếu) ──
    for (const role of CANONICAL_ROLES) {
      it(`(b) ${role} grant-set task+project == kỳ vọng (đếm không dư/không thiếu)`, async () => {
        const actual = await taskProjectGrantSet(role);
        const expected = [...EXPECTED_TASK_PROJECT[role]].sort();
        expect(
          actual,
          `${role} grant-set task+project phải hội tụ ĐÚNG (0480). actual=${JSON.stringify(actual)}`,
        ).toEqual(expected);
      });
    }

    // ── (b') data_scope §6 của cặp (comment,task) MỚI ──────────────────────────────────
    it("(b') employee comment:task=Own · company-admin comment:task=Company (§6/§12.2)", async () => {
      const res = await direct.query<{ role: string; data_scope: string }>(
        `SELECT r.name AS role, rp.data_scope
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.company_id IS NULL AND r.deleted_at IS NULL AND rp.effect='ALLOW'
            AND p.action='comment' AND p.resource_type='task'
            AND r.name IN ('employee','company-admin')`,
      );
      const byRole = Object.fromEntries(res.rows.map((x) => [x.role, x.data_scope]));
      expect(byRole["employee"], "employee comment:task scope").toBe("Own");
      expect(byRole["company-admin"], "company-admin comment:task scope").toBe("Company");
    });

    // ── (c) FORBIDDEN residual KHÔNG còn grant cho role canonical nào ───────────────────
    for (const fp of FORBIDDEN_RESIDUAL) {
      it(`(c) KHÔNG role canonical nào còn (${fp.action}:${fp.resourceType})`, async () => {
        const res = await direct.query<{ role: string }>(
          `SELECT r.name AS role
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
            WHERE r.name = ANY($1) AND r.company_id IS NULL AND rp.effect='ALLOW'
              AND p.action=$2 AND p.resource_type=$3`,
          [CANONICAL_ROLES, fp.action, fp.resourceType],
        );
        expect(
          res.rows.map((x) => x.role),
          `residual (${fp.action}:${fp.resourceType}) phải đã gỡ khỏi MỌI role canonical`,
        ).toEqual([]);
      });
    }

    it("(c') comment:comment đã gỡ khỏi CẢ employee VÀ company-admin (legacy park)", async () => {
      const res = await direct.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name IN ('employee','company-admin') AND r.company_id IS NULL
            AND rp.effect='ALLOW' AND p.action='comment' AND p.resource_type='comment'`,
      );
      expect(res.rows[0].n, "employee+company-admin KHÔNG còn comment:comment").toBe(0);
    });

    // ── (d) Idempotent bộ-ba: re-apply INSERT ON CONFLICT KHÔNG drift; re-park DELETE=0 row ──
    it("(d) idempotent bộ-ba — re-INSERT ON CONFLICT KHÔNG đổi scope; re-park DELETE = no-op", async () => {
      const snapshot = async () =>
        (
          await direct.query<{ k: string }>(
            `SELECT r.name || '|' || p.action || ':' || p.resource_type || '|' || rp.data_scope AS k
               FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
              WHERE r.name = ANY($1) AND r.company_id IS NULL AND rp.effect='ALLOW'
                AND p.resource_type IN ('task','project')
              ORDER BY k`,
            [CANONICAL_ROLES],
          )
        ).rows
          .map((x) => x.k)
          .join("\n");

      const before = await snapshot();

      // Mô phỏng re-apply grant SAI scope (employee comment:task 'Company'): ON CONFLICT(role_id,
      // permission_id,effect) DO NOTHING → KHÔNG ghi đè 'Own'. (Mirror 0480 bước (2) idempotent.)
      await direct.query(
        `INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
         SELECT r.id, p.id, 'ALLOW', 'Company'
           FROM roles r CROSS JOIN permissions p
          WHERE r.name='employee' AND r.company_id IS NULL AND r.deleted_at IS NULL
            AND p.action='comment' AND p.resource_type='task'
         ON CONFLICT (role_id, permission_id, effect) DO NOTHING`,
      );

      // Re-park residual đã gỡ (employee comment:comment) → DELETE khớp 0 row (đã không còn).
      const del = await direct.query(
        `DELETE FROM role_permissions rp
           USING roles r, permissions p
          WHERE rp.role_id = r.id AND rp.permission_id = p.id
            AND r.name='employee' AND r.company_id IS NULL AND rp.effect='ALLOW'
            AND p.action='comment' AND p.resource_type='comment'`,
      );

      const after = await snapshot();
      expect(after, "re-apply ON CONFLICT KHÔNG được drift scope (bộ-ba bất biến)").toBe(before);
      expect(after, "employee comment:task vẫn = Own (KHÔNG bị Company ghi đè)").toContain(
        "employee|comment:task|Own",
      );
      expect(del.rowCount, "re-park comment:comment (employee) đã gỡ ⇒ DELETE 0 row").toBe(0);
    });
  },
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 2 — Deny-path (HTTP đường thật + engine can()). Mirror task-core-tenant-deny + att-qa1.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const LOGIN_PW = "Passw0rd!recon99";

describe.skipIf(!runIsolatedDb)(
  "S4-TASK-RECON-1 deny-path — comment route (HTTP) + engine can() (DB cô lập LANE_DB)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let perm: PermissionService;
    let A: SeededTenant;
    let taskId = "";
    let empUser = "";
    let mgrUser = "";
    let hrUser = "";
    let adminUser = "";
    let tokenEmp = "";
    let tokenMgr = "";

    async function canonicalRoleId(name: string): Promise<string> {
      const r = await direct.query(
        "SELECT id FROM roles WHERE name = $1 AND company_id IS NULL AND deleted_at IS NULL",
        [name],
      );
      if (r.rows.length === 0) {
        throw new Error(
          `[reconVerify] canonical role không tồn tại: ${name} (mig 0444/0480 phải chạy)`,
        );
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

    function postComment(token: string) {
      return request(app.getHttpServer())
        .post(`/tasks/${taskId}/comments`)
        .set("Authorization", `Bearer ${token}`)
        .send({ body: "recon deny-path comment" });
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
      A = await seedCompany(direct, "taskrecon");

      const roleEmp = await canonicalRoleId("employee");
      const roleMgr = await canonicalRoleId("manager");
      const roleHr = await canonicalRoleId("hr");
      const roleAdmin = await canonicalRoleId("company-admin");

      empUser = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
      mgrUser = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, hash);
      hrUser = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
      adminUser = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);

      await seedUserRole(direct, empUser, roleEmp, A.companyId);
      await seedUserRole(direct, mgrUser, roleMgr, A.companyId);
      await seedUserRole(direct, hrUser, roleHr, A.companyId);
      await seedUserRole(direct, adminUser, roleAdmin, A.companyId);

      const task = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round)
         VALUES ($1, 'office', 'recon-task', 'not_started', 'initial', 0) RETURNING id`,
        [A.companyId],
      );
      taskId = task.rows[0].id as string;

      tokenEmp = await login(`emp@${A.slug}.test`);
      tokenMgr = await login(`mgr@${A.slug}.test`);
    });

    afterAll(async () => {
      if (direct && A) await cleanupTenants(direct, [A.companyId]);
      await direct?.end();
      await app?.close();
    });

    // ── (1) Comment route qua HTTP đường thật (JwtAuthGuard→CompanyGuard→PermissionGuard→service) ──
    it("employee (comment:task ALLOW) POST /tasks/:id/comments → 201 (bình luận LIÊN TỤC qua khe recon)", async () => {
      const res = await postComment(tokenEmp);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data?.body).toBe("recon deny-path comment");
    });

    it("manager (KHÔNG grant task/project sau recon) POST /tasks/:id/comments → 403", async () => {
      const res = await postComment(tokenMgr);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    // ── (2) Positive control — 403 do THIẾU grant, KHÔNG do user/role hỏng ──────────────
    it("positive control: manager có grant view:me (0444) → can()=true (403 comment là do thiếu grant)", async () => {
      const d = await perm.can({
        userId: mgrUser,
        companyId: A.companyId,
        action: "view",
        resourceType: "me",
      });
      expect(d.allow, "manager phải có view:me (chứng minh role wired đúng)").toBe(true);
    });

    // ── (3) Engine can()=true cho comment:task (employee + company-admin) ───────────────
    it("engine can(comment:task)=true cho employee + company-admin (route 2xx nền tảng)", async () => {
      for (const uid of [empUser, adminUser]) {
        const d = await perm.can({
          userId: uid,
          companyId: A.companyId,
          action: "comment",
          resourceType: "task",
        });
        expect(d.allow, `can(comment:task) phải ALLOW cho user ${uid}`).toBe(true);
      }
    });

    // ── (4) Engine can()=false — employee project lifecycle (deny-by-default) ───────────
    const EMP_PROJECT_DENY = ["create", "update", "delete", "close", "archive"] as const;
    for (const action of EMP_PROJECT_DENY) {
      it(`engine can(${action}:project)=false cho employee (deny-by-default)`, async () => {
        const d = await perm.can({
          userId: empUser,
          companyId: A.companyId,
          action,
          resourceType: "project",
        });
        expect(d.allow, `employee KHÔNG được ${action}:project`).toBe(false);
      });
    }

    // ── (5) Engine can()=false — hr project lifecycle + delete:task (deny-by-default) ────
    const HR_PROJECT_DENY = ["close", "delete", "archive", "manage-member"] as const;
    for (const action of HR_PROJECT_DENY) {
      it(`engine can(${action}:project)=false cho hr (deny-by-default)`, async () => {
        const d = await perm.can({
          userId: hrUser,
          companyId: A.companyId,
          action,
          resourceType: "project",
        });
        expect(d.allow, `hr KHÔNG được ${action}:project`).toBe(false);
      });
    }

    it("engine can(delete:task)=false cho hr (deny-by-default — hr ∅ task/project)", async () => {
      const d = await perm.can({
        userId: hrUser,
        companyId: A.companyId,
        action: "delete",
        resourceType: "task",
      });
      expect(d.allow, "hr KHÔNG được delete:task").toBe(false);
    });
  },
);
