import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { teams } from "./org";
import { users } from "./users";

/**
 * G8-4 KPI schema — DDL/RLS/grant ở migrations 0088–0089 (xem TASKS G8-4).
 *
 * BẤT BIẾN #1: company_id NOT NULL DEFAULT current_setting + RLS+FORCE+WITH CHECK ở migration.
 * BẤT BIẾN #2 (append-only): `kpi_results` KHÔNG có updated_at/deleted_at; app role chỉ GRANT
 *   SELECT,INSERT (no UPDATE/DELETE). "Tính lại / xác nhận" = bản snapshot MỚI. `kpi_definitions`
 *   mutable có kiểm soát (soft-delete deleted_at).
 * BR-007: kpi_results.confirmed_by/confirmed_at mặc định NULL = chưa xác nhận = THAM KHẢO.
 *
 * CHECK ở đây PHẢI khớp byte-identical với SQL migration (Drizzle dùng để typecheck/inferType).
 */

// ─── kpi_definitions (mutable: soft-delete) ──────────────────────────────────
export const kpiDefinitions = pgTable(
  "kpi_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /** 5 thành phần: tasksDone/onTimeRate/evaluationScore/defectScore/firstPassApprovalRate, tổng=100. */
    weights: jsonb("weights").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("kpi_definitions_company_idx").on(t.companyId),
    check(
      "kpi_definitions_weights_sum_chk",
      sql`abs(
        (weights->>'tasksDone')::numeric +
        (weights->>'onTimeRate')::numeric +
        (weights->>'evaluationScore')::numeric +
        (weights->>'defectScore')::numeric +
        (weights->>'firstPassApprovalRate')::numeric - 100
      ) < 0.0001`,
    ),
  ],
);
export type KpiDefinition = typeof kpiDefinitions.$inferSelect;
export type NewKpiDefinition = typeof kpiDefinitions.$inferInsert;

// ─── kpi_results (SNAPSHOT APPEND-ONLY) ──────────────────────────────────────
export const kpiResults = pgTable(
  "kpi_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => kpiDefinitions.id, { onDelete: "cascade" }),
    // Chủ thể: user XOR team (CHECK đúng-1). NO ACTION (giữ chủ thể cho audit).
    subjectUserId: uuid("subject_user_id").references(() => users.id),
    subjectTeamId: uuid("subject_team_id").references(() => teams.id),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    tasksDone: numeric("tasks_done", { precision: 6, scale: 2 }).notNull(),
    onTimeRate: numeric("on_time_rate", { precision: 6, scale: 2 }).notNull(),
    evaluationScore: numeric("evaluation_score", { precision: 6, scale: 2 }).notNull(),
    defectScore: numeric("defect_score", { precision: 6, scale: 2 }).notNull(),
    firstPassApprovalRate: numeric("first_pass_approval_rate", {
      precision: 6,
      scale: 2,
    }).notNull(),
    totalScore: numeric("total_score", { precision: 6, scale: 2 }).notNull(),
    // BR-007: NULL = chưa xác nhận = THAM KHẢO. Set qua snapshot mới (confirm:kpi).
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    computedBy: uuid("computed_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("kpi_results_company_idx").on(t.companyId),
    index("kpi_results_company_period_idx").on(t.companyId, t.periodStart, t.periodEnd),
    index("kpi_results_company_subject_user_idx").on(t.companyId, t.subjectUserId),
    index("kpi_results_company_subject_team_idx").on(t.companyId, t.subjectTeamId),
    check(
      "kpi_results_subject_chk",
      sql`(subject_user_id IS NOT NULL AND subject_team_id IS NULL)
        OR (subject_user_id IS NULL AND subject_team_id IS NOT NULL)`,
    ),
    check("kpi_results_period_chk", sql`period_end > period_start`),
    check(
      "kpi_results_score_range_chk",
      sql`tasks_done BETWEEN 0 AND 100 AND on_time_rate BETWEEN 0 AND 100
        AND evaluation_score BETWEEN 0 AND 100 AND defect_score BETWEEN 0 AND 100
        AND first_pass_approval_rate BETWEEN 0 AND 100 AND total_score BETWEEN 0 AND 100`,
    ),
    check(
      "kpi_results_confirmed_pair_chk",
      sql`(confirmed_by IS NULL AND confirmed_at IS NULL)
        OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)`,
    ),
  ],
);
export type KpiResult = typeof kpiResults.$inferSelect;
export type NewKpiResult = typeof kpiResults.$inferInsert;
