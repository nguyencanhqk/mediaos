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
import { employeeProfiles } from "./employees";
import { orgUnits } from "./org";
import { users } from "./users";

/**
 * ATT Core (DB-04 §7) — 7 bảng MỚI. DDL/RLS+FORCE/policy tenant_isolation/grant ở migration 0452.
 *
 * BẢN ĐỒ TÊN DB-04 → QUAN HỆ THẬT (KHÔNG có bảng `employees`/`departments`):
 *   employee_id   → employee_profiles(id)   ·  department_id → org_units(id)
 * first_log_id/last_log_id/leave_request_id = UUID TRẦN (KHÔNG hard-FK — cycle/optional, DB-04 DDL).
 *
 * BẤT BIẾN #2 (append-only): attendance_logs · attendance_adjustment_items · remote_work_request_approvals
 *   = ledger/append — app role GRANT SELECT,INSERT ONLY (migration 0452). KHÔNG UPDATE/DELETE.
 *
 * GHI CHÚ FK cross-file: shifts/attendance_rules → attendance_records dùng cột uuid TRẦN (không .references())
 *   để tránh import vòng attendance ↔ hr. FK thật vẫn được migration 0452 ép ở tầng DB.
 */

// ─── shifts (DB-04 §7.1) ──────────────────────────────────────────────────────

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    shiftCode: text("shift_code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    shiftType: text("shift_type").notNull().default("Fixed"),
    startTime: time("start_time"),
    endTime: time("end_time"),
    breakStartTime: time("break_start_time"),
    breakEndTime: time("break_end_time"),
    breakMinutes: integer("break_minutes").notNull().default(0),
    requiredWorkingMinutes: integer("required_working_minutes").notNull(),
    flexibleCheckInFrom: time("flexible_check_in_from"),
    flexibleCheckInTo: time("flexible_check_in_to"),
    graceLateMinutes: integer("grace_late_minutes").notNull().default(0),
    graceEarlyLeaveMinutes: integer("grace_early_leave_minutes").notNull().default(0),
    allowEarlyCheckIn: boolean("allow_early_check_in").notNull().default(true),
    allowLateCheckOut: boolean("allow_late_check_out").notNull().default(true),
    crossDay: boolean("cross_day").notNull().default(false),
    workDays: jsonb("work_days").$type<number[]>(),
    status: text("status").notNull().default("Active"),
    isDefault: boolean("is_default").notNull().default(false),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_shifts_company_code_active")
      .on(t.companyId, t.shiftCode)
      .where(sql`deleted_at IS NULL`),
    index("idx_shifts_company_status")
      .on(t.companyId, t.status)
      .where(sql`deleted_at IS NULL`),
    index("idx_shifts_company_default")
      .on(t.companyId, t.isDefault)
      .where(sql`deleted_at IS NULL AND status = 'Active'`),
    check("chk_shifts_type", sql`shift_type IN ('Fixed','Flexible','Split','Night')`),
    check("chk_shifts_status", sql`status IN ('Active','Inactive')`),
    check("chk_shifts_minutes", sql`required_working_minutes > 0 AND break_minutes >= 0`),
  ],
);

export type Shift = typeof shifts.$inferSelect;
export type NewShift = typeof shifts.$inferInsert;

// ─── shift_assignments (DB-04 §7.2) ───────────────────────────────────────────

export const shiftAssignments = pgTable(
  "shift_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "cascade" }),
    assignmentScope: text("assignment_scope").notNull(),
    departmentId: uuid("department_id").references(() => orgUnits.id, { onDelete: "set null" }),
    employeeId: uuid("employee_id").references(() => employeeProfiles.id, { onDelete: "set null" }),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    priority: integer("priority").notNull().default(0),
    status: text("status").notNull().default("Active"),
    note: text("note"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("idx_shift_assignments_company_scope")
      .on(t.companyId, t.assignmentScope, t.status)
      .where(sql`deleted_at IS NULL`),
    index("idx_shift_assignments_department_date")
      .on(t.companyId, t.departmentId, t.effectiveFrom, t.effectiveTo)
      .where(sql`deleted_at IS NULL`),
    index("idx_shift_assignments_employee_date")
      .on(t.companyId, t.employeeId, t.effectiveFrom, t.effectiveTo)
      .where(sql`deleted_at IS NULL`),
    check(
      "chk_shift_assignments_scope",
      sql`assignment_scope IN ('Company','Department','Employee')`,
    ),
    check("chk_shift_assignments_status", sql`status IN ('Active','Inactive')`),
    check(
      "chk_shift_assignments_date",
      sql`effective_to IS NULL OR effective_to >= effective_from`,
    ),
    check(
      "chk_shift_assignments_target",
      sql`(assignment_scope = 'Company' AND department_id IS NULL AND employee_id IS NULL)
        OR (assignment_scope = 'Department' AND department_id IS NOT NULL AND employee_id IS NULL)
        OR (assignment_scope = 'Employee' AND employee_id IS NOT NULL)`,
    ),
  ],
);

export type ShiftAssignment = typeof shiftAssignments.$inferSelect;
export type NewShiftAssignment = typeof shiftAssignments.$inferInsert;

// ─── attendance_rules (DB-04 §7.3) ────────────────────────────────────────────

export const attendanceRules = pgTable(
  "attendance_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    ruleCode: text("rule_code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    ruleScope: text("rule_scope").notNull(),
    departmentId: uuid("department_id").references(() => orgUnits.id, { onDelete: "set null" }),
    employeeId: uuid("employee_id").references(() => employeeProfiles.id, { onDelete: "set null" }),
    priority: integer("priority").notNull().default(0),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    requireCheckIn: boolean("require_check_in").notNull().default(true),
    requireCheckOut: boolean("require_check_out").notNull().default(true),
    allowWebCheckIn: boolean("allow_web_check_in").notNull().default(true),
    allowMobileCheckIn: boolean("allow_mobile_check_in").notNull().default(true),
    allowRemoteCheckIn: boolean("allow_remote_check_in").notNull().default(false),
    allowAdjustmentRequest: boolean("allow_adjustment_request").notNull().default(true),
    requireGps: boolean("require_gps").notNull().default(false),
    requireNote: boolean("require_note").notNull().default(false),
    requirePhoto: boolean("require_photo").notNull().default(false),
    allowHolidayAttendance: boolean("allow_holiday_attendance").notNull().default(false),
    allowWeekendAttendance: boolean("allow_weekend_attendance").notNull().default(false),
    autoAttendanceEnabled: boolean("auto_attendance_enabled").notNull().default(false),
    autoCheckOutEnabled: boolean("auto_check_out_enabled").notNull().default(false),
    autoAttendanceWorkingMinutes: integer("auto_attendance_working_minutes"),
    ruleConfig: jsonb("rule_config"),
    status: text("status").notNull().default("Active"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_attendance_rules_company_code_active")
      .on(t.companyId, t.ruleCode)
      .where(sql`deleted_at IS NULL`),
    index("idx_attendance_rules_company_scope")
      .on(t.companyId, t.ruleScope, t.status)
      .where(sql`deleted_at IS NULL`),
    index("idx_attendance_rules_department_date")
      .on(t.companyId, t.departmentId, t.effectiveFrom, t.effectiveTo)
      .where(sql`deleted_at IS NULL`),
    index("idx_attendance_rules_employee_date")
      .on(t.companyId, t.employeeId, t.effectiveFrom, t.effectiveTo)
      .where(sql`deleted_at IS NULL`),
    check(
      "chk_attendance_rules_scope",
      sql`rule_scope IN ('System','Company','Department','Employee')`,
    ),
    check("chk_attendance_rules_status", sql`status IN ('Active','Inactive')`),
    check("chk_attendance_rules_date", sql`effective_to IS NULL OR effective_to >= effective_from`),
    check(
      "chk_attendance_rules_target",
      sql`(rule_scope IN ('System','Company') AND department_id IS NULL AND employee_id IS NULL)
        OR (rule_scope = 'Department' AND department_id IS NOT NULL AND employee_id IS NULL)
        OR (rule_scope = 'Employee' AND employee_id IS NOT NULL)`,
    ),
  ],
);

export type AttendanceRule = typeof attendanceRules.$inferSelect;
export type NewAttendanceRule = typeof attendanceRules.$inferInsert;

// ─── remote_work_requests (DB-04 §7.8) ────────────────────────────────────────

export const remoteWorkRequests = pgTable(
  "remote_work_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    requestCode: text("request_code"),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employeeProfiles.id, { onDelete: "cascade" }),
    requestType: text("request_type").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    startTime: time("start_time"),
    endTime: time("end_time"),
    attendanceMode: text("attendance_mode").notNull().default("SELF_CHECK_IN"),
    locationText: text("location_text"),
    reason: text("reason").notNull(),
    /** UUID TRẦN — FK logic tới TASK/PROJECT phase sau (KHÔNG hard-FK). */
    taskId: uuid("task_id"),
    projectId: uuid("project_id"),
    status: text("status").notNull().default("Pending"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    currentApproverUserId: uuid("current_approver_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    currentApproverEmployeeId: uuid("current_approver_employee_id").references(
      () => employeeProfiles.id,
      { onDelete: "set null" },
    ),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedBy: uuid("rejected_by").references(() => users.id, { onDelete: "set null" }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    attachmentFileId: uuid("attachment_file_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_remote_requests_company_code_active")
      .on(t.companyId, t.requestCode)
      .where(sql`deleted_at IS NULL AND request_code IS NOT NULL`),
    index("idx_remote_requests_employee_date")
      .on(t.companyId, t.employeeId, t.startDate, t.endDate)
      .where(sql`deleted_at IS NULL`),
    index("idx_remote_requests_status_submitted")
      .on(t.companyId, t.status, t.submittedAt)
      .where(sql`deleted_at IS NULL`),
    index("idx_remote_requests_approver")
      .on(t.companyId, t.currentApproverUserId, t.status)
      .where(sql`deleted_at IS NULL`),
    check("chk_remote_requests_type", sql`request_type IN ('Remote','BusinessTrip','Offsite')`),
    check(
      "chk_remote_requests_mode",
      sql`attendance_mode IN ('SELF_CHECK_IN','AUTO_ATTENDANCE','NO_ATTENDANCE')`,
    ),
    check(
      "chk_remote_requests_status",
      sql`status IN ('Draft','Pending','Approved','Rejected','Cancelled')`,
    ),
    check("chk_remote_requests_date", sql`end_date >= start_date`),
  ],
);

export type RemoteWorkRequest = typeof remoteWorkRequests.$inferSelect;
export type NewRemoteWorkRequest = typeof remoteWorkRequests.$inferInsert;

// ─── attendance_logs (DB-04 §7.5 — APPEND-ONLY) ───────────────────────────────
// attendance_record_id = uuid TRẦN ở Drizzle (tránh import vòng attendance ↔ hr); FK thật ở migration 0452.
// app role GRANT SELECT,INSERT ONLY (BẤT BIẾN #2) — deleted_at/by giữ parity nhưng app KHÔNG sửa được.

export const attendanceLogs = pgTable(
  "attendance_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    /** FK → attendance_records(id) ở migration 0452 (uuid TRẦN tránh import vòng). */
    attendanceRecordId: uuid("attendance_record_id"),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employeeProfiles.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    workDate: date("work_date").notNull(),
    logType: text("log_type").notNull(),
    logTime: timestamp("log_time", { withTimezone: true }).notNull().defaultNow(),
    clientTime: timestamp("client_time", { withTimezone: true }),
    clientTimezone: text("client_timezone"),
    source: text("source").notNull(),
    platform: text("platform"),
    deviceId: text("device_id"),
    deviceName: text("device_name"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    gpsLatitude: numeric("gps_latitude", { precision: 10, scale: 7 }),
    gpsLongitude: numeric("gps_longitude", { precision: 10, scale: 7 }),
    gpsAccuracyMeters: numeric("gps_accuracy_meters", { precision: 10, scale: 2 }),
    locationLabel: text("location_label"),
    isValid: boolean("is_valid").notNull().default(true),
    invalidReason: text("invalid_reason"),
    note: text("note"),
    /** FK → files(id) ở migration 0452 (uuid TRẦN — KHÔNG import files để tránh phụ thuộc thừa). */
    photoFileId: uuid("photo_file_id"),
    rawPayload: jsonb("raw_payload"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("idx_attendance_logs_record_time")
      .on(t.attendanceRecordId, t.logTime)
      .where(sql`deleted_at IS NULL`),
    index("idx_attendance_logs_employee_time")
      .on(t.companyId, t.employeeId, t.logTime)
      .where(sql`deleted_at IS NULL`),
    index("idx_attendance_logs_company_work_date")
      .on(t.companyId, t.workDate, t.source)
      .where(sql`deleted_at IS NULL`),
    index("idx_attendance_logs_invalid")
      .on(t.companyId, t.isValid, t.logTime)
      .where(sql`deleted_at IS NULL AND is_valid = false`),
    check(
      "chk_attendance_logs_type",
      sql`log_type IN ('Check-in','Check-out','Auto','Manual','Adjustment','Device','Import')`,
    ),
    check(
      "chk_attendance_logs_source",
      sql`source IN ('WEB','MOBILE','MANUAL','AUTO','REMOTE','DEVICE','IMPORT','API')`,
    ),
  ],
);

export type AttendanceLog = typeof attendanceLogs.$inferSelect;
export type NewAttendanceLog = typeof attendanceLogs.$inferInsert;

// ─── attendance_adjustment_items (DB-04 §7.7 — APPEND-ONLY ledger) ─────────────
// request_id = uuid TRẦN ở Drizzle (FK → attendance_adjustment_requests ở migration 0452, tránh import vòng).

export const attendanceAdjustmentItems = pgTable(
  "attendance_adjustment_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    /** FK → attendance_adjustment_requests(id) ở migration 0452 (uuid TRẦN tránh import vòng). */
    requestId: uuid("request_id").notNull(),
    fieldName: text("field_name").notNull(),
    oldValue: jsonb("old_value").$type<unknown>(),
    newValue: jsonb("new_value").$type<unknown>().notNull(),
    appliedValue: jsonb("applied_value").$type<unknown>(),
    isApplied: boolean("is_applied").notNull().default(false),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("idx_att_adj_items_request").on(t.requestId),
    index("idx_att_adj_items_field").on(t.companyId, t.fieldName),
  ],
);

export type AttendanceAdjustmentItem = typeof attendanceAdjustmentItems.$inferSelect;
export type NewAttendanceAdjustmentItem = typeof attendanceAdjustmentItems.$inferInsert;

// ─── remote_work_request_approvals (DB-04 §7.9 — APPEND-ONLY) ─────────────────

export const remoteWorkRequestApprovals = pgTable(
  "remote_work_request_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    remoteWorkRequestId: uuid("remote_work_request_id")
      .notNull()
      .references(() => remoteWorkRequests.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull().default(1),
    approverUserId: uuid("approver_user_id").references(() => users.id, { onDelete: "set null" }),
    approverEmployeeId: uuid("approver_employee_id").references(() => employeeProfiles.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    note: text("note"),
    actedAt: timestamp("acted_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata"),
  },
  (t) => [
    index("idx_remote_approvals_request").on(t.remoteWorkRequestId, t.stepOrder, t.actedAt),
    index("idx_remote_approvals_approver").on(t.companyId, t.approverUserId, t.actedAt),
    check(
      "chk_remote_approvals_action",
      sql`action IN ('Submitted','Approved','Rejected','Cancelled')`,
    ),
  ],
);

export type RemoteWorkRequestApproval = typeof remoteWorkRequestApprovals.$inferSelect;
export type NewRemoteWorkRequestApproval = typeof remoteWorkRequestApprovals.$inferInsert;
