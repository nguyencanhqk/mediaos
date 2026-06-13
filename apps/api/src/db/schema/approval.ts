import { check, index, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { users } from "./users";
import { workflowSteps } from "./workflow";

/**
 * approval_rules — G8-1 (APR-001/002). Multi-level approval config for a workflow step.
 *
 * One row per (workflow_step, level): which user approves at that level. approval_requests stays the
 * SOURCE OF TRUTH for live state (current_level/max_level — ADR-0016); these rules only describe WHO
 * may decide at each level. company_id NOT NULL + RLS + FORCE + WITH CHECK (BẤT BIẾN #1).
 *
 * NOTE: approval_requests + approval_steps already exist (migration 0008 / schema/workflow.ts). G8-1
 * adds ONLY this rules table in band 0080s; it does not redefine the existing approval tables.
 */
export const approvalRules = pgTable(
  "approval_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowStepId: uuid("workflow_step_id")
      .notNull()
      .references(() => workflowSteps.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    /** Resolved approver for this level. */
    approverUserId: uuid("approver_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("approval_rules_company_id_idx").on(t.companyId),
    index("approval_rules_step_level_idx").on(t.workflowStepId, t.level),
    check("approval_rules_level_check", sql`level >= 1`),
  ],
);

export type ApprovalRule = typeof approvalRules.$inferSelect;
export type NewApprovalRule = typeof approvalRules.$inferInsert;

// NOTE: approval_requests / approval_steps are defined in ./workflow (migration 0008). Import them
// from "./workflow" directly — do NOT re-export here to avoid a duplicate symbol in the barrel.
