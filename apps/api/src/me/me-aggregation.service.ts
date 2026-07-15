import { ForbiddenException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  MeAttendanceSummary,
  MeHrSummary,
  MeIdentity,
  MeLeaveSummary,
  MeNotificationSummary,
  MeOverview,
  MeSectionStatus,
  MeTaskSummary,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import { SettingService } from "../foundation/settings/setting.service";
import { HrReadService } from "../employees/hr-read.service";
import { AttendanceService } from "../attendance/attendance.service";
import { LeaveReadService } from "../leave/leave-read.service";
import { TaskCoreService } from "../tasks/task-core.service";
import { MyNotificationsService } from "../notifications/my-notifications.service";
import { MeCurrentPersonResolver, type CurrentPerson } from "./me-current-person.resolver";
import { MeRepository } from "./me.repository";
import { ME_SECTION_SOURCES, moduleEnabledKey, type MeSectionSource } from "./me.constants";

interface Actor {
  id: string;
  companyId: string;
}

/** Envelope 1 section: `data` null ở mọi status ≠ 'ok' (khớp meSectionSchema packages/contracts). */
type Section<T> = { status: MeSectionStatus; data: T | null };

function ok<T>(data: T): Section<T> {
  return { status: "ok", data };
}
function nonOk<T>(status: Exclude<MeSectionStatus, "ok">): Section<T> {
  return { status, data: null };
}

/**
 * Map 1 kết quả allSettled → Section. composeSection KHÔNG bao giờ reject (đã try/catch nội bộ) nên nhánh
 * 'rejected' chỉ chạm khi có throw NGOÀI dự kiến (vd can() vỡ hợp đồng fail-closed) → 'error' (KHÔNG 500,
 * KHÔNG nuốt thành ok). Fulfilled → giữ nguyên Section đã phân loại.
 */
function settledSection<T>(r: PromiseSettledResult<Section<T>>): Section<T> {
  return r.status === "fulfilled" ? r.value : nonOk("error");
}

/** ISO-string hoá 1 giá trị date-like (Date | string | null) — DTO ME dùng string|null. */
function isoOrNull(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

const TASK_TERMINAL = new Set(["Done", "Cancelled"]);

/**
 * S5-ME-BE-1 — MeAggregationService (crown-jewel): tổng hợp dữ liệu cá nhân (SPEC-09 §10.1/§11.2/§12/§18.2).
 *
 * NGUYÊN TẮC AN TOÀN (đã soi qua bài học reused-method-must-be-actor-scoped + silent-failure):
 *  1. RE-CHECK cặp quyền NGUỒN qua PermissionService.can TRƯỚC khi đọc MỖI section — PermissionGuard chỉ ở
 *     controller (cổng ME.ACCESS), còn reader gọi thẳng service in-process ⇒ nếu không re-check thì thiếu
 *     quyền nguồn vẫn đọc được. Thiếu → 'forbidden', KHÔNG đọc dữ liệu (SPEC-09 §11.2).
 *  2. CHỈ reader own-scope canonical: getMyProfile · getToday · listMyBalances · getMyTasks(user) ·
 *     unreadCount — TUYỆT ĐỐI KHÔNG listTeam/listCompany/listAll/listBoard; KHÔNG bypass masking nguồn
 *     (project HR chỉ giữ field directory-class, salary/PII giữ nguyên bị mask ở nguồn); KHÔNG tự tính lại
 *     số dư phép (§7.4 — chỉ đọc listMyBalances).
 *  3. FAIL-SOFT per-section qua Promise.allSettled (mirror DashboardWidgetDataService) với PHÂN LOẠI CHÍNH
 *     XÁC exception: CHỈ ForbiddenException(403)→'forbidden'; NotFoundException(404) từ reader→'ok'+empty
 *     (KHÔNG dán nhãn forbidden — thiếu-DỮ-LIỆU ≠ thiếu-QUYỀN); non-HttpException/hạ tầng→'error'. 1 nguồn
 *     lỗi KHÔNG làm 500 toàn response — HTTP luôn 200. KHÔNG bao giờ nuốt 403 thành ok/null.
 *  4. module_disabled: mirror default-enabled module-catalog.service — thiếu row company_settings ⇒ ENABLED
 *     (5 core module), CHỈ value===false → 'module_disabled' (§12.3, không stale).
 *  5. company_id ở mọi query qua withTenant của reader nguồn (BẤT BIẾN #1).
 *
 * KHÔNG tự chọn khi >1 employee active — MeCurrentPersonResolver ném 409 + audit (§12.4).
 */
@Injectable()
export class MeAggregationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MeRepository,
    private readonly currentPerson: MeCurrentPersonResolver,
    private readonly permission: PermissionService,
    private readonly settings: SettingService,
    private readonly hr: HrReadService,
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveReadService,
    private readonly task: TaskCoreService,
    private readonly notifications: MyNotificationsService,
  ) {}

  // ── GET /me ──────────────────────────────────────────────────────────────────

  /** Danh tính user hiện tại (account LUÔN có; employee link chỉ khi 'linked'). Resolve 100% từ token. */
  async getIdentity(actor: Actor): Promise<MeIdentity> {
    const person = await this.currentPerson.resolve(actor);
    return this.buildIdentity(actor, person);
  }

  // ── GET /me/overview ─────────────────────────────────────────────────────────

  /**
   * Tổng quan cá nhân: identity + 5 section (hr/attendance/leave/task/notification) status RIÊNG. Resolve
   * current-person MỘT LẦN (anomaly >1 → 409 lan toàn route, đúng §12.4), rồi compose 5 section song song
   * fail-soft qua Promise.allSettled (mirror DashboardWidgetDataService). `moduleFlags` resolve BATCH 1 lần
   * (≤2 query — §18.1 không N+1). composeSection ĐÃ total (không throw); allSettled là defense-in-depth: 1
   * throw bất ngờ → section 'error', KHÔNG làm 500 toàn response (identity vẫn dựng riêng).
   */
  async getOverview(actor: Actor): Promise<MeOverview> {
    const person = await this.currentPerson.resolve(actor);
    const moduleFlags = await this.resolveModuleFlags(actor);
    const identity = await this.buildIdentity(actor, person);
    const [hr, attendance, leave, task, notification] = await Promise.allSettled([
      this.hrSection(actor, person, moduleFlags),
      this.attendanceSection(actor, person, moduleFlags),
      this.leaveSection(actor, person, moduleFlags),
      this.taskSection(actor, person, moduleFlags),
      this.notificationSection(actor, person, moduleFlags),
    ]);
    return {
      identity,
      hr: settledSection(hr),
      attendance: settledSection(attendance),
      leave: settledSection(leave),
      task: settledSection(task),
      notification: settledSection(notification),
    };
  }

  // ── Section endpoints chuyên biệt (mỗi cái resolve current-person + module flag ĐỘC LẬP) ─────────

  async getAttendanceSummary(actor: Actor): Promise<Section<MeAttendanceSummary>> {
    const person = await this.currentPerson.resolve(actor);
    return this.attendanceSection(actor, person, await this.resolveModuleFlags(actor));
  }

  async getLeaveSummary(actor: Actor): Promise<Section<MeLeaveSummary>> {
    const person = await this.currentPerson.resolve(actor);
    return this.leaveSection(actor, person, await this.resolveModuleFlags(actor));
  }

  async getTaskSummary(actor: Actor): Promise<Section<MeTaskSummary>> {
    const person = await this.currentPerson.resolve(actor);
    return this.taskSection(actor, person, await this.resolveModuleFlags(actor));
  }

  async getNotificationSummary(actor: Actor): Promise<Section<MeNotificationSummary>> {
    const person = await this.currentPerson.resolve(actor);
    return this.notificationSection(actor, person, await this.resolveModuleFlags(actor));
  }

  // ── identity builder ──────────────────────────────────────────────────────────

  private async buildIdentity(actor: Actor, person: CurrentPerson): Promise<MeIdentity> {
    const { account, roles } = await this.db.withTenant(actor.companyId, async (tx) => {
      const [accountRow, roleRows] = await Promise.all([
        this.repo.findAccountByUserIdTx(tx, actor.companyId, actor.id),
        this.repo.findActiveRolesByUserIdTx(tx, actor.companyId, actor.id),
      ]);
      return { account: accountRow, roles: roleRows };
    });

    return {
      account: {
        userId: actor.id,
        email: account?.email ?? "",
        status: account?.status ?? "active",
        displayName: account?.displayName ?? null,
        roles,
        lastLoginAt: isoOrNull(account?.lastLoginAt ?? null),
        createdAt: isoOrNull(account?.createdAt ?? null),
      },
      linkStatus: person.linkStatus,
      employee:
        person.linkStatus === "linked"
          ? {
              employeeId: person.employee.employeeId,
              employeeCode: person.employee.employeeCode,
              fullName: person.employee.fullName,
              departmentName: person.employee.departmentName,
              positionName: person.employee.positionName,
            }
          : null,
    };
  }

  // ── per-section composers (mỗi cái: gate precedence → reader own-scope → fail-soft) ─────────────

  private async hrSection(
    actor: Actor,
    person: CurrentPerson,
    moduleFlags: Map<string, boolean>,
  ): Promise<Section<MeHrSummary>> {
    return this.composeSection(actor, person, moduleFlags, ME_SECTION_SOURCES[0], async () => {
      const profile = await this.hr.getMyProfile(actor);
      // Projection CHỈ giữ field directory-class (KHÔNG salary/PII/CCCD) — masking đã ở nguồn, ME không lộ thêm.
      return {
        employeeCode: profile.employeeCode,
        fullName: profile.fullName,
        departmentName: profile.orgUnitName,
        positionName: profile.positionName,
        status: profile.status,
        startDate: profile.startDate,
      } satisfies MeHrSummary;
    });
  }

  private async attendanceSection(
    actor: Actor,
    person: CurrentPerson,
    moduleFlags: Map<string, boolean>,
  ): Promise<Section<MeAttendanceSummary>> {
    return this.composeSection(actor, person, moduleFlags, ME_SECTION_SOURCES[1], async () => {
      const today = await this.attendance.getToday(actor);
      const record = today.record;
      const status = record?.checkOutAt
        ? "CheckedOut"
        : record?.checkInAt
          ? "CheckedIn"
          : today.disabledReason && /nghỉ/i.test(today.disabledReason)
            ? "OnLeave"
            : "NotCheckedIn";
      return {
        workDate: today.workDate,
        status,
        checkInAt: isoOrNull(record?.checkInAt ?? null),
        checkOutAt: isoOrNull(record?.checkOutAt ?? null),
        shiftName: today.shift?.name ?? null,
        isLate: record?.isLate ?? null,
        isEarlyLeave: record?.isEarlyLeave ?? null,
      } satisfies MeAttendanceSummary;
    });
  }

  private async leaveSection(
    actor: Actor,
    person: CurrentPerson,
    moduleFlags: Map<string, boolean>,
  ): Promise<Section<MeLeaveSummary>> {
    return this.composeSection(actor, person, moduleFlags, ME_SECTION_SOURCES[2], async () => {
      const balances = await this.leave.listMyBalances(actor);
      return {
        balances: balances.map((b) => ({
          leaveTypeCode: b.leaveType.code,
          leaveTypeName: b.leaveType.name,
          remainingDays: b.remainingDays,
          unit: b.unit,
        })),
        // reservedDays > 0 = có phần phép đang giữ chỗ (đơn chờ duyệt) — đếm loại phép có reservation. ME
        // KHÔNG tự tính lại số dư (§7.4): chỉ đọc từ listMyBalances, không truy vấn leave_requests riêng.
        pendingRequestCount: balances.filter((b) => b.reservedDays > 0).length,
      } satisfies MeLeaveSummary;
    });
  }

  private async taskSection(
    actor: Actor,
    person: CurrentPerson,
    moduleFlags: Map<string, boolean>,
  ): Promise<Section<MeTaskSummary>> {
    return this.composeSection(actor, person, moduleFlags, ME_SECTION_SOURCES[3], async () => {
      const rows = await this.task.getMyTasks(actor);
      const now = Date.now();
      const live = rows.filter((t) => !(t.status && TASK_TERMINAL.has(t.status)));
      const assignedCount = live.filter((t) => t.source === "assigned").length;
      const overdueCount = live.filter((t) => t.isOverdue).length;
      const dueTodayCount = live.filter((t) => isDueToday(t.dueAt, now)).length;
      return { assignedCount, dueTodayCount, overdueCount } satisfies MeTaskSummary;
    });
  }

  private async notificationSection(
    actor: Actor,
    person: CurrentPerson,
    moduleFlags: Map<string, boolean>,
  ): Promise<Section<MeNotificationSummary>> {
    return this.composeSection(actor, person, moduleFlags, ME_SECTION_SOURCES[4], async () => {
      const c = await this.notifications.unreadCount(actor.companyId, actor.id);
      return {
        unreadCount: c.unread_count,
        highPriorityUnreadCount: c.high_priority_unread_count,
        urgentUnreadCount: c.urgent_unread_count,
        lastNotificationAt: c.last_notification_at,
      } satisfies MeNotificationSummary;
    });
  }

  /**
   * Chung cho MỌI section: precedence gate (module_disabled → unlinked → forbidden) rồi đọc reader trong
   * try/catch fail-soft. Trả về Section — KHÔNG throw (trừ anomaly đã xử ở resolver TRƯỚC khi vào đây).
   */
  private async composeSection<T>(
    actor: Actor,
    person: CurrentPerson,
    moduleFlags: Map<string, boolean>,
    source: MeSectionSource,
    reader: () => Promise<T>,
  ): Promise<Section<T>> {
    // (1) module tắt → module_disabled (§12.3), KHÔNG đọc gì.
    if (moduleFlags.get(source.moduleCode) === false) return nonOk("module_disabled");
    // (2) section phụ thuộc employee + chưa liên kết → unlinked_employee (§12.2), KHÔNG đọc gì.
    if (source.employeeDependent && person.linkStatus === "unlinked")
      return nonOk("unlinked_employee");
    // (3) RE-CHECK quyền NGUỒN in-process (SPEC-09 §11.2) — thiếu → forbidden, KHÔNG đọc dữ liệu.
    const decision = await this.permission.can({
      userId: actor.id,
      companyId: actor.companyId,
      action: source.sourcePair.action,
      resourceType: source.sourcePair.resourceType,
      isSensitive: source.sourcePair.isSensitive,
    });
    if (!decision.allow) return nonOk("forbidden");
    // (4) Đọc reader own-scope — fail-soft phân loại exception CHÍNH XÁC.
    try {
      return ok(await reader());
    } catch (err) {
      return this.classifyReaderError<T>(err);
    }
  }

  /**
   * PHÂN LOẠI lỗi reader (silent-failure guard):
   *   ForbiddenException(403) → 'forbidden' (reader nguồn tự chặn quyền — vẫn là thiếu-quyền).
   *   NotFoundException(404)  → 'ok' + data null (thiếu-DỮ-LIỆU ≠ thiếu-quyền — KHÔNG dán forbidden).
   *   HttpException khác      → 'error' (không giả vờ ok).
   *   non-HttpException/hạ tầng → 'error' (degraded — KHÔNG nuốt thành ok/null, KHÔNG 500).
   */
  private classifyReaderError<T>(err: unknown): Section<T> {
    if (err instanceof ForbiddenException) return nonOk("forbidden");
    if (err instanceof NotFoundException) return { status: "ok", data: null };
    if (err instanceof HttpException) return nonOk("error");
    return nonOk("error");
  }

  /** Resolve cờ bật/tắt 5 core module BATCH (mirror module-catalog: default enabled, chỉ false → tắt). */
  private async resolveModuleFlags(actor: Actor): Promise<Map<string, boolean>> {
    const codes = ME_SECTION_SOURCES.map((s) => s.moduleCode);
    const resolved = await this.settings.resolveMany(actor.companyId, codes.map(moduleEnabledKey));
    const byKey = new Map(resolved.map((r) => [r.key, r]));
    const flags = new Map<string, boolean>();
    for (const code of codes) {
      const r = byKey.get(moduleEnabledKey(code));
      // default=true: chưa seed/không thấy → enabled. Chỉ tắt khi setting tồn tại và = false (mirror module-catalog).
      flags.set(code, r?.found ? r.value === true || r.value === "true" : true);
    }
    return flags;
  }
}

/** dueAt (ISO) rơi vào NGÀY hiện tại (UTC) — roll-up nhẹ cho summary (không cần TZ chuẩn của ATT). */
function isDueToday(dueAt: string | null, now: number): boolean {
  if (!dueAt) return false;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date(now);
  return (
    due.getUTCFullYear() === today.getUTCFullYear() &&
    due.getUTCMonth() === today.getUTCMonth() &&
    due.getUTCDate() === today.getUTCDate()
  );
}
