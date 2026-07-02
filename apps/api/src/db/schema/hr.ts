import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { users } from "./users";
import { tasks } from "./workflow";

// ─── Enums (text columns with CHECK) ────────────────────────────────────────

export type AttendanceStatus =
  | "present"
  | "late"
  | "early_leave"
  | "absent"
  | "missing_checkin"
  | "pending_adjustment"
  | "approved_adjustment";

export type AttendanceMethod = "web" | "mobile" | "manual" | "adjustment";

export type HrRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export type AttendancePeriodStatus = "open" | "locked";

// ─── work_schedules (ca làm) ──────────────────────────────────────────────────
// ADR-0008: start/end là wall-clock time lặp lại theo `timezone` của ca (KHÔNG phải instant).
// Mọi instant (check_in_at…) là timestamptz UTC; work_date suy từ instant theo timezone ca.

export const workSchedules = pgTable(
  "work_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    workType: text("work_type").notNull().default("fixed"),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    /** Ngày làm việc ISO (1=Thứ 2 … 7=Chủ nhật). */
    workingDaysJson: jsonb("working_days_json")
      .$type<number[]>()
      .notNull()
      .default([1, 2, 3, 4, 5]),
    timezone: text("timezone").notNull().default("Asia/Ho_Chi_Minh"),
    graceMinutes: integer("grace_minutes").notNull().default(0),
    isDefault: boolean("is_default").notNull().default(false),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("work_schedules_company_id_idx").on(t.companyId),
    uniqueIndex("work_schedules_company_default_uq")
      .on(t.companyId)
      .where(sql`is_default AND deleted_at IS NULL AND status = 'active'`),
    check("work_schedules_work_type_check", sql`work_type IN ('fixed','shift','flexible')`),
    check("work_schedules_status_check", sql`status IN ('active','inactive')`),
    check("work_schedules_grace_check", sql`grace_minutes >= 0 AND grace_minutes <= 240`),
  ],
);

export type WorkSchedule = typeof workSchedules.$inferSelect;
export type NewWorkSchedule = typeof workSchedules.$inferInsert;

// ─── attendance_records (bản ghi công — feed payroll G12) ────────────────────
// Sửa số liệu công CHỈ qua đơn bổ sung công đã duyệt (audit) — không endpoint sửa thẳng.

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    workScheduleId: uuid("work_schedule_id").references(() => workSchedules.id, {
      onDelete: "set null",
    }),
    checkInAt: timestamp("check_in_at", { withTimezone: true }),
    checkOutAt: timestamp("check_out_at", { withTimezone: true }),
    checkInMethod: text("check_in_method"),
    checkOutMethod: text("check_out_method"),
    locationJson: jsonb("location_json"),
    lateMinutes: integer("late_minutes").notNull().default(0),
    earlyLeaveMinutes: integer("early_leave_minutes").notNull().default(0),
    status: text("status").notNull().default("missing_checkin"),
    note: text("note"),
    // ─── S3-ATT-DB-1 (mig 0452): DB-04 §7.4 cột MỚI NULLABLE additive (Option A evolve). ───
    // Cột cũ ở trên GIỮ NGUYÊN (module attendance/** + payroll KHÔNG vỡ). FK cross-file (employee_profiles/
    // org_units/shifts/attendance_rules/remote_work_requests) = uuid TRẦN tránh import vòng — FK thật ở mig 0452.
    // first/last_log_id + leave_request_id = uuid TRẦN (cycle records↔logs / optional, KHÔNG hard-FK).
    // attendance_status TitleCase MỚI ≠ status lowercase cũ (CHECK chk_attendance_records_attendance_status).
    employeeId: uuid("employee_id"),
    departmentId: uuid("department_id"),
    positionId: uuid("position_id"),
    shiftId: uuid("shift_id"),
    appliedRuleId: uuid("applied_rule_id"),
    firstLogId: uuid("first_log_id"),
    lastLogId: uuid("last_log_id"),
    requiredWorkingMinutes: integer("required_working_minutes"),
    workingMinutes: integer("working_minutes"),
    breakMinutes: integer("break_minutes"),
    missingMinutes: integer("missing_minutes"),
    overtimeMinutes: integer("overtime_minutes"),
    attendanceStatus: text("attendance_status"),
    checkInStatus: text("check_in_status"),
    checkOutStatus: text("check_out_status"),
    attendanceSource: text("attendance_source"),
    workMode: text("work_mode"),
    isLate: boolean("is_late"),
    isEarlyLeave: boolean("is_early_leave"),
    isMissingCheckIn: boolean("is_missing_check_in"),
    isMissingCheckOut: boolean("is_missing_check_out"),
    isAdjusted: boolean("is_adjusted"),
    isAuto: boolean("is_auto"),
    leaveRequestId: uuid("leave_request_id"),
    remoteWorkRequestId: uuid("remote_work_request_id"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: uuid("locked_by").references(() => users.id, { onDelete: "set null" }),
    calculationSnapshot: jsonb("calculation_snapshot"),
    metadata: jsonb("metadata"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("attendance_records_company_user_date_uq")
      .on(t.companyId, t.userId, t.workDate)
      .where(sql`deleted_at IS NULL`),
    index("attendance_records_company_id_idx").on(t.companyId),
    index("attendance_records_user_id_idx").on(t.userId),
    index("attendance_records_work_date_idx").on(t.companyId, t.workDate),
    check(
      "attendance_status_check",
      sql`status IN ('present','late','early_leave','absent','missing_checkin','pending_adjustment','approved_adjustment')`,
    ),
    check("attendance_minutes_check", sql`late_minutes >= 0 AND early_leave_minutes >= 0`),
    // S3-ATT-DB-1 (mig 0452): index + CHECK cột MỚI (forward-looking; UNIQUE chỉ enforce khi employee_id NOT NULL).
    uniqueIndex("uq_attendance_records_employee_date_shift")
      .on(t.companyId, t.employeeId, t.workDate, t.shiftId)
      .where(sql`deleted_at IS NULL AND employee_id IS NOT NULL AND shift_id IS NOT NULL`),
    uniqueIndex("uq_attendance_records_employee_date_no_shift")
      .on(t.companyId, t.employeeId, t.workDate)
      .where(sql`deleted_at IS NULL AND employee_id IS NOT NULL AND shift_id IS NULL`),
    index("idx_attendance_records_employee_date")
      .on(t.companyId, t.employeeId, t.workDate)
      .where(sql`deleted_at IS NULL`),
    index("idx_attendance_records_company_date_status")
      .on(t.companyId, t.workDate, t.attendanceStatus)
      .where(sql`deleted_at IS NULL`),
    index("idx_attendance_records_department_date")
      .on(t.companyId, t.departmentId, t.workDate)
      .where(sql`deleted_at IS NULL`),
    index("idx_attendance_records_remote_request")
      .on(t.remoteWorkRequestId)
      .where(sql`remote_work_request_id IS NOT NULL`),
    check(
      "chk_attendance_records_attendance_status",
      sql`attendance_status IS NULL OR attendance_status IN ('Not Checked-in','Checked-in','Checked-out','Present','Late','Early Leave','Missing Hours','Missing Check-in','Missing Check-out','Absent','Leave','Remote Work','Auto Attendance','Adjusted','Pending Adjustment','Invalid')`,
    ),
    check(
      "chk_attendance_records_attendance_source",
      sql`attendance_source IS NULL OR attendance_source IN ('WEB','MOBILE','MANUAL','AUTO','REMOTE','DEVICE','IMPORT','API')`,
    ),
    check(
      "chk_attendance_records_work_mode",
      sql`work_mode IS NULL OR work_mode IN ('Office','Remote','BusinessTrip','Auto','Leave')`,
    ),
    check(
      "chk_attendance_records_new_minutes",
      sql`(required_working_minutes IS NULL OR required_working_minutes >= 0)
        AND (working_minutes IS NULL OR working_minutes >= 0)
        AND (break_minutes IS NULL OR break_minutes >= 0)
        AND (missing_minutes IS NULL OR missing_minutes >= 0)
        AND (overtime_minutes IS NULL OR overtime_minutes >= 0)`,
    ),
  ],
);

export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
export type NewAttendanceRecord = typeof attendanceRecords.$inferInsert;

// ─── attendance_adjustment_requests (đơn bổ sung công → Task Hub) ─────────────
// task_id trỏ tasks (task_type='hr') — KHÔNG bảng approval riêng (Task Hub hợp nhất).

export const attendanceAdjustmentRequests = pgTable(
  "attendance_adjustment_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    attendanceRecordId: uuid("attendance_record_id").references(() => attendanceRecords.id, {
      onDelete: "set null",
    }),
    workDate: date("work_date").notNull(),
    requestedCheckInAt: timestamp("requested_check_in_at", { withTimezone: true }),
    requestedCheckOutAt: timestamp("requested_check_out_at", { withTimezone: true }),
    reason: text("reason").notNull(),
    // S3-ATT-BE-4 (mig 0457): status reconcile lowercase→TitleCase canonical DB-04 §7.6.
    // Draft/Pending/Approved/Rejected/Cancelled (CHECK chk_att_adj_requests_status). Default 'Pending'.
    status: text("status").notNull().default("Pending"),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    // ─── S3-ATT-DB-1 (mig 0452): DB-04 §7.6 cột MỚI NULLABLE additive. Cột cũ ở trên GIỮ NGUYÊN. ───
    // employee_id → employee_profiles(id) = uuid TRẦN tránh import vòng (FK thật ở mig 0452).
    // request_type CHECK tên MỚI (chk_att_adj_requests_request_type) — KHÔNG đụng att_adj_status_check cũ.
    requestCode: text("request_code"),
    employeeId: uuid("employee_id"),
    requestType: text("request_type"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    currentApproverUserId: uuid("current_approver_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    currentApproverEmployeeId: uuid("current_approver_employee_id"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    attachmentFileId: uuid("attachment_file_id"),
    metadata: jsonb("metadata"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // S3-ATT-BE-4 (mig 0457): unique-pending-guard §7.6.1 theo request_type (thay att_adj_requests_pending_uq
    // cũ trên user_id — chết sau reconcile lowercase + quá chặt). 1 pending / (company,employee,work_date,type).
    uniqueIndex("uq_att_adj_pending_employee_date_type")
      .on(t.companyId, t.employeeId, t.workDate, t.requestType)
      .where(sql`deleted_at IS NULL AND status = 'Pending'`),
    index("att_adj_requests_company_id_idx").on(t.companyId),
    index("att_adj_requests_user_id_idx").on(t.userId),
    index("att_adj_requests_status_idx").on(t.companyId, t.status),
    // S3-ATT-BE-4 (mig 0457): status CHECK canonical TitleCase (thay att_adj_status_check lowercase cũ).
    check(
      "chk_att_adj_requests_status",
      sql`status IN ('Draft','Pending','Approved','Rejected','Cancelled')`,
    ),
    check(
      "att_adj_has_request_check",
      sql`requested_check_in_at IS NOT NULL OR requested_check_out_at IS NOT NULL`,
    ),
    // S3-ATT-DB-1 (mig 0452): index + CHECK request_type cột MỚI.
    index("idx_att_adj_employee_status")
      .on(t.companyId, t.employeeId, t.status, t.workDate)
      .where(sql`deleted_at IS NULL`),
    index("idx_att_adj_status_submitted")
      .on(t.companyId, t.status, t.submittedAt)
      .where(sql`deleted_at IS NULL`),
    index("idx_att_adj_current_approver")
      .on(t.companyId, t.currentApproverUserId, t.status)
      .where(sql`deleted_at IS NULL`),
    check(
      "chk_att_adj_requests_request_type",
      sql`request_type IS NULL OR request_type IN ('MISSING_CHECK_IN','MISSING_CHECK_OUT','UPDATE_CHECK_IN','UPDATE_CHECK_OUT','EXPLAIN_LATE','EXPLAIN_EARLY_LEAVE','UPDATE_STATUS','REMOTE_CORRECTION','OTHER')`,
    ),
  ],
);

export type AttendanceAdjustmentRequest = typeof attendanceAdjustmentRequests.$inferSelect;
export type NewAttendanceAdjustmentRequest = typeof attendanceAdjustmentRequests.$inferInsert;

// ─── attendance_periods (khoá kỳ công — chốt số liệu cho payroll G12) ─────────

export const attendancePeriods = pgTable(
  "attendance_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    /** 'YYYY-MM' theo timezone ca làm (tháng công). */
    periodMonth: text("period_month").notNull(),
    status: text("status").notNull().default("open"),
    lockedBy: uuid("locked_by").references(() => users.id, { onDelete: "set null" }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("attendance_periods_company_month_uq").on(t.companyId, t.periodMonth),
    check("att_periods_month_check", sql`period_month ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
    check("att_periods_status_check", sql`status IN ('open','locked')`),
  ],
);

export type AttendancePeriod = typeof attendancePeriods.$inferSelect;

// ─── leave_types (loại nghỉ) ──────────────────────────────────────────────────

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    paid: boolean("paid").notNull().default(true),
    /** Hạn mức năm (ngày). NULL = không giới hạn (vd nghỉ không lương). */
    annualQuota: numeric("annual_quota", { precision: 5, scale: 1 }),
    status: text("status").notNull().default("active"),
    // ─── S3-LEAVE-DB-1 (mig 0453): DB-05 §7.1 cột MỚI NULLABLE additive. Cột cũ ở trên GIỮ NGUYÊN ───
    // (code = leave_type_code, paid = is_paid). balance_unit/allow_*/require_* = cấu hình loại nghỉ MỚI.
    description: text("description"),
    deductBalance: boolean("deduct_balance"),
    balanceUnit: text("balance_unit"),
    allowFullDay: boolean("allow_full_day"),
    allowHalfDay: boolean("allow_half_day"),
    allowHourly: boolean("allow_hourly"),
    allowMultipleDays: boolean("allow_multiple_days"),
    requireReason: boolean("require_reason"),
    requireAttachment: boolean("require_attachment"),
    minNoticeDays: integer("min_notice_days"),
    maxDaysPerRequest: numeric("max_days_per_request", { precision: 8, scale: 2 }),
    maxHoursPerRequest: numeric("max_hours_per_request", { precision: 8, scale: 2 }),
    allowNegativeBalance: boolean("allow_negative_balance"),
    isSystemDefault: boolean("is_system_default"),
    sortOrder: integer("sort_order"),
    metadata: jsonb("metadata"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("leave_types_company_code_active_uq")
      .on(t.companyId, t.code)
      .where(sql`deleted_at IS NULL`),
    index("leave_types_company_id_idx").on(t.companyId),
    check("leave_types_status_check", sql`status IN ('active','inactive')`),
    // S3-LEAVE-DB-1 (mig 0453): CHECK + index cột MỚI (tên MỚI, NULLABLE — KHÔNG đụng status_check cũ).
    check(
      "chk_leave_types_balance_unit",
      sql`balance_unit IS NULL OR balance_unit IN ('Day','Hour')`,
    ),
    check(
      "chk_leave_types_request_limit",
      sql`(max_days_per_request IS NULL OR max_days_per_request > 0) AND (max_hours_per_request IS NULL OR max_hours_per_request > 0)`,
    ),
    index("idx_leave_types_company_sort")
      .on(t.companyId, t.sortOrder)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type LeaveType = typeof leaveTypes.$inferSelect;
export type NewLeaveType = typeof leaveTypes.$inferInsert;

// ─── leave_requests (đơn nghỉ → Task Hub) ─────────────────────────────────────

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "restrict" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    totalDays: numeric("total_days", { precision: 5, scale: 1 }).notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    // ─── S3-LEAVE-DB-1 (mig 0453): DB-05 §7.5 cột MỚI NULLABLE additive. Cột cũ ở trên GIỮ NGUYÊN. ───
    // employee_id MỚI (nullable) BÊN CẠNH user_id cũ. FK cross-file (employee_profiles/org_units/positions/
    // leave_policies) = uuid TRẦN tránh import vòng — FK thật ở mig 0453. status union check (lowercase ∪ TitleCase).
    leaveRequestCode: text("leave_request_code"),
    employeeId: uuid("employee_id"),
    departmentId: uuid("department_id"),
    positionId: uuid("position_id"),
    directManagerEmployeeId: uuid("direct_manager_employee_id"),
    leavePolicyId: uuid("leave_policy_id"),
    durationType: text("duration_type"),
    halfDaySession: text("half_day_session"),
    startTime: time("start_time"),
    endTime: time("end_time"),
    totalHours: numeric("total_hours", { precision: 8, scale: 2 }),
    handoverNote: text("handover_note"),
    contactDuringLeave: text("contact_during_leave"),
    currentApproverUserId: uuid("current_approver_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    currentApproverEmployeeId: uuid("current_approver_employee_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedBy: uuid("rejected_by").references(() => users.id, { onDelete: "set null" }),
    rejectionReason: text("rejection_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
    revokeReason: text("revoke_reason"),
    balanceEffectStatus: text("balance_effect_status"),
    attendanceSyncStatus: text("attendance_sync_status"),
    calculationSnapshot: jsonb("calculation_snapshot"),
    approvalSnapshot: jsonb("approval_snapshot"),
    metadata: jsonb("metadata"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("leave_requests_company_id_idx").on(t.companyId),
    index("leave_requests_user_id_idx").on(t.userId),
    index("leave_requests_status_idx").on(t.companyId, t.status),
    index("leave_requests_dates_idx").on(t.companyId, t.startDate, t.endDate),
    // S3-LEAVE-DB-1 (mig 0453): status CHECK = UNION (lowercase legacy ∪ TitleCase SPEC-05) — HOT-FILE union,
    // giữ giá trị cũ chèn được + cho phép TitleCase mới (DB-05 §4.8). KHÔNG rewrite mất giá trị legacy.
    check(
      "leave_req_status_check",
      sql`status IN ('pending','approved','rejected','cancelled','draft','revoked','Draft','Pending','Approved','Rejected','Cancelled','Revoked')`,
    ),
    check("leave_req_dates_check", sql`start_date <= end_date`),
    check("leave_req_days_check", sql`total_days > 0`),
    // S3-LEAVE-DB-1 (mig 0453): CHECK + index cột MỚI (tên MỚI, NULLABLE hợp lệ — cột chưa backfill).
    check(
      "chk_leave_requests_duration_type",
      sql`duration_type IS NULL OR duration_type IN ('FullDay','HalfDay','Hourly','MultipleDays')`,
    ),
    check(
      "chk_leave_requests_half_day_session",
      sql`half_day_session IS NULL OR half_day_session IN ('Morning','Afternoon')`,
    ),
    check(
      "chk_leave_requests_balance_effect_status",
      sql`balance_effect_status IS NULL OR balance_effect_status IN ('None','Reserved','Used','Released','Refunded')`,
    ),
    check(
      "chk_leave_requests_attendance_sync_status",
      sql`attendance_sync_status IS NULL OR attendance_sync_status IN ('Not Required','Pending','Synced','Failed','Reverted','Pending Revert')`,
    ),
    check("chk_leave_requests_total_hours", sql`total_hours IS NULL OR total_hours >= 0`),
    uniqueIndex("uq_leave_requests_company_code_active")
      .on(t.companyId, t.leaveRequestCode)
      .where(sql`deleted_at IS NULL AND leave_request_code IS NOT NULL`),
    index("idx_leave_requests_employee_date")
      .on(t.companyId, t.employeeId, t.startDate, t.endDate)
      .where(sql`deleted_at IS NULL`),
    index("idx_leave_requests_pending_approver")
      .on(t.companyId, t.currentApproverUserId, t.status)
      .where(sql`deleted_at IS NULL AND status = 'Pending'`),
    index("idx_leave_requests_department_date")
      .on(t.companyId, t.departmentId, t.startDate, t.endDate)
      .where(sql`deleted_at IS NULL`),
    index("idx_leave_requests_type_status")
      .on(t.companyId, t.leaveTypeId, t.status)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type NewLeaveRequest = typeof leaveRequests.$inferInsert;

// ─── leave_balances (số phép — trừ lúc duyệt, mọi thay đổi có audit) ──────────
// remaining_days là GENERATED COLUMN (total - used) — DB đảm bảo không lệch.
// CHECK used_days <= total_days = backstop chống race 2 lần duyệt song song.

export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    totalDays: numeric("total_days", { precision: 5, scale: 1 }).notNull().default("0"),
    usedDays: numeric("used_days", { precision: 5, scale: 1 }).notNull().default("0"),
    // ⛔ GIỮ NGUYÊN: remaining_days GENERATED ALWAYS AS (total_days - used_days) STORED — DB đảm bảo không
    // lệch. KHÔNG DROP/recreate, KHÔNG re-add (S3-LEAVE-DB-1 giữ generated col + CHECK leave_bal_used_check).
    remainingDays: numeric("remaining_days", { precision: 6, scale: 1 }).generatedAlwaysAs(
      sql`total_days - used_days`,
    ),
    // ─── S3-LEAVE-DB-1 (mig 0453): DB-05 §7.3 cột MỚI NULLABLE additive. Cột cũ ở trên GIỮ NGUYÊN. ───
    // employee_id MỚI (nullable) BÊN CẠNH user_id cũ (uuid TRẦN → FK thật ở mig 0453). balance_year = năm DB-05.
    employeeId: uuid("employee_id"),
    balanceYear: integer("balance_year"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    openingDays: numeric("opening_days", { precision: 8, scale: 2 }),
    grantedDays: numeric("granted_days", { precision: 8, scale: 2 }),
    pendingDays: numeric("pending_days", { precision: 8, scale: 2 }),
    adjustedDays: numeric("adjusted_days", { precision: 8, scale: 2 }),
    carriedOverDays: numeric("carried_over_days", { precision: 8, scale: 2 }),
    expiredDays: numeric("expired_days", { precision: 8, scale: 2 }),
    openingHours: numeric("opening_hours", { precision: 8, scale: 2 }),
    grantedHours: numeric("granted_hours", { precision: 8, scale: 2 }),
    usedHours: numeric("used_hours", { precision: 8, scale: 2 }),
    pendingHours: numeric("pending_hours", { precision: 8, scale: 2 }),
    adjustedHours: numeric("adjusted_hours", { precision: 8, scale: 2 }),
    remainingHours: numeric("remaining_hours", { precision: 8, scale: 2 }),
    lastAccrualAt: timestamp("last_accrual_at", { withTimezone: true }),
    lastCalculatedAt: timestamp("last_calculated_at", { withTimezone: true }),
    status: text("status"),
    metadata: jsonb("metadata"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("leave_balances_user_type_year_uq").on(
      t.companyId,
      t.userId,
      t.leaveTypeId,
      t.year,
    ),
    index("leave_balances_company_id_idx").on(t.companyId),
    index("leave_balances_user_id_idx").on(t.userId),
    check("leave_bal_year_check", sql`year >= 2000 AND year <= 2100`),
    check("leave_bal_total_check", sql`total_days >= 0`),
    check("leave_bal_used_check", sql`used_days >= 0 AND used_days <= total_days`),
    // S3-LEAVE-DB-1 (mig 0453): CHECK + index cột MỚI (tên MỚI, NULLABLE — KHÔNG đụng các CHECK cũ ở trên).
    check("chk_leave_balances_status", sql`status IS NULL OR status IN ('Active','Closed')`),
    index("idx_leave_balances_employee_year")
      .on(t.companyId, t.employeeId, t.balanceYear)
      .where(sql`deleted_at IS NULL`),
    index("idx_leave_balances_type_year_new")
      .on(t.companyId, t.leaveTypeId, t.balanceYear)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type LeaveBalance = typeof leaveBalances.$inferSelect;
export type NewLeaveBalance = typeof leaveBalances.$inferInsert;
