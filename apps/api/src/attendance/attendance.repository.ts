import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { attendanceLogs, attendanceRules, shiftAssignments, shifts } from "../db/schema/attendance";
import { employeeProfiles } from "../db/schema/employees";
import {
  attendancePeriods,
  attendanceRecords,
  leaveRequests,
  workSchedules,
} from "../db/schema/hr";
import { users } from "../db/schema/users";

/** Cột ca làm cần cho resolve/calc Today/check-in/check-out (rút gọn từ shifts). */
const SHIFT_FIELDS = {
  id: shifts.id,
  shiftCode: shifts.shiftCode,
  name: shifts.name,
  startTime: shifts.startTime,
  endTime: shifts.endTime,
  breakMinutes: shifts.breakMinutes,
  requiredWorkingMinutes: shifts.requiredWorkingMinutes,
  graceLateMinutes: shifts.graceLateMinutes,
  graceEarlyLeaveMinutes: shifts.graceEarlyLeaveMinutes,
  crossDay: shifts.crossDay,
  isDefault: shifts.isDefault,
  metadata: shifts.metadata,
} as const;

/** Cột rule cần cho resolve hiệu lực (rút gọn từ attendance_rules). */
const RULE_FIELDS = {
  id: attendanceRules.id,
  ruleCode: attendanceRules.ruleCode,
  requireCheckIn: attendanceRules.requireCheckIn,
  requireCheckOut: attendanceRules.requireCheckOut,
  ruleConfig: attendanceRules.ruleConfig,
} as const;

/** Specificity ranking (Employee≻Department≻Company≻System) làm khoá sort chính khi resolve hiệu lực. */
const SHIFT_SPECIFICITY = sql`CASE ${shiftAssignments.assignmentScope} WHEN 'Employee' THEN 4 WHEN 'Department' THEN 3 WHEN 'Company' THEN 2 ELSE 1 END DESC`;
const RULE_SPECIFICITY = sql`CASE ${attendanceRules.ruleScope} WHEN 'Employee' THEN 4 WHEN 'Department' THEN 3 WHEN 'Company' THEN 2 ELSE 1 END DESC`;

/** Persistence for G11-1 attendance. Every method is tenant-scoped (RLS + explicit company_id). */
@Injectable()
export class AttendanceRepository {
  constructor(private readonly db: DatabaseService) {}

  // ─── work_schedules ────────────────────────────────────────────────────────

  findSchedules(companyId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(workSchedules)
        .where(and(eq(workSchedules.companyId, companyId), isNull(workSchedules.deletedAt)))
        .orderBy(desc(workSchedules.isDefault), workSchedules.name),
    );
  }

  findScheduleByIdTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select()
      .from(workSchedules)
      .where(
        and(
          eq(workSchedules.companyId, companyId),
          eq(workSchedules.id, id),
          isNull(workSchedules.deletedAt),
        ),
      )
      .limit(1);
  }

  findDefaultScheduleTx(companyId: string, tx: TenantTx) {
    return tx
      .select()
      .from(workSchedules)
      .where(
        and(
          eq(workSchedules.companyId, companyId),
          eq(workSchedules.isDefault, true),
          eq(workSchedules.status, "active"),
          isNull(workSchedules.deletedAt),
        ),
      )
      .limit(1);
  }

  /** Resolve the user's assigned schedule, falling back to the company default — all inside one tx. */
  async resolveScheduleForUserTx(companyId: string, userId: string, tx: TenantTx) {
    const [profile] = await tx
      .select({ workScheduleId: employeeProfiles.workScheduleId })
      .from(employeeProfiles)
      .where(and(eq(employeeProfiles.companyId, companyId), eq(employeeProfiles.userId, userId)))
      .limit(1);

    if (profile?.workScheduleId) {
      const [assigned] = await this.findScheduleByIdTx(companyId, profile.workScheduleId, tx);
      if (assigned) return assigned;
    }
    const [fallback] = await this.findDefaultScheduleTx(companyId, tx);
    return fallback ?? null;
  }

  createScheduleTx(companyId: string, data: typeof workSchedules.$inferInsert, tx: TenantTx) {
    return tx
      .insert(workSchedules)
      .values({ ...data, companyId })
      .returning();
  }

  updateScheduleTx(
    companyId: string,
    id: string,
    data: Partial<typeof workSchedules.$inferInsert>,
    tx: TenantTx,
  ) {
    return tx
      .update(workSchedules)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(workSchedules.companyId, companyId),
          eq(workSchedules.id, id),
          isNull(workSchedules.deletedAt),
        ),
      )
      .returning();
  }

  // ─── attendance_records ────────────────────────────────────────────────────

  findRecordByUserDateTx(companyId: string, userId: string, workDate: string, tx: TenantTx) {
    return tx
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.companyId, companyId),
          eq(attendanceRecords.userId, userId),
          eq(attendanceRecords.workDate, workDate),
          isNull(attendanceRecords.deletedAt),
        ),
      )
      .limit(1);
  }

  /**
   * S3-ATT-BE-4 — a single record by id under a `FOR UPDATE` row-lock (adjust-direct serialisation).
   * Tenant-scoped: a cross-tenant id returns no row (RLS + explicit company_id) → caller maps to 404.
   */
  findRecordByIdForUpdateTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.companyId, companyId),
          eq(attendanceRecords.id, id),
          isNull(attendanceRecords.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
  }

  /**
   * Most recent OPEN record (checked-in, not yet checked-out) for a user. Used by check-out so an
   * overnight shift (check-in on day D, check-out on D+1 local) resolves the in-progress record
   * regardless of today's local date — fixes the dropped-checkout bug for cross-midnight shifts.
   */
  findOpenRecordForUserTx(companyId: string, userId: string, tx: TenantTx) {
    return tx
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.companyId, companyId),
          eq(attendanceRecords.userId, userId),
          isNotNull(attendanceRecords.checkInAt),
          isNull(attendanceRecords.checkOutAt),
          isNull(attendanceRecords.deletedAt),
        ),
      )
      .orderBy(desc(attendanceRecords.workDate))
      .limit(1);
  }

  findRecordsByMonth(
    companyId: string,
    opts: { from: string; toExclusive: string; userId?: string; limit: number; offset: number },
  ) {
    return this.db.withTenant(companyId, (tx) => {
      const conds = [
        eq(attendanceRecords.companyId, companyId),
        isNull(attendanceRecords.deletedAt),
        // Half-open interval [from, toExclusive) via gte + lt — avoids the prevDay footgun.
        gte(attendanceRecords.workDate, opts.from),
        lt(attendanceRecords.workDate, opts.toExclusive),
      ];
      if (opts.userId) conds.push(eq(attendanceRecords.userId, opts.userId));
      return tx
        .select({
          id: attendanceRecords.id,
          userId: attendanceRecords.userId,
          userFullName: users.fullName,
          workDate: attendanceRecords.workDate,
          workScheduleId: attendanceRecords.workScheduleId,
          checkInAt: attendanceRecords.checkInAt,
          checkOutAt: attendanceRecords.checkOutAt,
          checkInMethod: attendanceRecords.checkInMethod,
          checkOutMethod: attendanceRecords.checkOutMethod,
          lateMinutes: attendanceRecords.lateMinutes,
          earlyLeaveMinutes: attendanceRecords.earlyLeaveMinutes,
          status: attendanceRecords.status,
          note: attendanceRecords.note,
        })
        .from(attendanceRecords)
        .innerJoin(users, eq(attendanceRecords.userId, users.id))
        .where(and(...conds))
        .orderBy(attendanceRecords.workDate, users.fullName)
        .limit(opts.limit)
        .offset(opts.offset);
    });
  }

  insertRecordTx(companyId: string, data: typeof attendanceRecords.$inferInsert, tx: TenantTx) {
    return tx
      .insert(attendanceRecords)
      .values({ ...data, companyId })
      .returning();
  }

  updateRecordTx(
    companyId: string,
    id: string,
    data: Partial<typeof attendanceRecords.$inferInsert>,
    tx: TenantTx,
  ) {
    return tx
      .update(attendanceRecords)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(attendanceRecords.companyId, companyId),
          eq(attendanceRecords.id, id),
          isNull(attendanceRecords.deletedAt),
        ),
      )
      .returning();
  }

  // ─── S3-ATT-BE-1 — employee resolution / effective shift+rule / leave-block / logs ────
  // Mọi method dưới đây chạy TRONG `withTenant(tx)` của Service (RLS+FORCE ép company_id ở DB,
  // BẤT BIẾN #1) + AND company_id tường minh (defense-in-depth). KHÔNG query trần.

  /**
   * Hồ sơ nhân sự active theo user (1:1 qua employee_profiles_company_user_active_uq). Server-side resolve
   * — KHÔNG bao giờ tin employee_id từ client. Trả null khi không có mapping (caller quyết Forbidden/today-empty).
   */
  async resolveEmployeeByUserIdTx(companyId: string, userId: string, tx: TenantTx) {
    const rows = await tx
      .select({
        id: employeeProfiles.id,
        status: employeeProfiles.status,
        orgUnitId: employeeProfiles.orgUnitId,
        positionId: employeeProfiles.positionId,
      })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.userId, userId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * S3-ATT-BE-3 — hồ sơ nhân sự theo employee_profiles.id (tenant-scoped), dùng khi HR/Admin xem rule
   * hiệu lực CỦA NGƯỜI KHÁC (GET /attendance/rules/effective?employeeId=). Trả null nếu không tồn tại
   * hoặc thuộc company khác (404 ở caller — KHÔNG lộ tồn tại xuyên tenant).
   */
  async resolveEmployeeByIdTx(companyId: string, employeeId: string, tx: TenantTx) {
    const rows = await tx
      .select({
        id: employeeProfiles.id,
        status: employeeProfiles.status,
        orgUnitId: employeeProfiles.orgUnitId,
        positionId: employeeProfiles.positionId,
      })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.id, employeeId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Ca làm hiệu lực cho ngày `workDate` theo độ ưu tiên Employee≻Department≻Company (DB-04 §10): lọc Active +
   * còn hiệu lực, sort specificity DESC → priority DESC → effective_from DESC, lấy 1. Join shift_assignments→shifts.
   */
  async resolveEffectiveShiftTx(
    companyId: string,
    opts: { employeeId: string; orgUnitId: string | null; workDate: string },
    tx: TenantTx,
  ) {
    const scope = [
      eq(shiftAssignments.assignmentScope, "Company"),
      and(
        eq(shiftAssignments.assignmentScope, "Employee"),
        eq(shiftAssignments.employeeId, opts.employeeId),
      ),
    ];
    if (opts.orgUnitId) {
      scope.push(
        and(
          eq(shiftAssignments.assignmentScope, "Department"),
          eq(shiftAssignments.departmentId, opts.orgUnitId),
        ),
      );
    }
    const rows = await tx
      .select(SHIFT_FIELDS)
      .from(shiftAssignments)
      .innerJoin(shifts, eq(shiftAssignments.shiftId, shifts.id))
      .where(
        and(
          eq(shiftAssignments.companyId, companyId),
          eq(shiftAssignments.status, "Active"),
          isNull(shiftAssignments.deletedAt),
          lte(shiftAssignments.effectiveFrom, opts.workDate),
          or(
            isNull(shiftAssignments.effectiveTo),
            gte(shiftAssignments.effectiveTo, opts.workDate),
          ),
          or(...scope),
          eq(shifts.status, "Active"),
          isNull(shifts.deletedAt),
        ),
      )
      .orderBy(
        SHIFT_SPECIFICITY,
        desc(shiftAssignments.priority),
        desc(shiftAssignments.effectiveFrom),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Ca mặc định công ty (is_default Active) — fallback khi không có assignment khớp. */
  async findDefaultShiftTx(companyId: string, tx: TenantTx) {
    const rows = await tx
      .select(SHIFT_FIELDS)
      .from(shifts)
      .where(
        and(
          eq(shifts.companyId, companyId),
          eq(shifts.isDefault, true),
          eq(shifts.status, "Active"),
          isNull(shifts.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Ca đã áp ở bản ghi (check-out đọc lại theo shift_id đã lưu lúc check-in → calc nhất quán). */
  async findShiftByIdTx(companyId: string, id: string, tx: TenantTx) {
    const rows = await tx
      .select(SHIFT_FIELDS)
      .from(shifts)
      .where(and(eq(shifts.companyId, companyId), eq(shifts.id, id), isNull(shifts.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Rule chấm công hiệu lực cho `workDate` theo Employee≻Department≻Company≻System (DB-04 §10). Lọc Active +
   * còn hiệu lực; sort specificity → priority → effective_from. Lấy 1.
   */
  async resolveEffectiveRuleTx(
    companyId: string,
    opts: { employeeId: string; orgUnitId: string | null; workDate: string },
    tx: TenantTx,
  ) {
    const scope = [
      inArray(attendanceRules.ruleScope, ["Company", "System"]),
      and(
        eq(attendanceRules.ruleScope, "Employee"),
        eq(attendanceRules.employeeId, opts.employeeId),
      ),
    ];
    if (opts.orgUnitId) {
      scope.push(
        and(
          eq(attendanceRules.ruleScope, "Department"),
          eq(attendanceRules.departmentId, opts.orgUnitId),
        ),
      );
    }
    const rows = await tx
      .select(RULE_FIELDS)
      .from(attendanceRules)
      .where(
        and(
          eq(attendanceRules.companyId, companyId),
          eq(attendanceRules.status, "Active"),
          isNull(attendanceRules.deletedAt),
          lte(attendanceRules.effectiveFrom, opts.workDate),
          or(isNull(attendanceRules.effectiveTo), gte(attendanceRules.effectiveTo, opts.workDate)),
          or(...scope),
        ),
      )
      .orderBy(
        RULE_SPECIFICITY,
        desc(attendanceRules.priority),
        desc(attendanceRules.effectiveFrom),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Rule theo business-code (fallback: DEFAULT_OFFICE_RULE). */
  async findRuleByCodeTx(companyId: string, ruleCode: string, tx: TenantTx) {
    const rows = await tx
      .select(RULE_FIELDS)
      .from(attendanceRules)
      .where(
        and(
          eq(attendanceRules.companyId, companyId),
          eq(attendanceRules.ruleCode, ruleCode),
          eq(attendanceRules.status, "Active"),
          isNull(attendanceRules.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Bất kỳ rule Company/System Active nào (fallback cuối trước in-code default). */
  async findAnyActiveRuleTx(companyId: string, tx: TenantTx) {
    const rows = await tx
      .select(RULE_FIELDS)
      .from(attendanceRules)
      .where(
        and(
          eq(attendanceRules.companyId, companyId),
          inArray(attendanceRules.ruleScope, ["Company", "System"]),
          eq(attendanceRules.status, "Active"),
          isNull(attendanceRules.deletedAt),
        ),
      )
      .orderBy(desc(attendanceRules.priority))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Có đơn nghỉ ĐÃ DUYỆT phủ trọn ngày `workDate` không (cross-module READ leave_requests, AND company_id).
   * status duality (lowercase legacy ∪ TitleCase SPEC-05); duration_type NULL (legacy) coi như cả ngày.
   */
  async findApprovedFullDayLeaveTx(
    companyId: string,
    opts: { userId: string; employeeId: string | null; workDate: string },
    tx: TenantTx,
  ): Promise<boolean> {
    const subject = [eq(leaveRequests.userId, opts.userId)];
    if (opts.employeeId) subject.push(eq(leaveRequests.employeeId, opts.employeeId));
    const rows = await tx
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.companyId, companyId),
          isNull(leaveRequests.deletedAt),
          or(...subject),
          inArray(leaveRequests.status, ["approved", "Approved"]),
          lte(leaveRequests.startDate, opts.workDate),
          gte(leaveRequests.endDate, opts.workDate),
          or(
            isNull(leaveRequests.durationType),
            inArray(leaveRequests.durationType, ["FullDay", "MultipleDays"]),
          ),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** attendance_logs APPEND-ONLY (BẤT BIẾN #2) — chỉ INSERT, KHÔNG UPDATE/DELETE. company_id từ ngữ cảnh + tường minh. */
  insertAttendanceLogTx(companyId: string, data: typeof attendanceLogs.$inferInsert, tx: TenantTx) {
    return tx
      .insert(attendanceLogs)
      .values({ ...data, companyId })
      .returning({ id: attendanceLogs.id });
  }

  // ─── attendance_adjustment_requests ──────────────────────────────────────────
  // S3-ATT-BE-4: the adjustment-request CRUD moved to AttendanceAdjustmentRepository (canonical
  // employee_id + items ledger + DataScope join). Removed here to keep a single writer.

  // ─── attendance_periods ──────────────────────────────────────────────────────

  findPeriods(companyId: string, opts: { limit: number; offset: number }) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(attendancePeriods)
        .where(eq(attendancePeriods.companyId, companyId))
        .orderBy(desc(attendancePeriods.periodMonth))
        .limit(opts.limit)
        .offset(opts.offset),
    );
  }

  findPeriodTx(companyId: string, periodMonth: string, tx: TenantTx) {
    return tx
      .select()
      .from(attendancePeriods)
      .where(
        and(
          eq(attendancePeriods.companyId, companyId),
          eq(attendancePeriods.periodMonth, periodMonth),
        ),
      )
      .limit(1);
  }

  /** True iff the given period is locked. Read inside the caller's tx for check-in/adjust gating. */
  async isPeriodLockedTx(companyId: string, periodMonth: string, tx: TenantTx): Promise<boolean> {
    const [row] = await this.findPeriodTx(companyId, periodMonth, tx);
    return row?.status === "locked";
  }

  lockPeriodTx(companyId: string, data: { periodMonth: string; lockedBy: string }, tx: TenantTx) {
    return tx
      .insert(attendancePeriods)
      .values({
        companyId,
        periodMonth: data.periodMonth,
        status: "locked",
        lockedBy: data.lockedBy,
        lockedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [attendancePeriods.companyId, attendancePeriods.periodMonth],
        set: {
          status: "locked",
          lockedBy: data.lockedBy,
          lockedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
  }
}
