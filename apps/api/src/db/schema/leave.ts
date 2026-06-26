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
import { contractTypes, jobLevels } from "./hr-master";
import { employeeProfiles } from "./employees";
import { publicHolidays } from "./holidays";
import { orgUnits } from "./org";
import { positions } from "./positions";
import { shifts } from "./attendance";
import { users } from "./users";

/**
 * LEAVE Core (DB-05 §7) — 4 bảng MỚI. DDL/RLS+FORCE/policy tenant_isolation/grant ở migration 0453.
 *
 * BẢN ĐỒ TÊN DB-05 → QUAN HỆ THẬT (KHÔNG có bảng `employees`/`departments`):
 *   employee_id → employee_profiles(id) · department_id → org_units(id).
 *
 * BẤT BIẾN #2 (append-only): leave_balance_transactions + leave_request_approvals = ledger/history append —
 *   app role GRANT SELECT,INSERT ONLY (migration 0453). KHÔNG UPDATE/DELETE, KHÔNG soft-delete.
 *
 * GHI CHÚ FK cross-file: FK → leave_types/leave_requests/leave_balances/attendance_records (sống ở ./hr) dùng
 *   cột uuid TRẦN (KHÔNG .references()) để tránh import vòng leave ↔ hr. FK thật vẫn được migration 0453 ép.
 */

// ─── leave_policies (DB-05 §7.2) ──────────────────────────────────────────────

export const leavePolicies = pgTable(
  "leave_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    /** FK → leave_types(id) ở migration 0453 (uuid TRẦN tránh import vòng leave ↔ hr). */
    leaveTypeId: uuid("leave_type_id").notNull(),
    policyCode: text("policy_code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    policyScope: text("policy_scope").notNull(),
    departmentId: uuid("department_id").references(() => orgUnits.id, { onDelete: "set null" }),
    employeeId: uuid("employee_id").references(() => employeeProfiles.id, { onDelete: "set null" }),
    jobLevelId: uuid("job_level_id").references(() => jobLevels.id, { onDelete: "set null" }),
    contractTypeId: uuid("contract_type_id").references(() => contractTypes.id, {
      onDelete: "set null",
    }),
    yearlyQuotaDays: numeric("yearly_quota_days", { precision: 8, scale: 2 }),
    yearlyQuotaHours: numeric("yearly_quota_hours", { precision: 8, scale: 2 }),
    accrualMethod: text("accrual_method").notNull().default("None"),
    accrualDayOfMonth: integer("accrual_day_of_month"),
    prorateOnJoinDate: boolean("prorate_on_join_date").notNull().default(false),
    includeWeekends: boolean("include_weekends").notNull().default(false),
    includePublicHolidays: boolean("include_public_holidays").notNull().default(false),
    reserveBalanceOnPending: boolean("reserve_balance_on_pending").notNull().default(true),
    allowNegativeBalance: boolean("allow_negative_balance").notNull().default(false),
    maxNegativeDays: numeric("max_negative_days", { precision: 8, scale: 2 }),
    allowCancelAfterApproved: boolean("allow_cancel_after_approved").notNull().default(true),
    cancelBeforeDays: integer("cancel_before_days"),
    requiresManagerApproval: boolean("requires_manager_approval").notNull().default(true),
    requiresHrApproval: boolean("requires_hr_approval").notNull().default(false),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    priority: integer("priority").notNull().default(0),
    status: text("status").notNull().default("Active"),
    policyConfig: jsonb("policy_config"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_leave_policies_company_code_active")
      .on(t.companyId, t.policyCode)
      .where(sql`deleted_at IS NULL`),
    index("idx_leave_policies_lookup")
      .on(t.companyId, t.leaveTypeId, t.policyScope, t.status, t.effectiveFrom, t.effectiveTo)
      .where(sql`deleted_at IS NULL`),
    index("idx_leave_policies_department")
      .on(t.companyId, t.departmentId, t.leaveTypeId, t.status)
      .where(sql`deleted_at IS NULL`),
    index("idx_leave_policies_employee")
      .on(t.companyId, t.employeeId, t.leaveTypeId, t.status)
      .where(sql`deleted_at IS NULL`),
    check(
      "chk_leave_policies_scope",
      sql`policy_scope IN ('Company','Department','Employee','JobLevel','ContractType')`,
    ),
    check("chk_leave_policies_status", sql`status IN ('Active','Inactive')`),
    check(
      "chk_leave_policies_accrual_method",
      sql`accrual_method IN ('None','Monthly','Yearly','Manual','Prorated')`,
    ),
    check(
      "chk_leave_policies_effective_date",
      sql`effective_to IS NULL OR effective_to >= effective_from`,
    ),
  ],
);

export type LeavePolicy = typeof leavePolicies.$inferSelect;
export type NewLeavePolicy = typeof leavePolicies.$inferInsert;

// ─── leave_balance_transactions (DB-05 §7.4 — LEDGER APPEND-ONLY, no soft-delete) ─────────────

export const leaveBalanceTransactions = pgTable(
  "leave_balance_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    /** FK → leave_balances(id) / leave_types(id) / leave_requests(id) ở migration 0453 (uuid TRẦN tránh vòng). */
    leaveBalanceId: uuid("leave_balance_id").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employeeProfiles.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id").notNull(),
    leaveRequestId: uuid("leave_request_id"),
    transactionType: text("transaction_type").notNull(),
    transactionDate: date("transaction_date").notNull(),
    amountDays: numeric("amount_days", { precision: 8, scale: 2 }).notNull().default("0"),
    amountHours: numeric("amount_hours", { precision: 8, scale: 2 }).notNull().default("0"),
    balanceBeforeDays: numeric("balance_before_days", { precision: 8, scale: 2 }),
    balanceAfterDays: numeric("balance_after_days", { precision: 8, scale: 2 }),
    balanceBeforeHours: numeric("balance_before_hours", { precision: 8, scale: 2 }),
    balanceAfterHours: numeric("balance_after_hours", { precision: 8, scale: 2 }),
    reason: text("reason"),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    createdByType: text("created_by_type").notNull().default("User"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("idx_leave_balance_tx_balance_date").on(
      t.companyId,
      t.leaveBalanceId,
      t.transactionDate,
      t.createdAt,
    ),
    index("idx_leave_balance_tx_employee_date").on(t.companyId, t.employeeId, t.transactionDate),
    index("idx_leave_balance_tx_request")
      .on(t.companyId, t.leaveRequestId)
      .where(sql`leave_request_id IS NOT NULL`),
    index("idx_leave_balance_tx_type_date").on(t.companyId, t.transactionType, t.transactionDate),
    check(
      "chk_leave_balance_transactions_type",
      sql`transaction_type IN ('OPENING','GRANT','ACCRUAL','RESERVE','RELEASE','USE','REFUND','ADJUSTMENT','EXPIRE','CARRY_OVER','IMPORT','SYSTEM_RECALCULATE')`,
    ),
    check(
      "chk_leave_balance_transactions_created_by_type",
      sql`created_by_type IN ('User','System','Job')`,
    ),
  ],
);

export type LeaveBalanceTransaction = typeof leaveBalanceTransactions.$inferSelect;
export type NewLeaveBalanceTransaction = typeof leaveBalanceTransactions.$inferInsert;

// ─── leave_request_days (DB-05 §7.6 — chi tiết từng ngày nghỉ, soft-delete) ───────────────────

export const leaveRequestDays = pgTable(
  "leave_request_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    /** FK → leave_requests(id) / leave_types(id) / attendance_records(id) ở migration 0453 (uuid TRẦN tránh vòng). */
    leaveRequestId: uuid("leave_request_id").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employeeProfiles.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id").notNull(),
    workDate: date("work_date").notNull(),
    dayType: text("day_type").notNull(),
    halfDaySession: text("half_day_session"),
    startTime: time("start_time"),
    endTime: time("end_time"),
    leaveDays: numeric("leave_days", { precision: 8, scale: 2 }).notNull().default("0"),
    leaveHours: numeric("leave_hours", { precision: 8, scale: 2 }).notNull().default("0"),
    requiredWorkingMinutesBefore: integer("required_working_minutes_before"),
    leaveMinutes: integer("leave_minutes").notNull().default(0),
    requiredWorkingMinutesAfter: integer("required_working_minutes_after"),
    isWorkingDay: boolean("is_working_day").notNull().default(true),
    isPublicHoliday: boolean("is_public_holiday").notNull().default(false),
    publicHolidayId: uuid("public_holiday_id").references(() => publicHolidays.id, {
      onDelete: "set null",
    }),
    shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),
    attendanceRecordId: uuid("attendance_record_id"),
    attendanceSyncStatus: text("attendance_sync_status").notNull().default("Not Required"),
    attendanceSyncedAt: timestamp("attendance_synced_at", { withTimezone: true }),
    attendanceSyncError: text("attendance_sync_error"),
    status: text("status").notNull().default("Active"),
    calculationSnapshot: jsonb("calculation_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_leave_request_days_request_date_session")
      .on(t.companyId, t.leaveRequestId, t.workDate, sql`COALESCE(half_day_session, 'NONE')`)
      .where(sql`deleted_at IS NULL`),
    index("idx_leave_request_days_employee_date")
      .on(t.companyId, t.employeeId, t.workDate)
      .where(sql`deleted_at IS NULL`),
    index("idx_leave_request_days_calendar")
      .on(t.companyId, t.workDate, t.status, t.leaveTypeId)
      .where(sql`deleted_at IS NULL`),
    index("idx_leave_request_days_sync_status")
      .on(t.companyId, t.attendanceSyncStatus, t.workDate)
      .where(sql`deleted_at IS NULL`),
    index("idx_leave_request_days_attendance_record")
      .on(t.companyId, t.attendanceRecordId)
      .where(sql`attendance_record_id IS NOT NULL`),
    check(
      "chk_leave_request_days_day_type",
      sql`day_type IN ('Full Day','Half Day','Hourly','Non Working Day','Public Holiday')`,
    ),
    check(
      "chk_leave_request_days_half_session",
      sql`half_day_session IS NULL OR half_day_session IN ('Morning','Afternoon')`,
    ),
    check("chk_leave_request_days_status", sql`status IN ('Active','Cancelled','Revoked')`),
    check(
      "chk_leave_request_days_sync_status",
      sql`attendance_sync_status IN ('Not Required','Pending','Synced','Failed','Reverted','Pending Revert')`,
    ),
    check(
      "chk_leave_request_days_amount",
      sql`leave_days >= 0 AND leave_hours >= 0 AND leave_minutes >= 0`,
    ),
    check(
      "chk_leave_request_days_hourly_time",
      sql`day_type <> 'Hourly' OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)`,
    ),
  ],
);

export type LeaveRequestDay = typeof leaveRequestDays.$inferSelect;
export type NewLeaveRequestDay = typeof leaveRequestDays.$inferInsert;

// ─── leave_request_approvals (DB-05 §7.7 — HISTORY APPEND-ONLY, no soft-delete) ───────────────

export const leaveRequestApprovals = pgTable(
  "leave_request_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    /** FK → leave_requests(id) ở migration 0453 (uuid TRẦN tránh import vòng leave ↔ hr). */
    leaveRequestId: uuid("leave_request_id").notNull(),
    approvalStep: integer("approval_step").notNull().default(1),
    approverUserId: uuid("approver_user_id").references(() => users.id, { onDelete: "set null" }),
    approverEmployeeId: uuid("approver_employee_id").references(() => employeeProfiles.id, {
      onDelete: "set null",
    }),
    approverRoleCode: text("approver_role_code"),
    action: text("action").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    comment: text("comment"),
    rejectionReason: text("rejection_reason"),
    cancelReason: text("cancel_reason"),
    actedAt: timestamp("acted_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_leave_approvals_request").on(t.companyId, t.leaveRequestId, t.actedAt),
    index("idx_leave_approvals_approver")
      .on(t.companyId, t.approverUserId, t.actedAt)
      .where(sql`approver_user_id IS NOT NULL`),
    index("idx_leave_approvals_action_date").on(t.companyId, t.action, t.actedAt),
    check(
      "chk_leave_request_approvals_action",
      sql`action IN ('SUBMIT','APPROVE','REJECT','CANCEL','REVOKE','COMMENT')`,
    ),
  ],
);

export type LeaveRequestApproval = typeof leaveRequestApprovals.$inferSelect;
export type NewLeaveRequestApproval = typeof leaveRequestApprovals.$inferInsert;
