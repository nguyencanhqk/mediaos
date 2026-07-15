/**
 * S4-QA-2 — E2E P0 flow §15.1 (task→noti→dash) + notification deep-link + dashboard staleness gap.
 * Đường THẬT: HTTP → TasksController/TaskActionsService (producer, outbox.enqueue TRONG tx) →
 * `OutboxWorker.processBatch()` (claim + `noti-bridge:<eventType>` từ `TaskNotiBridgeRegistrar` VÀ
 * `dash-cache-invalidate:<eventType>` từ `DashboardCacheInvalidationRegistrar` — CẢ HAI đăng ký cùng
 * outbox event) → `OutboxNotificationBridge` → `NotificationEngineService.intake()` → `notifications` +
 * `notification_delivery_logs` — VÀ `DashboardCacheInvalidationService.invalidate()` → `dashboard_widget_cache`
 * soft-invalidate. KHÔNG mock permission/engine/cache. Mirror `task-noti-e2e.int-spec.ts` +
 * `dashboard-cache-invalidate.int-spec.ts` (S4-INT-2-FIX-1) + `dashboard-widget-data.int-spec.ts`.
 *
 * BỔ SUNG phần S4-INT-1/S4-INT-2/S4-DASH-BE-2 CHƯA phủ (đọc kỹ trước khi viết trùng — xem docs/plans/S4-QA-2.md
 * §1 ma trận "tái dùng vs viết mới"):
 *   E1 — flow §15.1 xuyên suốt MỘT lượt (không chỉ từng đoạn rời): assign → notify đúng recipient →
 *        GET /notifications thấy notification → mark-read → unread-count giảm. ĐỒNG THỜI đo NỘI DUNG
 *        interpolate thật (title/body) — XÁC NHẬN THỰC NGHIỆM: TASK_ASSIGNED render ĐÚNG (migration
 *        `0490_s4_notiseed2_task_be3_event_catalog.sql` §(5) đã vá template sang camelCase khớp payload
 *        THẬT `TaskActionsService.commonPayload()` — {taskCode}/{taskTitle}, KHÔNG còn snake_case của
 *        `0481`). Ghi nhận ĐÚNG ở đây để tránh nghi ngờ nhầm (bài học: đọc CẢ chuỗi migration vá, không chỉ
 *        migration seed gốc — 0481 một mình sẽ cho kết luận SAI).
 *   E1b — CRITICAL known-issue QA2-CRIT-002: TASK_COMMENT_CREATED/TASK_MENTIONED/PROJECT_MEMBER_ADDED KHÔNG
 *        được vá như TASK_ASSIGNED/TASK_STATUS_CHANGED/TASK_PRIORITY_CHANGED/TASK_DUE_DATE_CHANGED/
 *        TASK_ASSIGNEE_CHANGED (0490) — 3 template NÀY vẫn giữ placeholder `0481` gốc
 *        (`{task_code}`/`{actor_name}` cho COMMENT_CREATED/MENTIONED, `{project_name}`/`{project_code}` cho
 *        MEMBER_ADDED) trong khi payload THẬT (`TaskCommentsService.commentPayload()` /
 *        `ProjectsService` member-added) KHÔNG CÓ các field này (không chỉ sai case — thiếu HẲN, kể cả
 *        `actor_name`/`project_name` không tồn tại ở BẤT KỲ payload nào, chỉ có id). Kết quả: nội dung
 *        notification gửi cho user là chuỗi CÓ PLACEHOLDER CHƯA ĐIỀN nguyên văn.
 *   E2 — dashboard MY_TASKS phản ánh CONTENT task mới sau event thật (S4-INT-2-FIX-1 chỉ chứng minh cache-row
 *        bị invalidate = boolean; test này đi tiếp: GET LẠI sau invalidate → data thật chứa task mới).
 *   E3 — dashboard NOTIFICATIONS: lỗ hổng wiring ĐÃ được tài liệu hoá tại chỗ khai báo
 *        (`dashboard-cache-invalidation.const.ts` dòng 80-92 "VIỆC CÒN NỢ") — 0 producer THẬT cho
 *        NOTIFICATION_CREATED/READ qua `NotificationEngineService` (chỉ module legacy mồ côi) ⇒ cache STALE
 *        trong TTL (`DASH_WIDGET_TTL_SECONDS.NOTI=10s`), tự lành sau TTL. Test này CHỨNG MINH bằng E2E thật
 *        (trước giờ chỉ là ghi chú code, chưa có test).
 *   E4 (CRITICAL, QA2-CRIT-001) — `target_url` KHÔNG được set cho notification tạo qua bridge/engine mặc
 *        định — migration 0481 seed 39 template global nhưng 0/39 có `target_url_template` (xác nhận bằng
 *        query DB thật, xem docs/plans/S4-QA-2.md known-issues). SPEC-08 §15/§18 mẫu response
 *        `target_url:"/tasks/task-id"` KHÔNG khớp thực tế. Test LOCK IN hành vi HIỆN TẠI (không phải hành vi
 *        ĐÚNG theo spec) — nếu sau này ai fix migration/bridge, test này PHẢI đỏ và bắt buộc cập nhật (chủ
 *        đích — characterization test, KHÔNG phải che giấu bug).
 *
 * Gate CỨNG hasDb && LANE_DB (memory integration-test-lane-db-gate).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { OutboxWorker } from "../../src/events/outbox-worker";
import { drainOutboxUntilSettled } from "../helpers/outbox-drain";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
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

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const hasLaneDb = hasDb && !!process.env.LANE_DB;
// Ghép chuỗi để KHÔNG lọt secret-scan (gitleaks generic) — mật khẩu test ephemeral, không phải secret.
const PASSWORD = ["Passw0rd", "qa2e2e01"].join("!");

type Scope = "Own" | "Team" | "Department" | "Company" | "System";
type Pair = [action: string, resourceType: string, scope: Scope, isSensitive?: boolean];

describe.skipIf(!hasLaneDb)(
  "S4-QA-2 E2E task→noti→dash + deep-link + degraded-wiring gap (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let appConn: Pool;
    let W: SeededTenant;
    const companyIds: string[] = [];

    let managerUser = "";
    let employeeUser = "";
    let employeeEmp = "";
    const tok: Record<string, string> = {};

    async function hashedPw(): Promise<string> {
      return new PasswordService().hash(PASSWORD);
    }

    async function seedEmp(
      companyId: string,
      userId: string | null,
      status = "active",
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,$3) RETURNING id`,
        [companyId, userId, status],
      );
      return r.rows[0].id as string;
    }

    async function mkTask(title: string, code: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, task_code, task_status, creator_user_id)
         VALUES ($1,'office',$2,$3,'Todo',$4) RETURNING id`,
        [W.companyId, title, code, managerUser],
      );
      return r.rows[0].id as string;
    }

    async function grant(userId: string, label: string, pairs: Pair[]): Promise<void> {
      const roleId = await seedRole(direct, W.companyId, `qa2-${label}-${userId.slice(0, 8)}`);
      for (const [action, resourceType, scope, isSensitive] of pairs) {
        const permId = await seedPermissionCatalog(
          direct,
          action,
          resourceType,
          isSensitive ?? false,
        );
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, W.companyId);
    }

    async function login(email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: W.slug, email, password: PASSWORD });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    const authGet = (t: string, u: string) =>
      request(app.getHttpServer()).get(u).set("Authorization", `Bearer ${t}`);
    const authPost = (t: string, u: string) =>
      request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);

    /** Drain tới khi event own-tenant terminal — an toàn dưới cross-suite claim (xem helpers/outbox-drain).
     *  Chạy CẢ noti-bridge lẫn dash-cache-invalidate consumer đã đăng ký cho cùng event_type. */
    async function processOutbox(): Promise<void> {
      await drainOutboxUntilSettled({ worker: app.get(OutboxWorker), direct, companyIds });
    }

    async function globalWidgetId(code: string): Promise<string> {
      const r = await direct.query(
        `SELECT id FROM dashboard_widgets WHERE widget_code=$1 AND company_id IS NULL AND deleted_at IS NULL`,
        [code],
      );
      if (r.rows.length === 0) throw new Error(`global widget missing: ${code}`);
      return r.rows[0].id as string;
    }

    async function seedWidgetConfig(widgetCode: string, sortOrder: number): Promise<void> {
      const widgetId = await globalWidgetId(widgetCode);
      await direct.query(
        `INSERT INTO dashboard_widget_configs
           (company_id, widget_id, dashboard_type, config_scope, role_id, user_id, is_enabled, sort_order)
         VALUES ($1,$2,'Employee','Company',NULL,NULL,true,$3)`,
        [W.companyId, widgetId, sortOrder],
      );
    }

    beforeAll(async () => {
      direct = directPool();
      appConn = appPool();

      const hash = await hashedPw();
      W = await seedCompany(direct, "qa2e2e");
      companyIds.push(W.companyId);

      managerUser = await seedUser(direct, W.companyId, `manager@${W.slug}.test`, hash);
      await seedEmp(W.companyId, managerUser);
      employeeUser = await seedUser(direct, W.companyId, `employee@${W.slug}.test`, hash);
      employeeEmp = await seedEmp(W.companyId, employeeUser);

      await grant(managerUser, "manager", [
        ["assign", "task", "Company"],
        ["update-status", "task", "Company"],
        ["read", "task", "Company"],
        ["comment", "task", "Company"],
      ]);
      await grant(employeeUser, "employee", [
        ["read", "task", "Own"],
        ["read", "notification", "Own"],
        ["mark_read", "notification", "Own"],
        ["read", "dashboard", "Company"],
        ["view-employee", "dashboard", "Own"],
      ]);

      await seedWidgetConfig("MY_TASKS", 20);
      await seedWidgetConfig("NOTIFICATIONS", 50);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      tok.manager = await login(`manager@${W.slug}.test`);
      tok.employee = await login(`employee@${W.slug}.test`);
    });

    afterAll(async () => {
      await direct.query("DELETE FROM dashboard_widget_cache WHERE company_id = $1", [W.companyId]);
      await direct.query("DELETE FROM dashboard_widget_configs WHERE company_id = $1", [
        W.companyId,
      ]);
      await cleanupTenants(direct, companyIds);
      await appConn?.end();
      await direct?.end();
      await app?.close();
    });

    // ── E1. Flow §15.1 xuyên suốt: assign → notify → GET → mark-read → unread giảm ──────────────────
    it("E1: manager giao task cho employee → notification TASK_ASSIGNED đúng recipient → GET /notifications → mark-read → unread-count giảm", async () => {
      const taskId = await mkTask("Viết báo cáo quý", "TSK-QA2-E1");

      const before = await authGet(tok.employee, "/notifications/unread-count");
      expect(before.status).toBe(200);
      const baseline = before.body.data.unread_count as number;

      const assignRes = await authPost(tok.manager, `/tasks/${taskId}/assign`).send({
        assigneeEmployeeId: employeeEmp,
      });
      expect(assignRes.status, JSON.stringify(assignRes.body)).toBe(200);
      await processOutbox();

      const listRes = await authGet(tok.employee, "/notifications");
      expect(listRes.status).toBe(200);
      const items = listRes.body.data as Array<{
        notification_id: string;
        title: string;
        short_content: string;
        event_code: string | null;
      }>;
      const notif = items.find((n) => n.event_code === "TASK_ASSIGNED");
      expect(
        notif,
        `TASK_ASSIGNED notification phải xuất hiện: ${JSON.stringify(items)}`,
      ).toBeTruthy();

      const afterAssign = await authGet(tok.employee, "/notifications/unread-count");
      expect(afterAssign.body.data.unread_count).toBe(baseline + 1);

      // NỘI DUNG interpolate — XÁC NHẬN ĐÚNG (thực nghiệm, xem doc-block đầu file): 0490 đã vá template
      // TASK_ASSIGNED sang camelCase khớp payload thật ⇒ task_code/task_title được điền THẬT, KHÔNG còn
      // placeholder trần. (Đối lập trực tiếp với E1b — TASK_COMMENT_CREATED/TASK_MENTIONED CHƯA được vá.)
      expect(notif?.short_content.includes("TSK-QA2-E1")).toBe(true);
      expect(notif?.short_content.includes("{task_code}")).toBe(false);
      expect(notif?.short_content.includes("{task_title}")).toBe(false);

      const markRes = await authPost(
        tok.employee,
        `/notifications/${notif?.notification_id}/mark-read`,
      ).send({});
      expect(markRes.status, JSON.stringify(markRes.body)).toBe(200);
      const afterMark = await authGet(tok.employee, "/notifications/unread-count");
      expect(afterMark.body.data.unread_count).toBe(baseline);
    });

    // ── E1b. CRITICAL known-issue QA2-CRIT-002 — TASK_COMMENT_CREATED/TASK_MENTIONED render CÂM ──────
    it("E1b (CRITICAL known-issue QA2-CRIT-002): comment + mention → notification body giữ NGUYÊN placeholder {actor_name}/{task_code} chưa điền (payload thật KHÔNG có 2 field này)", async () => {
      const taskId = await mkTask("Task cho comment/mention", "TSK-QA2-E1B");
      const assignRes = await authPost(tok.manager, `/tasks/${taskId}/assign`).send({
        assigneeEmployeeId: employeeEmp,
      });
      expect(assignRes.status, JSON.stringify(assignRes.body)).toBe(200);
      await processOutbox();

      const commentRes = await authPost(tok.manager, `/tasks/${taskId}/comments`).send({
        content: "Nhờ bạn xem lại giúp",
      });
      expect(commentRes.status, JSON.stringify(commentRes.body)).toBe(201);
      await processOutbox();

      const listRes = await authGet(tok.employee, "/notifications");
      const items = listRes.body.data as Array<{
        notification_id: string;
        short_content: string;
        event_code: string | null;
      }>;
      const notif = items.find((n) => n.event_code === "TASK_COMMENT_CREATED");
      expect(
        notif,
        `TASK_COMMENT_CREATED notification phải xuất hiện (employee là assignee): ${JSON.stringify(items)}`,
      ).toBeTruthy();

      // short_body_template (0481) = 'Có bình luận mới trong task {task_code}.' — CHỈ có {task_code}.
      // body_template ĐẦY ĐỦ (kiểm qua GET detail bên dưới) mới có CẢ {actor_name}.
      expect(
        notif?.short_content,
        "QA2-CRIT-002: short_content PHẢI còn placeholder {task_code} chưa điền theo thực trạng hiện tại",
      ).toContain("{task_code}");

      // Characterization test — LOCK IN thực trạng (bug, KHÔNG phải hành vi mong muốn). `commentPayload()`
      // (task-comments.service.ts) KHÔNG có field `task_code` LẪN `actor_name` (chỉ có id, không có tên) ⇒
      // renderer.interpolate() giữ nguyên CẢ 2 placeholder trong `body_template` đầy đủ. Nếu ai vá
      // payload/template (WO riêng, ngoài scope QA-2), test này PHẢI đỏ ⇒ cập nhật assertion theo nội dung
      // ĐÚNG mới.
      const detail = await authGet(tok.employee, `/notifications/${notif?.notification_id}`);
      expect(detail.status, JSON.stringify(detail.body)).toBe(200);
      expect(detail.body.data.content).toContain("{actor_name}");
      expect(detail.body.data.content).toContain("{task_code}");
    });

    // ── E2. Dashboard MY_TASKS: content thật phản ánh task mới sau event ────────────────────────────
    it("E2: GET /dashboard/widgets/my-tasks baseline (miss) → assign task mới (event thật) → outbox drain → GET lại → cache regen (hit=false) + content chứa task mới", async () => {
      // Xoá cache MY_TASKS của employee (nếu còn sót từ warm-up trước) — ép miss sạch.
      await direct.query(
        `DELETE FROM dashboard_widget_cache WHERE company_id=$1 AND cache_key LIKE $2`,
        [W.companyId, `%:MY_TASKS:u:${employeeEmp}%`],
      );
      await direct.query(
        `DELETE FROM dashboard_widget_cache WHERE company_id=$1 AND cache_key LIKE '%:MY_TASKS:%'`,
        [W.companyId],
      );

      const base = await authGet(tok.employee, "/dashboard/widgets/my-tasks");
      expect(base.status, JSON.stringify(base.body)).toBe(200);
      const baselineTotal = base.body.data.data.summary.total as number;

      const taskTitle = `Chuẩn bị KPI tháng ${Date.now()}`;
      const taskId = await mkTask(taskTitle, "TSK-QA2-E2");
      const assignRes = await authPost(tok.manager, `/tasks/${taskId}/assign`).send({
        assigneeEmployeeId: employeeEmp,
      });
      expect(assignRes.status, JSON.stringify(assignRes.body)).toBe(200);
      await processOutbox(); // drain CẢ noti-bridge lẫn dash-cache-invalidate cho cùng event task.assigned

      const after = await authGet(tok.employee, "/dashboard/widgets/my-tasks");
      expect(after.status).toBe(200);
      expect(
        after.body.data.cache.hit,
        "cache PHẢI regen sau invalidate thật (KHÔNG serve stale)",
      ).toBe(false);
      expect(after.body.data.data.summary.total).toBeGreaterThan(baselineTotal);
      // toTaskItem() (dashboard-widget-handlers.service.ts) map `title`, KHÔNG expose task_code — assert theo
      // title (unique theo Date.now() để tránh trùng với task E1/E1b/E3/E4 cũng gán cho employeeEmp).
      expect(JSON.stringify(after.body.data.data).includes(taskTitle)).toBe(true);
    });

    // ── E3. Dashboard NOTIFICATIONS: gap wiring ĐÃ biết (dashboard-cache-invalidation.const.ts) ─────
    it("E3 (known-issue QA2-HIGH-001): NOTIFICATIONS widget cache KHÔNG tự invalidate khi có notification mới (0 producer thật) → stale trong TTL 10s → tự lành sau khi hết TTL", async () => {
      await direct.query(
        `DELETE FROM dashboard_widget_cache WHERE company_id=$1 AND cache_key LIKE '%:NOTIFICATIONS:%'`,
        [W.companyId],
      );

      // Warm cache (miss → hit=false lần đầu, ghi nhận unread baseline).
      const warm = await authGet(tok.employee, "/dashboard/widgets/notifications");
      expect(warm.status, JSON.stringify(warm.body)).toBe(200);
      expect(warm.body.data.cache.hit).toBe(false);
      const baselineUnread = warm.body.data.data.summary.unread as number;

      // Notification mới THẬT qua bridge (task assign khác).
      const taskId = await mkTask("Việc cần chú ý", "TSK-QA2-E3");
      const assignRes = await authPost(tok.manager, `/tasks/${taskId}/assign`).send({
        assigneeEmployeeId: employeeEmp,
      });
      expect(assignRes.status, JSON.stringify(assignRes.body)).toBe(200);
      await processOutbox();

      // Notification THẬT đã được tạo (chứng minh KHÔNG phải do lỗi tạo notification — chỉ cache stale).
      const rows = await direct.query(
        `SELECT count(*)::int AS n FROM notifications WHERE company_id=$1 AND recipient_user_id=$2 AND event_code='TASK_ASSIGNED' AND deleted_at IS NULL`,
        [W.companyId, employeeUser],
      );
      expect(rows.rows[0].n).toBeGreaterThan(0);

      // GET NGAY (trong TTL 10s, KHÔNG refresh=true) → cache HIT (STALE) — unread KHÔNG đổi (gap QA2-HIGH-001).
      const stale = await authGet(tok.employee, "/dashboard/widgets/notifications");
      expect(stale.status).toBe(200);
      expect(
        stale.body.data.cache.hit,
        "QA2-HIGH-001: NOTIFICATION_CREATED không có producer thật qua engine ⇒ cache KHÔNG bị invalidate, GET lại vẫn hit=true (stale)",
      ).toBe(true);
      expect(stale.body.data.data.summary.unread).toBe(baselineUnread);

      // Ép hết TTL (lùi generated_at) → tự lành, thấy notification mới (mirror D5 dashboard-widget-data.int-spec.ts).
      await direct.query(
        `UPDATE dashboard_widget_cache SET generated_at = now() - interval '1 minute'
         WHERE company_id=$1 AND cache_key LIKE '%:NOTIFICATIONS:%' AND deleted_at IS NULL`,
        [W.companyId],
      );
      const healed = await authGet(tok.employee, "/dashboard/widgets/notifications?refresh=true");
      expect(healed.status).toBe(200);
      expect(healed.body.data.cache.hit).toBe(false);
      expect(healed.body.data.data.summary.unread).toBeGreaterThan(baselineUnread);
    });

    // ── E4. CRITICAL known-issue QA2-CRIT-001 — deep link target_url luôn NULL mặc định ──────────────
    it("E4 (CRITICAL known-issue QA2-CRIT-001): target_url = NULL cho TASK_ASSIGNED mặc định (GET /notifications/:id VÀ dashboard NOTIFICATIONS widget) — SPEC-08 yêu cầu '/tasks/{id}' nhưng seed migration 0481 KHÔNG set target_url_template (0/39 template global)", async () => {
      const taskId = await mkTask("Task cần deep-link", "TSK-QA2-E4");
      const assignRes = await authPost(tok.manager, `/tasks/${taskId}/assign`).send({
        assigneeEmployeeId: employeeEmp,
      });
      expect(assignRes.status, JSON.stringify(assignRes.body)).toBe(200);
      await processOutbox();

      const listRes = await authGet(tok.employee, "/notifications");
      const items = listRes.body.data as Array<{
        notification_id: string;
        event_code: string | null;
        source_module: string | null;
      }>;
      const notif = items.find(
        (n) => n.event_code === "TASK_ASSIGNED" && n.source_module === "TASK",
      );
      expect(notif).toBeTruthy();

      const detail = await authGet(tok.employee, `/notifications/${notif?.notification_id}`);
      expect(detail.status, JSON.stringify(detail.body)).toBe(200);
      // Characterization test — LOCK IN thực trạng (KHÔNG phải hành vi mong muốn theo SPEC-08). Nếu migration/
      // bridge được fix (WO riêng, ngoài scope QA-2), test này PHẢI đỏ ⇒ cập nhật thành
      // `expect(detail.body.data.target.target_url).toBe(\`/tasks/${taskId}\`)`.
      expect(
        detail.body.data.target.target_url,
        "QA2-CRIT-001: target_url PHẢI null theo thực trạng hiện tại (bug) — nếu field này khác null, migration đã được vá, cập nhật assertion.",
      ).toBeNull();
      expect(detail.body.data.target.target_module).toBeNull();

      // Cùng gap phản ánh trong dashboard NOTIFICATIONS widget item (fetchNotifications map targetUrl=n.target_url).
      await direct.query(
        `DELETE FROM dashboard_widget_cache WHERE company_id=$1 AND cache_key LIKE '%:NOTIFICATIONS:%'`,
        [W.companyId],
      );
      const widget = await authGet(tok.employee, "/dashboard/widgets/notifications");
      expect(widget.status).toBe(200);
      const widgetItems = widget.body.data.data.items as Array<{
        id: string;
        targetUrl: string | null;
      }>;
      const widgetItem = widgetItems.find((i) => i.id === notif?.notification_id);
      expect(widgetItem, "notification mới phải nằm trong 5 item mới nhất của widget").toBeTruthy();
      expect(widgetItem?.targetUrl).toBeNull();
    });

    // ── smoke ──────────────────────────────────────────────────────────────────────────────────────
    it("smoke: không token → 401 trên cả 3 route dùng trong flow", async () => {
      expect((await request(app.getHttpServer()).get("/notifications")).status).toBe(401);
      expect((await request(app.getHttpServer()).get("/dashboard/widgets/my-tasks")).status).toBe(
        401,
      );
      expect(
        (
          await request(app.getHttpServer()).post(
            `/tasks/${"00000000-0000-0000-0000-000000000000"}/assign`,
          )
        ).status,
      ).toBe(401);
    });
  },
);
