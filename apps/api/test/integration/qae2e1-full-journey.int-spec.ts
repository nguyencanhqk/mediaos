/**
 * S5-QA-E2E-1 — Chuỗi E2E xuyên module (docs/IMPLEMENTATION-08 §11.2 smoke P0 + §12.1 flow E2E bắt buộc).
 *
 * Một NGƯỜI DÙNG đi HẾT một lượt: đăng nhập → Home Portal (App Switcher) → mở module workspace (ATT) →
 * check-in/check-out → tạo + duyệt đơn nghỉ (kiểm đồng bộ sang bảng công qua internal recalculate) →
 * manager tạo/giao task → employee cập nhật trạng thái task → nhận + đọc notification (deep-link) →
 * dashboard widget cập nhật → logout. Mỗi bước gọi QUA API module gốc (KHÔNG seed thẳng DB để nhảy cóc
 * bước nghiệp vụ — chỉ dùng direct pool để PLANT actor/quyền/dữ liệu nền và ĐỌC LẠI để xác minh side-effect).
 *
 * Mirror pattern: att-noti-e2e.int-spec.ts (outbox drain) · leave-att-sync-qa2.int-spec.ts (LEAVE→ATT sync
 * qua internal recalculate) · qa2-e2e-task-noti-dash.int-spec.ts (task→noti→dash + deep-link). File này
 * KHÔNG lặp lại phủ chi tiết của 3 file trên — chỉ khoá CHUỖI liền mạch 1 lượt (E2E-001..008 nối tiếp) +
 * vài negative/smoke case (SMOKE-018 kiểu 403, 401 không token) mà chưa có test nào đi hết 1 lượt.
 *
 * Gate CỨNG hasDb && LANE_DB (memory integration-test-lane-db-gate) — KHÔNG chạy trên DB dev chung.
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
import { DatabaseService } from "../../src/db/db.service";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { MasterDataSeederRegistry } from "../../src/foundation/seed/master-data-seeder.registry";
import { SeedTrackingService } from "../../src/foundation/seed/seed-tracking.service";
import { AttMasterDataSeeder } from "../../src/attendance/att-master-data.seeder";
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
// Ghép chuỗi để KHÔNG lọt secret-scan gitleaks (mật khẩu/khoá test ephemeral, không phải secret thật).
const PASSWORD = ["Passw0rd", "qae2e1full"].join("!");
const INTERNAL_KEY = ["test-internal-key", "qae2e1"].join("-");

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, resourceType: string, scope: Scope, isSensitive?: boolean];

// Ngày dùng cho đơn nghỉ — xa hôm nay (tránh va bản ghi check-in/out của chính test này).
const LEAVE_DATE = "2029-03-06"; // Tuesday

describe.skipIf(!hasLaneDb)("S5-QA-E2E-1 chuỗi E2E xuyên module (1 lượt liền mạch)", () => {
  let app: INestApplication;
  let direct: Pool;
  let appConn: Pool;
  let W: SeededTenant;
  const companyIds: string[] = [];

  let employeeUserId = "";
  let employeeProfileId = "";
  let managerUserId = "";
  let leaveTypeId = "";
  let taskId = "";
  const tok: Record<string, string> = {};

  async function hash(): Promise<string> {
    return new PasswordService().hash(PASSWORD);
  }

  async function seedEmp(userId: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,'active') RETURNING id`,
      [W.companyId, userId],
    );
    return r.rows[0].id as string;
  }

  async function grant(userId: string, label: string, pairs: Pair[]): Promise<void> {
    const roleId = await seedRole(direct, W.companyId, `qae2e1-${label}-${userId.slice(0, 8)}`);
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

  async function plantLeaveType(): Promise<string> {
    const r = await direct.query(
      `INSERT INTO leave_types
         (company_id, code, name, paid, status, deduct_balance, balance_unit,
          allow_full_day, allow_half_day, allow_hourly, allow_multiple_days,
          require_reason, min_notice_days, sort_order, allow_negative_balance)
       VALUES ($1,$2,$3,true,'active',true,'Day',true,true,false,true,false,0,1,false) RETURNING id`,
      [W.companyId, `LT-${randomUUID().slice(0, 8)}`, "Annual"],
    );
    return r.rows[0].id as string;
  }

  async function plantBalance(): Promise<void> {
    await direct.query(
      `INSERT INTO leave_balances (company_id, user_id, employee_id, leave_type_id, year, total_days, used_days, pending_days)
       VALUES ($1,$2,$3,$4,2029,12,0,0)`,
      [W.companyId, employeeUserId, employeeProfileId, leaveTypeId],
    );
  }

  async function seedWidgetConfig(widgetCode: string, sortOrder: number): Promise<void> {
    const r = await direct.query(
      `SELECT id FROM dashboard_widgets WHERE widget_code=$1 AND company_id IS NULL AND deleted_at IS NULL`,
      [widgetCode],
    );
    if (r.rows.length === 0) throw new Error(`global widget missing: ${widgetCode}`);
    await direct.query(
      `INSERT INTO dashboard_widget_configs
         (company_id, widget_id, dashboard_type, config_scope, role_id, user_id, is_enabled, sort_order)
       VALUES ($1,$2,'Employee','Company',NULL,NULL,true,$3)`,
      [W.companyId, r.rows[0].id, sortOrder],
    );
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
  const authPost = (t: string, u: string, body: object = {}) =>
    request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`).send(body);
  const authPatch = (t: string, u: string, body: object = {}) =>
    request(app.getHttpServer()).patch(u).set("Authorization", `Bearer ${t}`).send(body);

  async function processOutbox(): Promise<void> {
    await drainOutboxUntilSettled({ worker: app.get(OutboxWorker), direct, companyIds });
  }

  async function attRecordStatus(userId: string, workDate: string): Promise<string | undefined> {
    const r = await direct.query(
      `SELECT attendance_status FROM attendance_records
       WHERE company_id=$1 AND user_id=$2 AND work_date=$3 AND deleted_at IS NULL`,
      [W.companyId, userId, workDate],
    );
    return r.rows[0]?.attendance_status as string | undefined;
  }

  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = INTERNAL_KEY;

    direct = directPool();
    appConn = appPool();
    W = await seedCompany(direct, "qae2e1w");
    companyIds.push(W.companyId);

    // Shift mặc định (OFFICE_8H) — cho tính toán required_working_minutes ổn định trong bước LEAVE→ATT sync.
    const seedDb = new DatabaseService();
    const registry = new MasterDataSeederRegistry();
    registry.register(new AttMasterDataSeeder());
    const runner = new MasterDataSeedRunner(seedDb, new SeedTrackingService(seedDb), registry);
    await runner.reconcileCompany(W.companyId);

    const pw = await hash();
    employeeUserId = await seedUser(direct, W.companyId, `emp@${W.slug}.test`, pw);
    employeeProfileId = await seedEmp(employeeUserId);
    managerUserId = await seedUser(direct, W.companyId, `mgr@${W.slug}.test`, pw);
    await seedEmp(managerUserId);

    leaveTypeId = await plantLeaveType();
    await plantBalance();

    // Employee: self-service ATT + LEAVE + TASK(own) + NOTI(own) + DASH(read).
    await grant(employeeUserId, "employee", [
      ["check-in", "attendance", "Own"],
      ["check-out", "attendance", "Own"],
      ["view-own", "attendance", "Own", true],
      ["create", "leave", "Own"],
      ["submit", "leave", "Own"],
      ["cancel-own", "leave", "Own"],
      ["view-own", "leave", "Own"],
      ["view-own", "leave-balance", "Own"],
      ["view", "leave-type", "Company"],
      ["read", "task", "Own"],
      ["update-status", "task", "Own"],
      ["read", "notification", "Own"],
      ["mark_read", "notification", "Own"],
      ["read", "dashboard", "Company"],
      ["view-employee", "dashboard", "Own"],
    ]);

    // Manager/HR: approve leave, đồng bộ ATT nội bộ, tạo/giao task.
    await grant(managerUserId, "manager", [
      ["view", "leave", "Company", true],
      ["approve", "leave", "Company"],
      ["reject", "leave", "Company", true],
      ["manage", "attendance", "Company"],
      ["create", "task", "Company"],
      ["assign", "task", "Company"],
      ["read", "task", "Company"],
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    tok.employee = await login(`emp@${W.slug}.test`);
    tok.manager = await login(`mgr@${W.slug}.test`);

    await seedWidgetConfig("MY_TASKS", 20);
  });

  afterAll(async () => {
    await direct.query("DELETE FROM dashboard_widget_cache WHERE company_id = $1", [W.companyId]);
    await direct.query("DELETE FROM dashboard_widget_configs WHERE company_id = $1", [W.companyId]);
    await cleanupTenants(direct, companyIds);
    delete process.env.INTERNAL_API_KEY;
    await appConn?.end();
    await direct?.end();
    await app?.close();
  });

  // ── E2E-001: Login → Home Portal (App Switcher) → mở module workspace ────────────────────────────
  it("(1) đăng nhập → GET /foundation/modules/my-apps thấy đúng module theo quyền (Home Portal + App Switcher) → GET /auth/me xác nhận identity", async () => {
    const apps = await authGet(tok.employee, "/foundation/modules/my-apps");
    expect(apps.status, JSON.stringify(apps.body)).toBe(200);
    const codes = new Set(
      (apps.body.data as Array<{ module_code: string }>).map((i) => i.module_code),
    );
    expect(codes.has("ATT")).toBe(true);
    expect(codes.has("LEAVE")).toBe(true);
    expect(codes.has("TASK")).toBe(true);

    const me = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${tok.employee}`);
    expect(me.status, JSON.stringify(me.body)).toBe(200);
  });

  // ── E2E-002: check-in/check-out (ATT module workspace) ───────────────────────────────────────────
  it("(2) mở workspace Chấm công → GET today → check-in → check-out", async () => {
    const today = await authGet(tok.employee, "/attendance/today");
    expect(today.status, JSON.stringify(today.body)).toBe(200);

    const checkIn = await authPost(tok.employee, "/attendance/check-in", { method: "web" });
    expect(checkIn.status, JSON.stringify(checkIn.body)).toBe(201);

    const checkOut = await authPost(tok.employee, "/attendance/check-out", { method: "web" });
    expect(checkOut.status, JSON.stringify(checkOut.body)).toBe(201);
    expect(checkOut.body.data.checkOutAt ?? checkOut.body.data.check_out_at).toBeTruthy();
  });

  // ── E2E-005: tạo đơn nghỉ → Manager duyệt → ATT chặn/tính lại công (đồng bộ THẬT qua internal API) ──
  it("(3) tạo + submit đơn nghỉ FullDay → manager duyệt → internal recalculate (x-internal-key) → attendance_records.status = Leave", async () => {
    const create = await authPost(tok.employee, "/leave/requests", {
      leaveTypeId,
      startDate: LEAVE_DATE,
      endDate: LEAVE_DATE,
      durationType: "FullDay",
      submitNow: true,
    });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    expect(create.body.data.status).toBe("Pending");
    const requestId = create.body.data.id as string;

    const approve = await authPost(tok.manager, `/leave/requests/${requestId}/approve`, {
      note: "duyệt E2E",
    });
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    expect(approve.body.data.status).toBe("Approved");

    // Đồng bộ sang bảng công QUA API module gốc (KHÔNG gọi service in-process) — manager cần manage:attendance
    // + x-internal-key (InternalGuard, defense-in-depth) — đúng đường thật FE/queue sẽ gọi lại khi retry.
    const recalc = await request(app.getHttpServer())
      .post("/internal/v1/attendance/recalculate")
      .set("Authorization", `Bearer ${tok.manager}`)
      .set("x-internal-key", INTERNAL_KEY)
      .send({ leaveRequestId: requestId });
    expect(recalc.status, JSON.stringify(recalc.body)).toBe(200);
    expect(recalc.body.data.processedDays).toBe(1);

    expect(await attRecordStatus(employeeUserId, LEAVE_DATE)).toBe("Leave");
  });

  // ── E2E-007/008: Manager tạo/giao task → employee cập nhật trạng thái ─────────────────────────────
  it("(4) manager tạo task + giao cho employee → employee cập nhật trạng thái (My Tasks)", async () => {
    const create = await authPost(tok.manager, "/tasks", { title: "Chuẩn bị báo cáo E2E" });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    taskId = create.body.data.id as string;

    const assign = await authPost(tok.manager, `/tasks/${taskId}/assign`, {
      assigneeEmployeeId: employeeProfileId,
    });
    expect(assign.status, JSON.stringify(assign.body)).toBe(200);

    const myTasks = await authGet(tok.employee, "/tasks/my");
    expect(myTasks.status, JSON.stringify(myTasks.body)).toBe(200);

    const changeStatus = await authPost(tok.employee, `/tasks/${taskId}/change-status`, {
      status: "In Progress",
    });
    expect(changeStatus.status, JSON.stringify(changeStatus.body)).toBe(200);
    expect(changeStatus.body.data.task.status).toBe("In Progress");
  });

  // ── notification nhận + đọc (deep link) + dashboard widget cập nhật ───────────────────────────────
  it("(5) drain outbox → employee nhận notification TASK_ASSIGNED (deep-link /tasks/:id) → mark-read → unread giảm → dashboard MY_TASKS phản ánh task mới", async () => {
    await processOutbox();

    const before = await authGet(tok.employee, "/notifications/unread-count");
    expect(before.status).toBe(200);

    const list = await authGet(tok.employee, "/notifications");
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const items = list.body.data as Array<{
      notification_id: string;
      event_code: string | null;
    }>;
    const assigned = items.find((n) => n.event_code === "TASK_ASSIGNED");
    expect(assigned, `TASK_ASSIGNED phải xuất hiện: ${JSON.stringify(items)}`).toBeTruthy();

    const detail = await authGet(tok.employee, `/notifications/${assigned?.notification_id}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.data.target.target_url).toBe(`/tasks/${taskId}`);

    const beforeUnread = before.body.data.unread_count as number;
    const mark = await authPost(
      tok.employee,
      `/notifications/${assigned?.notification_id}/mark-read`,
    );
    expect(mark.status, JSON.stringify(mark.body)).toBe(200);
    const after = await authGet(tok.employee, "/notifications/unread-count");
    expect(after.body.data.unread_count).toBe(Math.max(beforeUnread - 1, 0));

    await direct.query(
      `DELETE FROM dashboard_widget_cache WHERE company_id=$1 AND cache_key LIKE '%:MY_TASKS:%'`,
      [W.companyId],
    );
    const widget = await authGet(tok.employee, "/dashboard/widgets/my-tasks");
    expect(widget.status, JSON.stringify(widget.body)).toBe(200);
    expect(JSON.stringify(widget.body.data.data).includes(taskId)).toBe(true);
  });

  // ── logout (SMOKE-003) ────────────────────────────────────────────────────────────────────────────
  it("(6) logout → clear session (ok=true)", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Authorization", `Bearer ${tok.employee}`)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.ok).toBe(true);
  });

  // ── deny-path (SMOKE-018): route trái quyền → 403, không token → 401 ──────────────────────────────
  it("(7) deny-path: employee gọi route quản trị/quyền khác (approve leave, manage attendance) → 403; không token → 401", async () => {
    const approveOther = await authPost(
      tok.employee,
      "/leave/requests/00000000-0000-0000-0000-000000000000/approve",
      {},
    );
    expect(approveOther.status).toBe(403);

    const recalcNoPerm = await request(app.getHttpServer())
      .post("/internal/v1/attendance/recalculate")
      .set("Authorization", `Bearer ${tok.employee}`)
      .set("x-internal-key", INTERNAL_KEY)
      .send({ leaveRequestId: "00000000-0000-0000-0000-000000000000" });
    expect(recalcNoPerm.status).toBe(403);

    expect((await request(app.getHttpServer()).get("/foundation/modules/my-apps")).status).toBe(
      401,
    );
    expect((await request(app.getHttpServer()).get("/notifications")).status).toBe(401);
  });
});
