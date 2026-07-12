/**
 * S4-QA-1 (lane qadashxtenant) — CROWN cross-module 2-tenant regression cho các route AGGREGATION của
 * dashboard (summary · mv-stats · alerts · report · widgets · me). BẤT BIẾN §2: company_id ở MỌI query +
 * RLS+FORCE ⇒ user tenant B (đủ quyền tenant B) KHÔNG BAO GIỜ thấy dữ liệu tenant A qua BẤT KỲ route tổng
 * hợp nào, KỂ CẢ row cache đọc lại.
 *
 * VÌ SAO cần spec RIÊNG (không trùng):
 *   - dashboard-widget-security.int-spec.ts §S7 ĐÃ phủ cross-tenant cho 7 route PER-WIDGET (/widgets/:slug).
 *   - dashboard-cache-invalidate.int-spec.ts (#178) ĐÃ phủ cache-INVALIDATION cross-tenant ((f)/(e)/outbox).
 *   ⇒ Spec này HỢP NHẤT lỗ hổng còn lại: các route AGGREGATION đọc chéo NHIỀU module (task/notification/
 *     employee-salary/audit/project) trong 1 request — chứng minh KHÔNG rò marker A ở CẢ 5 nguồn cùng lúc.
 *
 * MÔ HÌNH (mirror S7a/S7b — anti-vacuous-green, bài học reviewers-pass-real-bugs):
 *   XT0 SANITY: viewerA (tenant A) THẤY marker A ở route tương ứng (task→alerts/widgets · notif→widgets ·
 *       project→project-progress+mv-stats · employee→report.totalEmployees≥1) ⇒ marker THẬT & route CÓ
 *       surface nó ⇒ phép cô lập ở XT1 KHÔNG vacuous (xanh vì rỗng). Đồng thời SALARY/PII KHÔNG lộ NGAY CẢ
 *       cho A (masking là việc SERVER — SPEC-01 §22, CLAUDE.md §5).
 *   XT1 SWEEP: viewerB (tenant B, ĐỦ quyền tenant B) gọi summary/mv-stats/alerts/report/widgets(×2 type)/me
 *       → 200 (cô lập bằng DATA, KHÔNG bằng 403) + response chứa 0 marker A.
 *   XT2 CACHE no-leak: row dashboard_widget_cache của B chứa 0 marker A; đọc cache A dưới GUC tenant B (app
 *       role, RLS+FORCE) ⇒ 0 row.
 *   XT3 PROJECT-PROGRESS cross-tenant: viewerB + project_id CỦA A ⇒ 404 (getProject scope — KHÔNG lộ tồn tại).
 *   XT4 PROJECT-MEMBER scope KHÔNG nới cross-tenant: dưới GUC tenant B, project A + task-của-project A ⇒ 0 row
 *       (RLS+FORCE chặn ở tầng DB, KHÔNG phụ thuộc kỷ luật service — BẤT BIẾN §2 §1).
 *
 * Gate CỨNG hasDb && LANE_DB (memory integration-test-lane-db-gate + ci-skips-most-integration-specs): .env
 * trỏ DB dev chung (hasDb=true) ⇒ CHỈ chạy trên DB cô lập lane; thiếu LANE_DB ⇒ suite SKIP (không đỏ/xanh-giả).
 *   bash scripts/lane-db-setup.sh qadashagg → export LANE_DB=mediaos_qadashagg → npx vitest run <spec>.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool, PoolClient } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!qadashxt7";
const hasLaneDb = hasDb && !!process.env.LANE_DB;

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

/** id cặp quyền trong catalog toàn cục (fail-loud nếu thiếu — migration chưa chạy). */
async function permId(direct: Pool, action: string, resourceType: string): Promise<string> {
  const r = await direct.query(
    "SELECT id FROM permissions WHERE action = $1 AND resource_type = $2 LIMIT 1",
    [action, resourceType],
  );
  if (r.rows.length === 0) throw new Error(`permission missing: ${action}:${resourceType}`);
  return r.rows[0].id as string;
}

/** Grant (action,resourceType,scope) 'ALLOW' cho role đã seed. */
async function grant(
  direct: Pool,
  roleId: string,
  action: string,
  resourceType: string,
  scope: "Own" | "Team" | "Department" | "Company" | "System" = "Company",
): Promise<void> {
  await seedRolePermission(
    direct,
    roleId,
    await permId(direct, action, resourceType),
    "ALLOW",
    scope,
  );
}

/**
 * Bộ quyền "đủ để CHẠM mọi route aggregation + widget nguồn" cho 1 role tenant — cô lập KHÔNG do 403 mà do
 * RLS + company_id (viewerB phải 200, chỉ khác là 0 dữ liệu A). Gồm: read:dashboard (blanket) · 2 type
 * (Employee+HR để reach my-tasks & hr-overview) · read:finance/employee/attendance_report (report sections) ·
 * cặp nguồn 7 widget · view-salary:employee (chứng masking VẪN che dù có quyền xem lương).
 */
async function grantFullTenant(direct: Pool, roleId: string): Promise<void> {
  const pairs: Array<[string, string, "Own" | "Company"]> = [
    ["read", "dashboard", "Company"],
    ["view-employee", "dashboard", "Own"],
    ["view-hr", "dashboard", "Own"],
    ["read", "finance_report", "Company"],
    ["read", "employee_report", "Company"],
    ["read", "attendance_report", "Company"],
    ["read", "task", "Company"],
    ["read", "notification", "Company"],
    ["view-own", "attendance", "Company"],
    ["read", "attendance", "Company"],
    ["view", "leave", "Company"],
    ["read", "leave", "Company"],
    ["read", "project", "Company"],
    ["read", "employee", "Company"],
    ["view-salary", "employee", "Company"],
  ];
  for (const [a, r, s] of pairs) await grant(direct, roleId, a, r, s);
}

// ── seed marker rows (direct pool, bypass RLS — chỉ dựng lưới 2-tenant) ──────────────────────────────

async function seedEmployeeProfile(
  direct: Pool,
  companyId: string,
  userId: string | null,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,'active') RETURNING id`,
    [companyId, userId],
  );
  return r.rows[0].id as string;
}

/** employee "bẫy lương" — base_salary + phone + notes marker; report/hr-overview CHỈ đếm, KHÔNG lộ field này. */
async function seedSalaryEmployee(
  direct: Pool,
  companyId: string,
  salary: string,
  phone: string,
  notes: string,
): Promise<void> {
  await direct.query(
    `INSERT INTO employee_profiles
       (company_id, status, base_salary, salary_type, phone, contract_type, notes)
     VALUES ($1,'active',$2,'monthly',$3,'permanent',$4)`,
    [companyId, salary, phone, notes],
  );
}

/** task overdue: status legacy 'not_started' (feeds alerts + mv_dashboard) + task_status TitleCase (my-tasks). */
async function seedTask(
  direct: Pool,
  opts: {
    companyId: string;
    creatorUserId: string;
    title: string;
    taskStatus?: string;
    dueInPast?: boolean;
    projectId?: string | null;
  },
): Promise<string> {
  const due = opts.dueInPast ? new Date(Date.now() - 2 * 86_400_000).toISOString() : null;
  const r = await direct.query(
    `INSERT INTO tasks
       (company_id, task_type, title, status, task_status, creator_user_id, due_date, due_at, project_id)
     VALUES ($1,'office',$2,'not_started',$3,$4,$5,$5,$6) RETURNING id`,
    [
      opts.companyId,
      opts.title,
      opts.taskStatus ?? "Todo",
      opts.creatorUserId,
      due,
      opts.projectId ?? null,
    ],
  );
  return r.rows[0].id as string;
}

async function seedProject(direct: Pool, companyId: string, name: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO projects (company_id, name, status, project_status)
     VALUES ($1,$2,'active','Active') RETURNING id`,
    [companyId, name],
  );
  return r.rows[0].id as string;
}

async function seedNotification(
  direct: Pool,
  companyId: string,
  recipientUserId: string,
  title: string,
): Promise<void> {
  await direct.query(
    `INSERT INTO notifications
       (company_id, user_id, type, body, is_read,
        recipient_user_id, status, priority, title, short_body, notification_type, module_code, event_code)
     VALUES ($1,$2,'general',$3,false,
             $2,'Unread','Normal',$4,$5,'Task','TASK','TASK_ASSIGNED')`,
    [companyId, recipientUserId, `Nội dung ${title} đủ dài cho fallback`, title, title],
  );
}

/** audit_logs marker (metadata + entity_code). KHÔNG route dashboard nào surface audit ⇒ marker PHẢI vắng ở
 *  MỌI response — guard defense-in-depth chống một feed-audit-vào-dashboard tương lai quên tenant-scope. */
async function seedAudit(
  direct: Pool,
  companyId: string,
  actorUserId: string,
  marker: string,
): Promise<void> {
  await direct.query(
    `INSERT INTO audit_logs (company_id, actor_user_id, action, object_type, entity_code, metadata)
     VALUES ($1,$2,'DashXtMarker','task',$3,$4::jsonb)`,
    [companyId, actorUserId, marker, JSON.stringify({ marker })],
  );
}

/** id widget GLOBAL (company_id IS NULL) trong catalog (seed mig 0484) — fail-loud nếu thiếu. */
async function globalWidgetId(direct: Pool, widgetCode: string): Promise<string> {
  const r = await direct.query(
    "SELECT id FROM dashboard_widgets WHERE widget_code=$1 AND company_id IS NULL AND deleted_at IS NULL",
    [widgetCode],
  );
  if (r.rows.length === 0) throw new Error(`global widget missing: ${widgetCode}`);
  return r.rows[0].id as string;
}

/** Config Company-scope gắn 1 widget global vào 1 dashboard_type của company (registry đọc bảng này). */
async function seedConfig(
  direct: Pool,
  companyId: string,
  dashboardType: string,
  widgetCode: string,
  sortOrder: number,
): Promise<void> {
  const widgetId = await globalWidgetId(direct, widgetCode);
  await direct.query(
    `INSERT INTO dashboard_widget_configs
       (company_id, widget_id, dashboard_type, config_scope, role_id, user_id, is_enabled, sort_order)
     VALUES ($1,$2,$3,'Company',NULL,NULL,true,$4)`,
    [companyId, widgetId, dashboardType, sortOrder],
  );
}

/** Dựng catalog Employee+HR cho 1 company (đối xứng A/B) — registry.listWidgets có widget để trả về. */
async function seedDashboardCatalog(direct: Pool, companyId: string): Promise<void> {
  const employee: Array<[string, number]> = [
    ["ATTENDANCE_TODAY", 10],
    ["MY_TASKS", 20],
    ["TASK_ALERTS", 30],
    ["NOTIFICATIONS", 50],
  ];
  const hr: Array<[string, number]> = [
    ["HR_OVERVIEW", 10],
    ["PENDING_LEAVE", 40],
    ["NOTIFICATIONS", 50],
  ];
  for (const [code, order] of employee)
    await seedConfig(direct, companyId, "Employee", code, order);
  for (const [code, order] of hr) await seedConfig(direct, companyId, "HR", code, order);
}

/** Xoá CHỈ row cache (giữ configs — cần cho re-warm giữa test). Dùng để ép cache-miss sạch trong 1 test. */
async function truncateCacheOnly(direct: Pool, companyIds: string[]): Promise<void> {
  if (companyIds.length === 0) return;
  await direct.query("DELETE FROM dashboard_widget_cache WHERE company_id = ANY($1::uuid[])", [
    companyIds,
  ]);
}

/** Teardown: xoá cache + configs (company_id → companies CASCADE cũng phủ; xoá tường minh cho rõ thứ tự). */
async function cleanupDashboardTables(direct: Pool, companyIds: string[]): Promise<void> {
  if (companyIds.length === 0) return;
  await truncateCacheOnly(direct, companyIds);
  await direct.query("DELETE FROM dashboard_widget_configs WHERE company_id = ANY($1::uuid[])", [
    companyIds,
  ]);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!hasLaneDb)(
  "S4-QA-1 DASH cross-module 2-tenant regression (aggregation routes: summary·mv-stats·alerts·report·widgets·me)",
  () => {
    const direct = directPool();
    const app = appPool();
    let nest: INestApplication;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    const email = { aViewer: "", aOwner: "", bViewer: "" };
    const sfx = randomUUID().slice(0, 8);
    // 5 nguồn module + PII + project-UUID → sweep TẤT CẢ ở response/route của B.
    const MARK = {
      task: `XM-TASK-${sfx}`,
      notif: `XM-NOTI-${sfx}`,
      project: `XM-PROJ-${sfx}`,
      audit: `XM-AUDIT-${sfx}`,
      salary: "88817263", // base_salary "bẫy" — nếu lọt ⇒ mask fail.
      phone: `XM-PHONE-${sfx}`,
      notes: `XM-NOTE-${sfx}`,
    };
    let aProjectId = "";
    let aTaskId = "";
    // Bộ marker A quét ở MỌI response/cache của B (thêm aProjectId UUID để bắt rò project_id qua mv-stats).
    let A_MARKERS: string[] = [];

    beforeAll(async () => {
      const hash = await hashedPw();
      A = await seedCompany(direct, "dashxtA");
      B = await seedCompany(direct, "dashxtB");
      companyIds.push(A.companyId, B.companyId);

      const roleA = await seedRole(direct, A.companyId, "dashxt-full-a");
      await grantFullTenant(direct, roleA);
      const roleB = await seedRole(direct, B.companyId, "dashxt-full-b");
      await grantFullTenant(direct, roleB);

      email.aViewer = `aviewer@${A.slug}.test`;
      email.aOwner = `aowner@${A.slug}.test`;
      email.bViewer = `bviewer@${B.slug}.test`;
      const aViewer = await seedUser(direct, A.companyId, email.aViewer, hash);
      const aOwner = await seedUser(direct, A.companyId, email.aOwner, hash);
      const bViewer = await seedUser(direct, B.companyId, email.bViewer, hash);
      await seedUserRole(direct, aViewer, roleA, A.companyId);
      await seedUserRole(direct, bViewer, roleB, B.companyId);

      // ── marker A theo TỪNG module nguồn ──────────────────────────────────────────────────────
      await seedEmployeeProfile(direct, A.companyId, aViewer); // employee join của aViewer (report count)
      await seedSalaryEmployee(direct, A.companyId, MARK.salary, MARK.phone, MARK.notes); // bẫy lương/PII

      // task overdue (creator=aViewer) → alerts (company-wide overdue) + my-tasks (own) + mv_dashboard.
      aTaskId = await seedTask(direct, {
        companyId: A.companyId,
        creatorUserId: aViewer,
        title: MARK.task,
        taskStatus: "Todo",
        dueInPast: true,
      });

      aProjectId = await seedProject(direct, A.companyId, MARK.project);
      // task gắn project (status legacy 'not_started' → mv_dashboard_output có project_id=aProjectId).
      for (const st of ["Todo", "Done"]) {
        await seedTask(direct, {
          companyId: A.companyId,
          creatorUserId: aOwner,
          title: `${MARK.project}-${st}`,
          taskStatus: st,
          projectId: aProjectId,
        });
      }

      await seedNotification(direct, A.companyId, aViewer, MARK.notif);
      await seedAudit(direct, A.companyId, aViewer, MARK.audit);

      // Catalog Employee+HR cho CẢ HAI tenant (đối xứng) — registry.listWidgets có widget để trả ⇒ route
      // /dashboard/widgets?include_data KHÔNG rỗng ⇒ sweep cross-tenant KHÔNG vacuous.
      await seedDashboardCatalog(direct, A.companyId);
      await seedDashboardCatalog(direct, B.companyId);

      A_MARKERS = [
        MARK.task,
        MARK.notif,
        MARK.project,
        MARK.audit,
        MARK.salary,
        MARK.phone,
        MARK.notes,
        aProjectId,
      ];

      // MV populate (mig 0102 WITH NO DATA) qua owner = mô phỏng refresh-job → mv-stats có ý nghĩa.
      await direct.query("REFRESH MATERIALIZED VIEW mv_dashboard_task_status");
      await direct.query("REFRESH MATERIALIZED VIEW mv_dashboard_output");

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = moduleRef.createNestApplication();
      nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      nest.useGlobalFilters(new AllExceptionsFilter());
      await nest.init();
    });

    afterAll(async () => {
      await cleanupDashboardTables(direct, companyIds);
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app.end();
      if (nest) await nest.close();
    });

    async function getAs(mail: string, tenant: SeededTenant, path: string) {
      return api(nest)
        .get(path)
        .set(bearer(await login(nest, tenant.slug, mail)));
    }

    /** Không MỘT marker A nào xuất hiện trong body (response LẪN cache). */
    function expectNoAMarkers(bodyStr: string, ctx: string): void {
      for (const m of A_MARKERS) {
        expect(bodyStr.includes(m), `${ctx}: rò marker A "${m}" sang B`).toBe(false);
      }
    }

    /**
     * Chạy `fn` dưới role mediaos_app + GUC tenant TRONG 1 TRANSACTION (RLS+FORCE).
     * BẮT BUỘC BEGIN/COMMIT: set_config(is_local=true) NGOÀI transaction chỉ sống 1 statement ⇒ SELECT kế
     * mất GUC ⇒ 0 row "giả" (vacuous). Trong transaction, GUC bền suốt các query ⇒ RLS thực thi THẬT.
     */
    async function asTenant<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
      const c = await app.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
        const out = await fn(c);
        await c.query("COMMIT");
        return out;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    }

    // ── XT0 SANITY: viewerA THẤY marker A (anti-vacuous — cô lập không phải do rỗng) ──────────────────
    it("XT0 sanity: viewerA thấy marker A ở alerts(task) · mv-stats(project_id) · widgets(task+notif) · report(≥1 employee); SALARY/PII KHÔNG lộ ngay cả cho A (masking SERVER)", async () => {
      // alerts: overdue task title xuất hiện.
      const alertsA = await getAs(email.aViewer, A, "/dashboard/alerts");
      expect(alertsA.status, JSON.stringify(alertsA.body)).toBe(200);
      expect(
        JSON.stringify(alertsA.body.data).includes(MARK.task),
        "alerts A phải chứa task A",
      ).toBe(true);

      // mv-stats: project-linked task → mv_dashboard_output có project_id=aProjectId (nguồn cô lập cho B).
      const mvA = await getAs(email.aViewer, A, "/dashboard/mv-stats");
      expect(mvA.status).toBe(200);
      expect(
        JSON.stringify(mvA.body.data).includes(aProjectId),
        "mv-stats A phải chứa project_id A (output MV)",
      ).toBe(true);

      // widgets (Employee type): my-tasks(task) + notifications(notif) surface.
      const wA = await getAs(
        email.aViewer,
        A,
        "/dashboard/widgets?dashboard_type=Employee&include_data=true",
      );
      expect(wA.status).toBe(200);
      const wABlob = JSON.stringify(wA.body.data);
      expect(wABlob.includes(MARK.task), "widgets A (my-tasks) phải chứa task A").toBe(true);
      expect(wABlob.includes(MARK.notif), "widgets A (notifications) phải chứa notif A").toBe(true);

      // report: employee được ĐẾM (≥1) NHƯNG lương/PII KHÔNG lộ (masking SERVER, không phải 403).
      const repA = await getAs(email.aViewer, A, "/dashboard/report");
      expect(repA.status).toBe(200);
      expect(
        repA.body.data.report.totalEmployees,
        "report A đếm ≥1 employee",
      ).toBeGreaterThanOrEqual(1);
      for (const bad of [MARK.salary, MARK.phone, MARK.notes, "baseSalary", "salaryType"]) {
        expect(JSON.stringify(repA.body).includes(bad), `report A lộ field cấm: ${bad}`).toBe(
          false,
        );
      }

      // project-progress: viewerA + project A → 200 với data (dự án tồn tại & reachable trong tenant A).
      const ppA = await getAs(
        email.aViewer,
        A,
        `/dashboard/widgets/project-progress?project_id=${aProjectId}`,
      );
      expect(ppA.status, JSON.stringify(ppA.body)).toBe(200);
      expect(ppA.body.data.data.summary.done, "project A có ≥1 task Done").toBeGreaterThanOrEqual(
        1,
      );

      // audit marker: tồn tại trong DB tenant A (guard non-vacuous cho XT1 audit-sweep).
      const auditCount = await direct.query(
        "SELECT count(*)::int AS c FROM audit_logs WHERE company_id=$1 AND entity_code=$2",
        [A.companyId, MARK.audit],
      );
      expect(auditCount.rows[0].c, "audit marker A seeded").toBeGreaterThanOrEqual(1);
    });

    // ── XT1 SWEEP: viewerB (đủ quyền tenant B) → 0 marker A ở 6 route aggregation ─────────────────────
    it("XT1 sweep: viewerB → summary/mv-stats/alerts/report/widgets(Employee+HR)/me đều 200 + 0 marker A trong response", async () => {
      const routes = [
        "/dashboard/summary",
        "/dashboard/mv-stats",
        "/dashboard/alerts",
        "/dashboard/report",
        "/dashboard/widgets?dashboard_type=Employee&include_data=true",
        "/dashboard/widgets?dashboard_type=HR&include_data=true",
        "/dashboard/me",
      ];
      for (const path of routes) {
        const rb = await getAs(email.bViewer, B, path);
        expect(
          rb.status,
          `${path} phải 200 (B đủ quyền — cô lập bằng data, không bằng 403): ${JSON.stringify(rb.body)}`,
        ).toBe(200);
        expectNoAMarkers(JSON.stringify(rb.body), `B ${path}`);
      }
    });

    // ── XT2 CACHE no-leak: row cache B không chứa marker A; cache A KHÔNG đọc được dưới GUC tenant B ────
    it("XT2 cache no-leak: dashboard_widget_cache của B chứa 0 marker A; đọc cache A dưới GUC tenant B ⇒ 0 row", async () => {
      await truncateCacheOnly(direct, companyIds); // ép cache-miss sạch (GIỮ configs để re-warm có catalog).
      // Warm cache CẢ HAI tenant (widgets include_data ghi cache mỗi widget).
      await getAs(email.aViewer, A, "/dashboard/widgets?dashboard_type=Employee&include_data=true");
      await getAs(email.bViewer, B, "/dashboard/widgets?dashboard_type=Employee&include_data=true");
      await getAs(email.bViewer, B, "/dashboard/widgets?dashboard_type=HR&include_data=true");

      const bRows = await direct.query(
        "SELECT cache_key, data FROM dashboard_widget_cache WHERE company_id=$1 AND deleted_at IS NULL",
        [B.companyId],
      );
      expectNoAMarkers(JSON.stringify(bRows.rows), "cache rows B");

      // RLS+FORCE (trong transaction để GUC bền qua SELECT). ANTI-VACUOUS: dưới GUC tenant A PHẢI thấy row
      // cache A (≥1); dưới GUC tenant B ⇒ 0 ⇒ chứng "0" là do RLS chặn cross-tenant, KHÔNG do rỗng/mất-GUC.
      const seenByA = await asTenant(A.companyId, (c) =>
        c.query(
          "SELECT id FROM dashboard_widget_cache WHERE company_id = $1 AND deleted_at IS NULL",
          [A.companyId],
        ),
      );
      expect(seenByA.rows.length, "sanity: cache A tồn tại (đọc dưới tenant A)").toBeGreaterThan(0);

      const leak = await asTenant(B.companyId, (c) =>
        c.query(
          "SELECT id FROM dashboard_widget_cache WHERE company_id = $1 AND deleted_at IS NULL",
          [A.companyId],
        ),
      );
      expect(leak.rows.length, "RLS: cache A đọc được dưới tenant B").toBe(0);
    });

    // ── XT3 project-progress cross-tenant → 404 (không lộ tồn tại dự án A) ────────────────────────────
    it("XT3 project-progress: viewerB + project_id CỦA A ⇒ 404 (không lộ tồn tại) + response không chứa marker A", async () => {
      const rb = await getAs(
        email.bViewer,
        B,
        `/dashboard/widgets/project-progress?project_id=${aProjectId}`,
      );
      expect(rb.status).toBe(404);
      expectNoAMarkers(JSON.stringify(rb.body), "B project-progress(A-id)");
    });

    // ── XT4 project-member scope KHÔNG nới cross-tenant: RLS+FORCE chặn ở TẦNG DB (BẤT BIẾN §1/§2) ─────
    it("XT4 RLS+FORCE: dưới GUC tenant B, project A + task-của-project A ⇒ 0 row (company_id + RLS chặn, không nhờ kỷ luật service)", async () => {
      // ANTI-VACUOUS: dưới GUC tenant A, project A + task ĐỀU thấy (≥1) ⇒ "0 dưới B" là do RLS, KHÔNG do rỗng.
      const inA = await asTenant(A.companyId, async (c) => ({
        proj: await c.query("SELECT id FROM projects WHERE id = $1", [aProjectId]),
        projTasks: await c.query("SELECT id FROM tasks WHERE project_id = $1", [aProjectId]),
      }));
      expect(inA.proj.rows.length, "sanity: project A đọc được dưới tenant A").toBe(1);
      expect(
        inA.projTasks.rows.length,
        "sanity: task-của-project A đọc được dưới tenant A",
      ).toBeGreaterThan(0);

      // Dưới GUC tenant B: project A + task-của-project A + task overdue A ĐỀU 0 row (RLS+FORCE chặn — không
      // phụ thuộc kỷ luật service; project-member scope KHÔNG BAO GIỜ nới quyền đọc row của tenant khác).
      const inB = await asTenant(B.companyId, async (c) => ({
        proj: await c.query("SELECT id FROM projects WHERE id = $1", [aProjectId]),
        projTasks: await c.query("SELECT id FROM tasks WHERE project_id = $1", [aProjectId]),
        overdue: await c.query("SELECT id FROM tasks WHERE id = $1", [aTaskId]),
      }));
      expect(inB.proj.rows.length, "RLS: project A đọc được dưới tenant B").toBe(0);
      expect(inB.projTasks.rows.length, "RLS: task-của-project A đọc được dưới tenant B").toBe(0);
      expect(inB.overdue.rows.length, "RLS: task overdue A đọc được dưới tenant B").toBe(0);
    });
  },
);
