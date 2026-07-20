import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import { DataScopeService } from "../permission/data-scope.service";
import { TaskCoreService } from "../tasks/task-core.service";
import { TasksService } from "../tasks/tasks.service";
import { ProjectsService } from "../tasks/projects.service";
import { MyNotificationsService } from "../notifications/my-notifications.service";
import { AttendanceReadService } from "../attendance/attendance-read.service";
import { LeaveApprovalService } from "../leave/leave-approval.service";
import { HrReadService } from "../employees/hr-read.service";
// S4-DASH-CATALOG-2 (additive): 6 read-service nguồn cho 9 widget đợt 2. Chỉ REUSE method ĐÃ-scope/đã-mask —
// KHÔNG thêm method vào module nguồn, KHÔNG raw-query bảng module khác.
import { AuthUsersService } from "../users/auth-users.service";
import { ModuleCatalogService } from "../foundation/module-catalog/module-catalog.service";
import { AuditQueryService } from "../foundation/audit/audit.service";
import { LeaveReadService } from "../leave/leave-read.service";
import { LeaveCalendarService } from "../leave/leave-calendar.service";
import { ContractService } from "../employees/contract.service";
import { addDaysToLocalDate, localDateOf } from "../common/tz.util";
import {
  gatePairFor,
  ttlSecondsFor,
  DASH_WIDGET_LIST_CAP,
  TASK_TERMINAL_STATUSES,
} from "./dashboard-widget-data.const";
import { DASH_ERR } from "./dashboard-resolver.errors";
import type {
  WidgetCacheIdentity,
  WidgetFetchResult,
  WidgetHandler,
  WidgetHandlerContext,
  WidgetRequestUser,
} from "./dashboard-widget-data.types";
import type { EnginePair } from "./dashboard-widget-catalog.const";

const DEFAULT_TZ = "Asia/Ho_Chi_Minh";
/** Ngưỡng "sắp đến hạn" cho TASK_ALERTS: task chưa hoàn thành có due trong 48h tới (hoặc đã overdue). */
const DUE_SOON_MS = 48 * 60 * 60 * 1000;

// ─── S4-DASH-CATALOG-2 — hằng số cho 9 widget đợt 2 ───────────────────────────────────────────────
/** SYSTEM_LOGS: 2 cửa sổ đếm (count-only) — 24h + 7 ngày gần nhất. Đơn vị ms. */
const AUDIT_WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const AUDIT_WINDOW_7D_MS = 7 * AUDIT_WINDOW_24H_MS;
/** LEAVE_CALENDAR: cửa sổ lịch nghỉ team [hôm nay, +N ngày) theo TZ công ty. */
const LEAVE_CALENDAR_WINDOW_DAYS = 30;
/** Số dòng đọc tối đa khi quét toàn team để lọc alert (bound query, dashboard "liếc nhanh"). */
const TEAM_SCAN_PAGE_SIZE = 100;
/**
 * ATTENDANCE_ALERTS "bất thường": status legacy lowercase (attendanceRecordV2Schema.status — nguồn feed
 * payroll/back-compat) muộn/về sớm/vắng/thiếu chấm. Dùng status lowercase (enum cố định) thay vì attendanceStatus
 * TitleCase (chuỗi tự do) để lọc ổn định.
 */
const ATTENDANCE_ALERT_STATUSES: ReadonlySet<string> = new Set([
  "late",
  "early_leave",
  "absent",
  "missing_checkin",
]);

/**
 * S4-DASH-BE-2 — DashboardWidgetHandlersService: 7 handler map dataSourceKey(slug) → gate+fetch, MỖI handler
 * CHỈ gọi METHOD ĐÃ TỒN TẠI + ĐÃ-SCOPE của module nguồn (KHÔNG raw-query bảng module khác, KHÔNG thêm method
 * vào module nguồn). Mỗi handler: PermissionService.can(cặp source-module) [+ DataScopeService cho widget cần
 * scope-theo-người-xem] TRƯỚC khi aggregate; trả data ĐÃ mask + trong-scope (BẤT BIẾN #1/#3).
 *
 * gate ⊥ fetch: gateAndResolve (gate 403 fail-closed + resolve cache identity) LUÔN chạy trước mọi lần serve
 * (kể cả cache hit — re-verify quyền người đọc); fetch CHỈ chạy khi cache miss/refresh.
 */
@Injectable()
export class DashboardWidgetHandlersService {
  private readonly registry = new Map<string, WidgetHandler>();

  constructor(
    private readonly db: DatabaseService,
    private readonly permission: PermissionService,
    private readonly dataScope: DataScopeService,
    private readonly taskCore: TaskCoreService,
    private readonly tasks: TasksService,
    private readonly projects: ProjectsService,
    private readonly notifications: MyNotificationsService,
    private readonly attendance: AttendanceReadService,
    private readonly leaveApproval: LeaveApprovalService,
    private readonly hrRead: HrReadService,
    // S4-DASH-CATALOG-2 (additive): 6 read-service nguồn cho 9 widget đợt 2 (đã export ở module nguồn).
    private readonly authUsers: AuthUsersService,
    private readonly moduleCatalog: ModuleCatalogService,
    private readonly auditQuery: AuditQueryService,
    private readonly leaveRead: LeaveReadService,
    private readonly leaveCalendar: LeaveCalendarService,
    private readonly contracts: ContractService,
  ) {
    this.buildRegistry();
  }

  /** Handler theo slug (dataSourceKey). undefined ⇒ slug ngoài catalog. */
  get(slug: string): WidgetHandler | undefined {
    return this.registry.get(slug);
  }

  // ── gate helper ─────────────────────────────────────────────────────────────

  /**
   * Gate quyền của widget bằng cặp source-module (KHÔNG truyền isSensitive — engine tự ép effectivelySensitive =
   * input OR grant.isSensitive ⇒ cặp nguồn is_sensitive=true vẫn exact-match, wildcard KHÔNG lọt). Deny ⇒ 403
   * fail-closed (runner KHÔNG nuốt thành Degraded).
   */
  private async gateOrThrow(user: WidgetRequestUser, widgetCode: string): Promise<EnginePair> {
    const pair = gatePairFor(widgetCode);
    if (!pair) {
      throw new ForbiddenException(`${DASH_ERR.VALIDATION}: widget thiếu cặp gate (${widgetCode})`);
    }
    const decision = await this.permission.can({
      userId: user.id,
      companyId: user.companyId,
      action: pair.action,
      resourceType: pair.resourceType,
    });
    if (!decision.allow) {
      throw new ForbiddenException(
        `AUTH-ERR-FORBIDDEN: thiếu quyền ${pair.action}:${pair.resourceType}`,
      );
    }
    return pair;
  }

  /** Cache identity per-user Own (widget self-locked / recipient-scoped / viewer-dependent). */
  private ownIdentity(ctx: WidgetHandlerContext): WidgetCacheIdentity {
    return {
      shareScope: "user",
      cacheScope: "Own",
      keyDiscriminator: null,
      scopeReferenceId: ctx.user.id,
      ttlSeconds: ttlSecondsFor(ctx.entry),
    };
  }

  // ── registry build ────────────────────────────────────────────────────────────

  private buildRegistry(): void {
    const add = (
      slug: string,
      widgetCode: string,
      h: Pick<WidgetHandler, "gateAndResolve" | "fetch">,
    ) => this.registry.set(slug, { slug, widgetCode, ...h });

    add("my-tasks", "MY_TASKS", {
      gateAndResolve: async (ctx) => this.gateSelf(ctx, "MY_TASKS"),
      fetch: (ctx) => this.fetchMyTasks(ctx),
    });
    add("task-alerts", "TASK_ALERTS", {
      gateAndResolve: async (ctx) => this.gateSelf(ctx, "TASK_ALERTS"),
      fetch: (ctx) => this.fetchTaskAlerts(ctx),
    });
    add("notifications", "NOTIFICATIONS", {
      gateAndResolve: async (ctx) => this.gateSelf(ctx, "NOTIFICATIONS"),
      fetch: (ctx) => this.fetchNotifications(ctx),
    });
    add("attendance-today", "ATTENDANCE_TODAY", {
      gateAndResolve: async (ctx) => this.gateSelf(ctx, "ATTENDANCE_TODAY"),
      fetch: (ctx) => this.fetchAttendanceToday(ctx),
    });
    add("pending-leave", "PENDING_LEAVE", {
      gateAndResolve: async (ctx) => this.gateSelf(ctx, "PENDING_LEAVE"),
      fetch: (ctx) => this.fetchPendingLeave(ctx),
    });
    add("project-progress", "PROJECT_PROGRESS", {
      gateAndResolve: (ctx) => this.gateProjectProgress(ctx),
      fetch: (ctx) => this.fetchProjectProgress(ctx),
    });
    add("hr-overview", "HR_OVERVIEW", {
      gateAndResolve: (ctx) => this.gateHrOverview(ctx),
      fetch: (ctx) => this.fetchHrOverview(ctx),
    });

    // ─── S4-DASH-CATALOG-2 (APPEND) — 9 widget đợt 2 ────────────────────────────────────────────────
    // MỖI handler dùng gateSelf: gateOrThrow(cặp gate của module nguồn) 403 fail-closed TRƯỚC aggregate, rồi
    // cache per-user Own (an toàn — KHÔNG chia sẻ chéo người xem). Method nguồn nào tự resolveAndAssert vẫn
    // được gate LẠI ở handler cho nhất quán; method KHÔNG tự gate (listUsers/getAllModules/listCompany) thì
    // handler LÀ cổng DUY NHẤT ⇒ bắt buộc gate. Handler chỉ count/map non-PII — KHÔNG baseSalary/salaryType/
    // identity_*; source lỗi kỹ thuật ném ra → runner map Degraded (KHÔNG sập dashboard).
    add("user-summary", "USER_SUMMARY", {
      gateAndResolve: async (ctx) => this.gateSelf(ctx, "USER_SUMMARY"),
      fetch: (ctx) => this.fetchUserSummary(ctx),
    });
    add("employee-summary", "EMPLOYEE_SUMMARY", {
      gateAndResolve: async (ctx) => this.gateSelf(ctx, "EMPLOYEE_SUMMARY"),
      fetch: (ctx) => this.fetchEmployeeSummary(ctx),
    });
    add("module-status", "MODULE_STATUS", {
      gateAndResolve: async (ctx) => this.gateSelf(ctx, "MODULE_STATUS"),
      fetch: (ctx) => this.fetchModuleStatus(ctx),
    });
    add("system-logs", "SYSTEM_LOGS", {
      gateAndResolve: async (ctx) => this.gateSelf(ctx, "SYSTEM_LOGS"),
      fetch: (ctx) => this.fetchSystemLogs(ctx),
    });
    add("leave-balance", "LEAVE_BALANCE", {
      gateAndResolve: async (ctx) => this.gateSelf(ctx, "LEAVE_BALANCE"),
      fetch: (ctx) => this.fetchLeaveBalance(ctx),
    });
    add("new-employees", "NEW_EMPLOYEES", {
      gateAndResolve: async (ctx) => this.gateSelf(ctx, "NEW_EMPLOYEES"),
      fetch: (ctx) => this.fetchNewEmployees(ctx),
    });
    add("contract-expiring", "CONTRACT_EXPIRING", {
      gateAndResolve: async (ctx) => this.gateSelf(ctx, "CONTRACT_EXPIRING"),
      fetch: (ctx) => this.fetchContractExpiring(ctx),
    });
    add("leave-calendar", "LEAVE_CALENDAR", {
      gateAndResolve: async (ctx) => this.gateSelf(ctx, "LEAVE_CALENDAR"),
      fetch: (ctx) => this.fetchLeaveCalendar(ctx),
    });
    add("attendance-alerts", "ATTENDANCE_ALERTS", {
      gateAndResolve: async (ctx) => this.gateSelf(ctx, "ATTENDANCE_ALERTS"),
      fetch: (ctx) => this.fetchAttendanceAlerts(ctx),
    });
  }

  /** Gate widget self-locked/viewer-dependent (per-user Own cache). */
  private async gateSelf(
    ctx: WidgetHandlerContext,
    widgetCode: string,
  ): Promise<WidgetCacheIdentity> {
    await this.gateOrThrow(ctx.user, widgetCode);
    return this.ownIdentity(ctx);
  }

  // ── MY_TASKS / TASK_ALERTS (TaskCoreService.getMyTasks — ĐÃ gate read:task + self-lock) ─────────

  private async fetchMyTasks(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const rows = await this.taskCore.getMyTasks(ctx.user);
    const items = rows.slice(0, DASH_WIDGET_LIST_CAP).map((t) => this.toTaskItem(t));
    return this.listResult(items, rows.length);
  }

  private async fetchTaskAlerts(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const rows = await this.taskCore.getMyTasks(ctx.user);
    const now = Date.now();
    const alerts = rows.filter((t) => this.isAlert(t, now));
    const items = alerts.slice(0, DASH_WIDGET_LIST_CAP).map((t) => this.toTaskItem(t));
    const overdue = alerts.filter((t) => t.isOverdue).length;
    return {
      status: alerts.length === 0 ? "Empty" : "Active",
      data: { items, summary: { total: alerts.length, overdue, dueSoon: alerts.length - overdue } },
      emptyState: alerts.length === 0 ? { message: "Không có task cần chú ý" } : null,
    };
  }

  private isAlert(
    t: { status: string | null; isOverdue: boolean; dueAt: string | null },
    now: number,
  ): boolean {
    // BUG2 fix: t.status ở đây là MyTaskItemDto.status = TaskCoreService.getMyTasks → task_status HIỆN ĐẠI
    // TitleCase ('Done'/'Cancelled'/…), KHÔNG PHẢI status legacy lowercase — set terminal PHẢI khớp TitleCase.
    if (t.status && TASK_TERMINAL_STATUSES.has(t.status)) return false;
    if (t.isOverdue) return true;
    if (!t.dueAt) return false;
    const due = new Date(t.dueAt).getTime();
    return due >= now && due - now <= DUE_SOON_MS;
  }

  private toTaskItem(t: {
    id: string;
    title: string;
    status: string | null;
    priority: string | null;
    dueAt: string | null;
    isOverdue: boolean;
    projectName: string | null;
  }): Record<string, unknown> {
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt,
      isOverdue: t.isOverdue,
      projectName: t.projectName,
    };
  }

  // ── NOTIFICATIONS (MyNotificationsService.list — recipient-scoped, self-locked userId) ──────────

  private async fetchNotifications(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const page = await this.notifications.list(ctx.user.companyId, ctx.user.id, {
      page: 1,
      per_page: DASH_WIDGET_LIST_CAP,
    });
    const items = page.data.map((n) => ({
      id: n.notification_id,
      title: n.title,
      shortContent: n.short_content,
      priority: n.priority,
      status: n.status,
      isRead: n.is_read,
      targetUrl: n.target_url,
      createdAt: n.created_at,
    }));
    const unread = page.data.filter((n) => !n.is_read).length;
    return {
      status: page.total === 0 ? "Empty" : "Active",
      data: { items, summary: { total: page.total, unread } },
      emptyState: page.total === 0 ? { message: "Không có thông báo mới" } : null,
    };
  }

  // ── ATTENDANCE_TODAY (AttendanceReadService.listMyRecords — self-locked; mốc 'hôm nay' theo TZ công ty) ──

  private async fetchAttendanceToday(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const tz = await this.resolveCompanyTz(ctx.user.companyId);
    const today = localDateOf(new Date(), tz); // 'YYYY-MM-DD' theo TZ công ty (REUSE tz.util, KHÔNG tự dựng)
    const tomorrow = addDaysToLocalDate(today, 1); // [today, tomorrow) — query half-open trên work_date.
    const res = await this.attendance.listMyRecords(ctx.user, {
      page: 1,
      pageSize: DASH_WIDGET_LIST_CAP,
      fromDate: today,
      toDate: tomorrow,
      sort: "workDate",
      order: "desc",
    });
    const items = res.items.map((r) => ({
      id: r.id,
      workDate: r.workDate,
      attendanceStatus: r.attendanceStatus,
      status: r.status,
      checkInAt: r.checkInAt,
      checkOutAt: r.checkOutAt,
    }));
    return {
      status: res.meta.total === 0 ? "Empty" : "Active",
      data: { date: today, items, summary: { total: res.meta.total } },
      emptyState: res.meta.total === 0 ? { message: "Chưa có chấm công hôm nay" } : null,
    };
  }

  private async resolveCompanyTz(companyId: string): Promise<string> {
    return this.db.withTenant(companyId, async (tx) => {
      const r = await tx.execute(
        sql`SELECT timezone FROM companies WHERE id = ${companyId} AND deleted_at IS NULL LIMIT 1`,
      );
      const row = r.rows[0] as { timezone: string | null } | undefined;
      return row?.timezone ?? DEFAULT_TZ;
    });
  }

  // ── PENDING_LEAVE (LeaveApprovalService.listPending — assertOwnerInScope, gate view:leave) ──────

  private async fetchPendingLeave(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const res = await this.leaveApproval.listPending(ctx.user, {
      status: "Pending",
      page: 1,
      pageSize: DASH_WIDGET_LIST_CAP,
    });
    const items = res.items.map((l) => ({
      id: l.id,
      leaveTypeName: l.leaveTypeName,
      startDate: l.startDate,
      endDate: l.endDate,
      totalDays: l.totalDays,
      status: l.status,
      submittedAt: l.submittedAt,
      requester: { fullName: l.requester.fullName, department: l.requester.department },
    }));
    return {
      status: res.meta.total === 0 ? "Empty" : "Active",
      data: { items, summary: { total: res.meta.total } },
      emptyState: res.meta.total === 0 ? { message: "Không có đơn nghỉ chờ duyệt" } : null,
    };
  }

  // ── PROJECT_PROGRESS (authorize ProjectsService.getProject TRƯỚC → TasksService.listByProject aggregate) ──

  private async gateProjectProgress(ctx: WidgetHandlerContext): Promise<WidgetCacheIdentity> {
    const projectId = ctx.query.projectId;
    if (!projectId) {
      throw new BadRequestException({
        code: DASH_ERR.VALIDATION,
        message: "project-progress bắt buộc project_id",
      });
    }
    await this.gateOrThrow(ctx.user, "PROJECT_PROGRESS"); // read:project (403 fail-closed)
    // Authorize TRƯỚC aggregate: getProject resolveAndAssert('read','project') (403) + scope 404 (cross-company/
    // out-scope). listByProject CHỈ tenant-guard (KHÔNG lọc employee-scope) ⇒ authorize project là BẮT BUỘC.
    await this.projects.getProject(ctx.user, projectId);
    return {
      shareScope: "user",
      cacheScope: "Project",
      keyDiscriminator: `p:${projectId}`,
      scopeReferenceId: projectId,
      ttlSeconds: ttlSecondsFor(ctx.entry),
    };
  }

  private async fetchProjectProgress(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const projectId = ctx.query.projectId;
    if (!projectId) {
      throw new BadRequestException({
        code: DASH_ERR.VALIDATION,
        message: "project-progress bắt buộc project_id",
      });
    }
    // ── S5-TASK-SUBTASK-1 (DECISIONS-05 D-35) — MỘT CÔNG THỨC, MỘT CON SỐ ─────────────────────────
    // TRƯỚC: đếm trong bộ nhớ từ listByProject(limit 200) — không lọc parent VÀ âm thầm cắt ở 200 hàng.
    // Sau khi MV dashboard chuyển sang ĐẾM LÁ (mig 0503), cùng MỘT màn dashboard sẽ hiện hai con số
    // khác nhau cho cùng dự án (widget task-status đếm lá vs project-progress đếm thô) — tệ hơn hẳn
    // "dashboard ≠ danh sách" mà owner đã chấp nhận. Nay dùng CHUNG vị từ lá với báo cáo dự án; đồng
    // thời bỏ luôn cái cắt-200 (dự án >200 task trước đây báo % sai).
    // ⚠️ Gọi METHOD HẸP countsByStatusLeafTx, KHÔNG gọi aggregateReportTx: cái sau nằm sau gate
    // view-report:project SENSITIVE và kèm PII assigneeWorkload — xem docblock của method đó.
    // ⚠️ Authorize project đã chạy ở gateProjectProgress (:386) — method hẹp KHÔNG tự scope theo actor.
    const byStatus = await this.projects.countsByStatusLeaf(ctx.user.companyId, projectId);
    // ⚠️ HÌNH DẠNG ĐỔI CÓ CHỦ ĐÍCH so với bản cũ: MẤT key "Unknown" (task_status NULL nay coalesce về
    // 'Todo' — cùng quy ước với báo cáo dự án) và THÊM các key giá trị 0 (luôn đủ 5 trạng thái chuẩn).
    // `total` vì thế phải TỰ DẪN XUẤT từ tổng các key LÁ, KHÔNG còn là rows.length; "Empty" nay nghĩa là
    // "0 công việc LÁ" chứ không phải "0 công việc".
    const done = byStatus.Done ?? 0;
    const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return {
      status: total === 0 ? "Empty" : "Active",
      data: { projectId, summary: { total, done, percent }, byStatus },
      emptyState: total === 0 ? { message: "Dự án chưa có công việc" } : null,
    };
  }

  // ── HR_OVERVIEW (HrReadService.listHrEmployees → count/aggregate viewer-independent; KHÔNG lương/PII) ──

  private async gateHrOverview(ctx: WidgetHandlerContext): Promise<WidgetCacheIdentity> {
    await this.gateOrThrow(ctx.user, "HR_OVERVIEW"); // read:employee (403 fail-closed)
    // Resolve scope (403 nếu thiếu — cũng là gate). Company/System ⇒ aggregate toàn tenant, viewer-independent ⇒
    // chia sẻ company-wide. scope < Company ⇒ aggregate scoped-theo-viewer ⇒ per-user (viewer-dependent).
    const scope = await this.dataScope.resolveAndAssert(
      ctx.user.id,
      ctx.user.companyId,
      "read",
      "employee",
    );
    const companyWide = scope === "Company" || scope === "System";
    return {
      shareScope: companyWide ? "company" : "user",
      cacheScope: companyWide ? "Company" : scope,
      keyDiscriminator: null,
      scopeReferenceId: companyWide ? null : ctx.user.id,
      ttlSeconds: ttlSecondsFor(ctx.entry),
    };
  }

  private async fetchHrOverview(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    // listHrEmployees ÁP scope filter + salary mask; ta CHỈ đếm (headcount/status/org-unit) — KHÔNG chạm
    // baseSalary/salaryType/PII ⇒ response + cache row KHÔNG chứa field mask-theo-người-xem (an toàn share).
    const res = await this.hrRead.listHrEmployees(
      ctx.user,
      { page: 1, pageSize: 100, sort: "fullName", order: "asc" },
      // S5-ME-BE-5: chỉ đếm headcount/status/org-unit — KHÔNG dùng avatar ⇒ bỏ presign (khỏi tốn hot-path).
      { resolveAvatars: false },
    );
    const byStatus: Record<string, number> = {};
    const byOrgUnit: Record<string, number> = {};
    for (const e of res.items) {
      byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
      const unit = e.orgUnitName ?? "(chưa phân bổ)";
      byOrgUnit[unit] = (byOrgUnit[unit] ?? 0) + 1;
    }
    return {
      status: res.meta.total === 0 ? "Empty" : "Active",
      data: { summary: { headcount: res.meta.total }, byStatus, byOrgUnit },
      emptyState: res.meta.total === 0 ? { message: "Chưa có nhân sự" } : null,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // S4-DASH-CATALOG-2 — 9 widget đợt 2. Gate ĐÃ chạy ở gateSelf (gateOrThrow) TRƯỚC fetch (fail-closed 403).
  // ════════════════════════════════════════════════════════════════════════════════════════════════

  // ── USER_SUMMARY (AuthUsersService.listUsers — COUNT-only .total; gate view:user) ──────────────────
  private async fetchUserSummary(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    // listUsers scope-lọc theo quyền người xem; ta CHỈ lấy .total (BỎ mảng users chứa email/tên). Count-only.
    const res = await this.authUsers.listUsers(
      { id: ctx.user.id, companyId: ctx.user.companyId },
      { limit: 1, offset: 0 },
    );
    const total = res.total;
    return {
      status: total === 0 ? "Empty" : "Active",
      data: { summary: { total } },
      emptyState: total === 0 ? { message: "Chưa có người dùng" } : null,
    };
  }

  // ── EMPLOYEE_SUMMARY (HrReadService.getEmployeesSummary — count/aggregate; gate read:employee) ──────
  private async fetchEmployeeSummary(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    // getEmployeesSummary tự gate read:employee + mask byGender sau view-sensitive. Ta CỐ Ý BỎ byGender (PII)
    // — widget non-PII chỉ headcount/byStatus/byEmploymentType.
    const summary = await this.hrRead.getEmployeesSummary(ctx.user);
    return {
      status: summary.total === 0 ? "Empty" : "Active",
      data: {
        summary: { total: summary.total },
        byStatus: summary.byStatus,
        byEmploymentType: summary.byEmploymentType,
      },
      emptyState: summary.total === 0 ? { message: "Chưa có nhân sự" } : null,
    };
  }

  // ── MODULE_STATUS (ModuleCatalogService.getAllModules; gate view:foundation-module) ────────────────
  private async fetchModuleStatus(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const mods = await this.moduleCatalog.getAllModules({
      id: ctx.user.id,
      companyId: ctx.user.companyId,
    });
    // Catalog module là tập cố định nhỏ (AUTH/HR/ATT/…) — map non-PII (code/name/group/cờ), KHÔNG phân trang.
    const items = mods.map((m) => ({
      moduleCode: m.module_code,
      name: m.name,
      group: m.group,
      isActive: m.is_active,
      enabled: m.enabled,
    }));
    const active = items.filter((m) => m.enabled && m.isActive).length;
    return {
      status: items.length === 0 ? "Empty" : "Active",
      data: { items, summary: { total: items.length, active } },
      emptyState: items.length === 0 ? { message: "Chưa có module" } : null,
    };
  }

  // ── SYSTEM_LOGS (CROWN — AuditQueryService.listCompany COUNT-ONLY; gate view:audit-log SENSITIVE CA-only) ──
  private async fetchSystemLogs(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    // COUNT-ONLY: listCompany lọc theo cửa sổ thời gian, ta CHỈ đọc meta.total — BỎ TOÀN BỘ data rows (chứa
    // ip/userAgent/actorUserId/actorEmployeeId/changes/payload/metadata/errorMessage). Response + cache TUYỆT ĐỐI
    // KHÔNG chứa row/actor/PII. Gate view:audit-log (CA-only) đã chặn non-CA ở gateSelf TRƯỚC.
    const now = Date.now();
    const isoAgo = (ms: number): string => new Date(now - ms).toISOString();
    const [last24h, last7d] = await Promise.all([
      this.auditQuery.listCompany(ctx.user.companyId, {
        limit: 1,
        offset: 0,
        dateFrom: isoAgo(AUDIT_WINDOW_24H_MS),
      }),
      this.auditQuery.listCompany(ctx.user.companyId, {
        limit: 1,
        offset: 0,
        dateFrom: isoAgo(AUDIT_WINDOW_7D_MS),
      }),
    ]);
    const total7d = last7d.meta.total;
    return {
      status: total7d === 0 ? "Empty" : "Active",
      // CHỈ số đếm theo thời gian — KHÔNG rows, KHÔNG actor.
      data: { summary: { last24h: last24h.meta.total, last7d: total7d, windowDays: 7 } },
      emptyState: total7d === 0 ? { message: "Không có log gần đây" } : null,
    };
  }

  // ── LEAVE_BALANCE (LeaveReadService.listMyBalances — own, self-locked; gate view-own:leave-balance) ──
  private async fetchLeaveBalance(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const balances = await this.leaveRead.listMyBalances({
      id: ctx.user.id,
      companyId: ctx.user.companyId,
    });
    const items = balances.map((b) => ({
      leaveTypeCode: b.leaveType.code,
      leaveTypeName: b.leaveType.name,
      periodYear: b.periodYear,
      remainingDays: b.remainingDays,
      usedDays: b.usedDays,
      openingBalance: b.openingBalance,
      unit: b.unit,
    }));
    return {
      status: items.length === 0 ? "Empty" : "Active",
      data: { items, summary: { total: items.length } },
      emptyState: items.length === 0 ? { message: "Chưa có số dư phép" } : null,
    };
  }

  // ── NEW_EMPLOYEES (HrReadService.listHrEmployees sort=startDate desc; gate read:employee) — map non-PII ──
  private async fetchNewEmployees(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const res = await this.hrRead.listHrEmployees(
      ctx.user,
      { page: 1, pageSize: DASH_WIDGET_LIST_CAP, sort: "startDate", order: "desc" },
      // S5-ME-BE-5: widget map KHÔNG lấy avatarUrl ⇒ bỏ presign (khỏi tốn hot-path dashboard).
      { resolveAvatars: false },
    );
    // CHỈ directory-class — KHÔNG baseSalary/salaryType/gender/dateOfBirth/phone/contractType (dù list item có
    // thể mang chúng khi viewer đủ quyền, widget KHÔNG bao giờ phơi PII/lương).
    const items = res.items.map((e) => ({
      id: e.id,
      fullName: e.fullName,
      employeeCode: e.employeeCode,
      orgUnitName: e.orgUnitName,
      positionName: e.positionName,
      startDate: e.startDate,
      status: e.status,
    }));
    return {
      status: res.meta.total === 0 ? "Empty" : "Active",
      data: { items, summary: { total: res.meta.total } },
      emptyState: res.meta.total === 0 ? { message: "Chưa có nhân sự mới" } : null,
    };
  }

  // ── CONTRACT_EXPIRING (ContractService.list expiringOnly; gate view:contract) — DTO không có lương ──
  private async fetchContractExpiring(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const res = await this.contracts.list(ctx.user, {
      expiringOnly: true,
      page: 1,
      limit: DASH_WIDGET_LIST_CAP,
    });
    // EmployeeContractDto KHÔNG chứa lương/PII; map tập tối thiểu cho widget alert.
    const items = res.data.map((c) => ({
      id: c.id,
      contractCode: c.contractCode,
      title: c.title,
      employeeId: c.employeeId,
      startDate: c.startDate,
      endDate: c.endDate,
      status: c.status,
      expiringSoon: c.expiringSoon,
    }));
    return {
      status: res.meta.total === 0 ? "Empty" : "Active",
      data: { items, summary: { total: res.meta.total } },
      emptyState: res.meta.total === 0 ? { message: "Không có hợp đồng sắp hết hạn" } : null,
    };
  }

  // ── LEAVE_CALENDAR (LeaveCalendarService.listCalendar scope=team; gate view-team:leave-calendar) ─────
  private async fetchLeaveCalendar(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const tz = await this.resolveCompanyTz(ctx.user.companyId);
    const from = localDateOf(new Date(), tz); // 'YYYY-MM-DD' theo TZ công ty (REUSE tz.util).
    const to = addDaysToLocalDate(from, LEAVE_CALENDAR_WINDOW_DAYS);
    const res = await this.leaveCalendar.listCalendar(
      { id: ctx.user.id, companyId: ctx.user.companyId },
      { scope: "team", from, to },
    );
    // BỎ `reason` (riêng tư — đã mask null cho dòng người khác nhưng widget "ai nghỉ khi nào" không cần).
    const items = res.items.slice(0, DASH_WIDGET_LIST_CAP).map((e) => ({
      id: e.id,
      userFullName: e.userFullName,
      employeeCode: e.employeeCode,
      leaveTypeName: e.leaveTypeName,
      startDate: e.startDate,
      endDate: e.endDate,
      totalDays: e.totalDays,
      status: e.status,
    }));
    return {
      status: res.items.length === 0 ? "Empty" : "Active",
      data: { items, summary: { total: res.items.length } },
      emptyState: res.items.length === 0 ? { message: "Không có lịch nghỉ team" } : null,
    };
  }

  // ── ATTENDANCE_ALERTS (AttendanceReadService.listTeamRecords 'hôm nay' TZ; filter Late/Absent/Missing) ──
  private async fetchAttendanceAlerts(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const tz = await this.resolveCompanyTz(ctx.user.companyId);
    const today = localDateOf(new Date(), tz); // mốc 'hôm nay' theo TZ công ty (REUSE tz.util, KHÔNG date ad-hoc).
    const tomorrow = addDaysToLocalDate(today, 1); // [today, tomorrow) half-open trên work_date.
    const res = await this.attendance.listTeamRecords(ctx.user, {
      page: 1,
      pageSize: TEAM_SCAN_PAGE_SIZE,
      fromDate: today,
      toDate: tomorrow,
      sort: "workDate",
      order: "desc",
    });
    const alerts = res.items.filter((r) => ATTENDANCE_ALERT_STATUSES.has(r.status));
    // Map non-PII: tên/mã/đơn vị + trạng thái. KHÔNG lương/identity (list item không có; detail mới có location).
    const items = alerts.slice(0, DASH_WIDGET_LIST_CAP).map((r) => ({
      id: r.id,
      workDate: r.workDate,
      fullName: r.fullName,
      employeeCode: r.employeeCode,
      orgUnitName: r.orgUnitName,
      status: r.status,
      attendanceStatus: r.attendanceStatus,
    }));
    return {
      status: alerts.length === 0 ? "Empty" : "Active",
      data: { items, summary: { total: alerts.length } },
      emptyState: alerts.length === 0 ? { message: "Không có bất thường chấm công hôm nay" } : null,
    };
  }

  // ── shared list result ──────────────────────────────────────────────────────

  private listResult(items: Record<string, unknown>[], total: number): WidgetFetchResult {
    return {
      status: total === 0 ? "Empty" : "Active",
      data: { items, summary: { total } },
      emptyState: total === 0 ? { message: "Không có dữ liệu" } : null,
    };
  }
}
