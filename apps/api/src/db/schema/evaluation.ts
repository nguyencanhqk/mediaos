import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import { workflowSteps } from "./workflow";

/**
 * G8-3 Evaluation schema — DDL/RLS/grant ở migrations 0083–0085 (xem TASKS G8-3).
 *
 * BẤT BIẾN #1: company_id NOT NULL DEFAULT current_setting + RLS+FORCE+WITH CHECK ở migration.
 * BẤT BIẾN #2 (append-only): `evaluation_results` + `evaluation_scores` KHÔNG có updated_at/deleted_at,
 *   app role chỉ GRANT SELECT,INSERT (no UPDATE/DELETE). "Chấm lại" = bản ghi mới. uq(result,criteria)
 *   chống chấm trùng. `evaluation_templates`/`evaluation_criteria` mutable có kiểm soát (soft-delete).
 *
 * CHECK ở đây PHẢI khớp byte-identical với SQL migration (Drizzle dùng để typecheck/inferType).
 */

// ─── evaluation_templates (mutable: soft-delete) ─────────────────────────────
export const evaluationTemplates = pgTable(
  "evaluation_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    workflowStepCode: text("workflow_step_code"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("evaluation_templates_company_idx").on(t.companyId)],
);
export type EvaluationTemplate = typeof evaluationTemplates.$inferSelect;
export type NewEvaluationTemplate = typeof evaluationTemplates.$inferInsert;

// ─── evaluation_criteria (mutable: soft-delete) ──────────────────────────────
export const evaluationCriteria = pgTable(
  "evaluation_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => evaluationTemplates.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    weight: numeric("weight", { precision: 6, scale: 2 }).notNull(),
    minScore: numeric("min_score", { precision: 8, scale: 2 }).notNull().default("0"),
    maxScore: numeric("max_score", { precision: 8, scale: 2 }).notNull().default("10"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("evaluation_criteria_company_idx").on(t.companyId),
    index("evaluation_criteria_template_idx").on(t.companyId, t.templateId),
    check("evaluation_criteria_weight_check", sql`weight > 0 AND weight <= 100`),
    check("evaluation_criteria_score_range_check", sql`max_score > min_score`),
  ],
);
export type EvaluationCriterion = typeof evaluationCriteria.$inferSelect;
export type NewEvaluationCriterion = typeof evaluationCriteria.$inferInsert;

// ─── evaluation_results (APPEND-ONLY) ────────────────────────────────────────
export const evaluationResults = pgTable(
  "evaluation_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => evaluationTemplates.id, { onDelete: "cascade" }),
    workflowStepId: uuid("workflow_step_id")
      .notNull()
      .references(() => workflowSteps.id, { onDelete: "cascade" }),
    // NOT NULL → NO ACTION (giữ chủ thể/tác giả cho audit; users soft-delete).
    subjectUserId: uuid("subject_user_id").references(() => users.id),
    evaluatorUserId: uuid("evaluator_user_id")
      .notNull()
      .references(() => users.id),
    totalScore: numeric("total_score", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("evaluation_results_company_idx").on(t.companyId),
    index("evaluation_results_company_step_idx").on(t.companyId, t.workflowStepId),
    index("evaluation_results_company_template_idx").on(t.companyId, t.templateId),
  ],
);
export type EvaluationResult = typeof evaluationResults.$inferSelect;
export type NewEvaluationResult = typeof evaluationResults.$inferInsert;

// ─── evaluation_scores (APPEND-ONLY) ─────────────────────────────────────────
export const evaluationScores = pgTable(
  "evaluation_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    resultId: uuid("result_id")
      .notNull()
      .references(() => evaluationResults.id, { onDelete: "cascade" }),
    criteriaId: uuid("criteria_id")
      .notNull()
      .references(() => evaluationCriteria.id, { onDelete: "cascade" }),
    score: numeric("score", { precision: 8, scale: 2 }).notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("evaluation_scores_company_idx").on(t.companyId),
    index("evaluation_scores_result_idx").on(t.companyId, t.resultId),
    // idempotent/append-only: 1 điểm cho mỗi (result, criteria).
    uniqueIndex("evaluation_scores_result_criteria_uq").on(t.resultId, t.criteriaId),
  ],
);
export type EvaluationScore = typeof evaluationScores.$inferSelect;
export type NewEvaluationScore = typeof evaluationScores.$inferInsert;
