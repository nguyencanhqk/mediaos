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
    const rows = await this.tasks.listByProject(ctx.user.companyId, projectId, { limit: 200 });
    // BUG1 fix: TaskCoreService (S4-TASK-BE-*, luồng work-item/Kanban hiện đại) CHỈ ghi task_status
    // (TitleCase) — KHÔNG BAO GIỜ đụng `status` legacy (lowercase, giữ DEFAULT 'not_started' vĩnh viễn cho
    // task tạo qua luồng hiện đại). byStatus/done PHẢI đọc task_status HIỆN ĐẠI, không phải status legacy.
    const byStatus: Record<string, number> = {};
    let done = 0;
    for (const r of rows) {
      const s = r.taskStatus ?? "Unknown";
      byStatus[s] = (byStatus[s] ?? 0) + 1;
      if (r.taskStatus === "Done") done += 1;
    }
    const total = rows.length;
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
    const res = await this.hrRead.listHrEmployees(ctx.user, {
      page: 1,
      pageSize: 100,
      sort: "fullName",
      order: "asc",
    });
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

  // ── shared list result ──────────────────────────────────────────────────────

  private listResult(items: Record<string, unknown>[], total: number): WidgetFetchResult {
    return {
      status: total === 0 ? "Empty" : "Active",
      data: { items, summary: { total } },
      emptyState: total === 0 ? { message: "Không có dữ liệu" } : null,
    };
  }
}
