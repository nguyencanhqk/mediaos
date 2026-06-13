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
    workingDaysJson: jsonb("working_days_json").$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
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
    status: text("status").notNull().default("pending"),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("att_adj_requests_pending_uq")
      .on(t.companyId, t.userId, t.workDate)
      .where(sql`status = 'pending' AND deleted_at IS NULL`),
    index("att_adj_requests_company_id_idx").on(t.companyId),
    index("att_adj_requests_user_id_idx").on(t.userId),
    index("att_adj_requests_status_idx").on(t.companyId, t.status),
    check("att_adj_status_check", sql`status IN ('pending','approved','rejected','cancelled')`),
    check(
      "att_adj_has_request_check",
      sql`requested_check_in_at IS NOT NULL OR requested_check_out_at IS NOT NULL`,
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("leave_requests_company_id_idx").on(t.companyId),
    index("leave_requests_user_id_idx").on(t.userId),
    index("leave_requests_status_idx").on(t.companyId, t.status),
    index("leave_requests_dates_idx").on(t.companyId, t.startDate, t.endDate),
    check("leave_req_status_check", sql`status IN ('pending','approved','rejected','cancelled')`),
    check("leave_req_dates_check", sql`start_date <= end_date`),
    check("leave_req_days_check", sql`total_days > 0`),
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
    remainingDays: numeric("remaining_days", { precision: 6, scale: 1 }).generatedAlwaysAs(
      sql`total_days - used_days`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("leave_balances_user_type_year_uq").on(t.companyId, t.userId, t.leaveTypeId, t.year),
    index("leave_balances_company_id_idx").on(t.companyId),
    index("leave_balances_user_id_idx").on(t.userId),
    check("leave_bal_year_check", sql`year >= 2000 AND year <= 2100`),
    check("leave_bal_total_check", sql`total_days >= 0`),
    check("leave_bal_used_check", sql`used_days >= 0 AND used_days <= total_days`),
  ],
);

export type LeaveBalance = typeof leaveBalances.$inferSelect;
export type NewLeaveBalance = typeof leaveBalances.$inferInsert;
