import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { users } from "./users";
import { channels, contentItems, platforms, projects } from "./media";
import { orgUnits, teams } from "./org";
import { tasks } from "./workflow";

/**
 * G13 Finance schema — DDL/RLS/grant ở migrations 0070–0073 (xem plan §4.6).
 *
 * BẤT BIẾN #2 (append-only): `revenue_records` · `cost_records` · `profit_snapshots` · `expense_approvals`
 * KHÔNG có `updated_at`/`deleted_at` và app role chỉ GRANT SELECT,INSERT (không UPDATE/DELETE). "Sửa/xoá"
 * revenue/cost = ghi bản ghi mới (`entry_kind` adjustment|void + `replaces_record_id`).
 * `cost_allocations`/`expense_requests` mutable có kiểm soát (GRANT thêm UPDATE; allocation soft-delete khi
 * re-allocate; expense cập nhật status) — KHÔNG DELETE.
 *
 * Các CHECK/enum ở đây PHẢI khớp byte-identical với SQL migration (Drizzle dùng để typecheck/inferType, DDL
 * thật là raw SQL ở migrations).
 */

const FINANCE_ENTRY_KINDS = "'original','adjustment','void'";
const COST_TYPES =
  "'salary','freelancer','software','equipment','ads','production','training','recruitment','operation','other'";

// ─── revenue_records (append-only) ───────────────────────────────────────────
export const revenueRecords = pgTable(
  "revenue_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    platformId: uuid("platform_id").references(() => platforms.id, { onDelete: "set null" }),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    contentItemId: uuid("content_item_id").references(() => contentItems.id, {
      onDelete: "set null",
    }),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("VND"),
    revenueDate: date("revenue_date").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    source: text("source").notNull(),
    description: text("description"),
    attachmentUrl: text("attachment_url"),
    // NOT NULL → NO ACTION (users soft-delete, không hard-delete; giữ tác giả bản ghi cho audit).
    enteredBy: uuid("entered_by")
      .notNull()
      .references(() => users.id),
    entryKind: text("entry_kind").notNull().default("original"),
    replacesRecordId: uuid("replaces_record_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("revenue_records_company_date_idx").on(t.companyId, t.revenueDate),
    index("revenue_records_company_channel_idx").on(t.companyId, t.channelId),
    index("revenue_records_company_project_idx").on(t.companyId, t.projectId),
    index("revenue_records_company_content_idx").on(t.companyId, t.contentItemId),
    // Mỗi bản ghi chỉ bị thay thế ĐÚNG 1 lần (chặn race double-adjust ở DB).
    uniqueIndex("revenue_records_replaces_uq")
      .on(t.replacesRecordId)
      .where(sql`replaces_record_id IS NOT NULL`),
    check("revenue_records_source_check", sql`source IN
      ('youtube_adsense','tiktok','facebook','sponsorship','affiliate','manual','other')`),
    check("revenue_records_entry_kind_check", sql`entry_kind IN (${sql.raw(FINANCE_ENTRY_KINDS)})`),
    // original ⟺ replaces NULL; adjustment/void ⟺ replaces NOT NULL.
    check(
      "revenue_records_chain_check",
      sql`(entry_kind = 'original' AND replaces_record_id IS NULL)
        OR (entry_kind IN ('adjustment','void') AND replaces_record_id IS NOT NULL)`,
    ),
  ],
);
export type RevenueRecord = typeof revenueRecords.$inferSelect;
export type NewRevenueRecord = typeof revenueRecords.$inferInsert;

// ─── cost_records (append-only) ──────────────────────────────────────────────
export const costRecords = pgTable(
  "cost_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    costType: text("cost_type").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("VND"),
    costDate: date("cost_date").notNull(),
    orgUnitId: uuid("org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
    contentItemId: uuid("content_item_id").references(() => contentItems.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    vendorName: text("vendor_name"),
    description: text("description"),
    attachmentUrl: text("attachment_url"),
    enteredBy: uuid("entered_by")
      .notNull()
      .references(() => users.id),
    entryKind: text("entry_kind").notNull().default("original"),
    replacesRecordId: uuid("replaces_record_id"),
    // Lineage: cost sinh từ duyệt expense (ALTER ADD ở 0073). FK xác lập sau khi expense_requests tồn tại.
    expenseRequestId: uuid("expense_request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cost_records_company_date_idx").on(t.companyId, t.costDate),
    index("cost_records_company_type_idx").on(t.companyId, t.costType),
    index("cost_records_company_channel_idx").on(t.companyId, t.channelId),
    index("cost_records_company_project_idx").on(t.companyId, t.projectId),
    index("cost_records_company_content_idx").on(t.companyId, t.contentItemId),
    index("cost_records_company_org_idx").on(t.companyId, t.orgUnitId),
    index("cost_records_company_team_idx").on(t.companyId, t.teamId),
    uniqueIndex("cost_records_replaces_uq")
      .on(t.replacesRecordId)
      .where(sql`replaces_record_id IS NOT NULL`),
    check("cost_records_cost_type_check", sql`cost_type IN (${sql.raw(COST_TYPES)})`),
    check("cost_records_entry_kind_check", sql`entry_kind IN (${sql.raw(FINANCE_ENTRY_KINDS)})`),
    check(
      "cost_records_chain_check",
      sql`(entry_kind = 'original' AND replaces_record_id IS NULL)
        OR (entry_kind IN ('adjustment','void') AND replaces_record_id IS NOT NULL)`,
    ),
  ],
);
export type CostRecord = typeof costRecords.$inferSelect;
export type NewCostRecord = typeof costRecords.$inferInsert;

// ─── cost_allocations (mutable có kiểm soát: SELECT,INSERT,UPDATE — soft-delete) ──
export const costAllocations = pgTable(
  "cost_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    costRecordId: uuid("cost_record_id")
      .notNull()
      .references(() => costRecords.id, { onDelete: "cascade" }),
    allocationRunId: uuid("allocation_run_id").notNull(),
    allocationTargetType: text("allocation_target_type").notNull(),
    // Polymorphic — KHÔNG FK (target thuộc nhiều bảng); service validate tồn tại trong tenant.
    allocationTargetId: uuid("allocation_target_id").notNull(),
    allocationMethod: text("allocation_method").notNull(),
    allocatedAmount: numeric("allocated_amount", { precision: 18, scale: 2 }).notNull(),
    allocationPercent: numeric("allocation_percent", { precision: 7, scale: 4 }),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("cost_allocations_company_cost_idx").on(t.companyId, t.costRecordId),
    index("cost_allocations_company_run_idx").on(t.companyId, t.allocationRunId),
    index("cost_allocations_company_target_idx").on(
      t.companyId,
      t.allocationTargetType,
      t.allocationTargetId,
    ),
    uniqueIndex("cost_allocations_active_uq")
      .on(t.costRecordId, t.allocationTargetType, t.allocationTargetId)
      .where(sql`deleted_at IS NULL`),
    check(
      "cost_allocations_target_type_check",
      sql`allocation_target_type IN ('channel','project','content_item','team','org_unit','employee')`,
    ),
    check(
      "cost_allocations_method_check",
      sql`allocation_method IN
        ('equal_split','manual_percent','by_video_count','by_task_count','by_work_hours','by_revenue_ratio')`,
    ),
  ],
);
export type CostAllocation = typeof costAllocations.$inferSelect;
export type NewCostAllocation = typeof costAllocations.$inferInsert;

// ─── profit_snapshots (append-only) ──────────────────────────────────────────
export const profitSnapshots = pgTable(
  "profit_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    totalRevenue: numeric("total_revenue", { precision: 18, scale: 2 }).notNull(),
    totalDirectCost: numeric("total_direct_cost", { precision: 18, scale: 2 }).notNull(),
    totalAllocatedCost: numeric("total_allocated_cost", { precision: 18, scale: 2 }).notNull(),
    totalCost: numeric("total_cost", { precision: 18, scale: 2 }).notNull(),
    profit: numeric("profit", { precision: 18, scale: 2 }).notNull(),
    profitMargin: numeric("profit_margin", { precision: 9, scale: 4 }),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("profit_snapshots_company_target_idx").on(
      t.companyId,
      t.targetType,
      t.targetId,
      t.calculatedAt,
    ),
    index("profit_snapshots_company_period_idx").on(t.companyId, t.periodStart, t.periodEnd),
    check(
      "profit_snapshots_target_type_check",
      sql`target_type IN ('company','platform','channel','project','content_item','org_unit','team')`,
    ),
    // company scope ⇒ target_id NULL; scope con ⇒ target_id NOT NULL.
    check(
      "profit_snapshots_target_id_check",
      sql`(target_type = 'company' AND target_id IS NULL)
        OR (target_type <> 'company' AND target_id IS NOT NULL)`,
    ),
  ],
);
export type ProfitSnapshot = typeof profitSnapshots.$inferSelect;
export type NewProfitSnapshot = typeof profitSnapshots.$inferInsert;

// ─── expense_requests (mutable: SELECT,INSERT,UPDATE — no DELETE) ─────────────
export const expenseRequests = pgTable(
  "expense_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    orgUnitId: uuid("org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("VND"),
    expenseType: text("expense_type").notNull(),
    neededAt: date("needed_at"),
    status: text("status").notNull().default("pending"),
    currentApprovalLevel: integer("current_approval_level").notNull().default(1),
    attachmentUrl: text("attachment_url"),
    // Task duyệt trong Task Hub (task_type='finance') — tạo cùng tx tạo request (bất biến #4).
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    // Cost record sinh ra sau duyệt (lineage). FK cost_records xác lập ở 0073.
    costRecordId: uuid("cost_record_id").references(() => costRecords.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("expense_requests_company_status_idx").on(t.companyId, t.status),
    index("expense_requests_company_requester_idx").on(t.companyId, t.requestedBy),
    index("expense_requests_task_idx").on(t.taskId),
    check("expense_requests_status_check", sql`status IN ('pending','approved','rejected','cancelled')`),
    check("expense_requests_expense_type_check", sql`expense_type IN (${sql.raw(COST_TYPES)})`),
  ],
);
export type ExpenseRequest = typeof expenseRequests.$inferSelect;
export type NewExpenseRequest = typeof expenseRequests.$inferInsert;

// ─── expense_approvals (log quyết định — append-only: SELECT,INSERT) ──────────
export const expenseApprovals = pgTable(
  "expense_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    expenseRequestId: uuid("expense_request_id")
      .notNull()
      .references(() => expenseRequests.id, { onDelete: "cascade" }),
    approvalLevel: integer("approval_level").notNull().default(1),
    approverUserId: uuid("approver_user_id")
      .notNull()
      .references(() => users.id),
    decision: text("decision").notNull(),
    comment: text("comment"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("expense_approvals_company_request_idx").on(t.companyId, t.expenseRequestId),
    // Chặn double-decision cùng cấp ở DB.
    uniqueIndex("expense_approvals_request_level_uq").on(t.expenseRequestId, t.approvalLevel),
    check("expense_approvals_decision_check", sql`decision IN ('approved','rejected')`),
  ],
);
export type ExpenseApproval = typeof expenseApprovals.$inferSelect;
export type NewExpenseApproval = typeof expenseApprovals.$inferInsert;
