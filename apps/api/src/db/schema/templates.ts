import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";

/**
 * G16-3 template clone — bộ MẪU (workflow + role + dashboard) để provision công ty mới.
 * DDL/RLS/grant/seed ở migration 0232. Done-criterion: "clone template được cho công ty khác."
 *
 * - workspace_templates: CATALOG TOÀN CỤC (KHÔNG company_id, KHÔNG RLS — mirror permissions/plans).
 *   `blueprint_json` = tài liệu mô tả roles + workflows + dashboards; TemplateCloneService đọc rồi GHI
 *   per-company rows (roles/role_permissions/workflow_definitions/dashboard_configs) trong 1 tx withTenant.
 *   Lưu blueprint dạng document (KHÔNG ref công ty nguồn) ⇒ template self-contained, portable (SaaS).
 * - dashboard_configs: PER-COMPANY (company_id NOT NULL + FORCE RLS) — nhận dashboard clone theo role.
 */

/** Bộ mẫu provision. is_system=true = starter dựng sẵn (seed 0232). Catalog toàn cục. */
export const workspaceTemplates = pgTable(
  "workspace_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // Blueprint: { roles:[{code,name,permissions:[{action,resourceType}]}],
    //             workflows:[{code,name,appliesTo,maxApprovalLevel,allowParallelSteps,steps:[…],transitions:[…]}],
    //             dashboards:[{roleCode,layout:{…}}] } — validate qua templateBlueprintSchema (Zod) lúc clone.
    blueprintJson: jsonb("blueprint_json").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("workspace_templates_code_uq").on(t.code)],
);
export type WorkspaceTemplate = typeof workspaceTemplates.$inferSelect;

/** Cấu hình dashboard per-role per-company (mỗi role 1 dashboard). RLS company_id. */
export const dashboardConfigs = pgTable(
  "dashboard_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    // role theo CODE (soft-ref như workflow steps) — clone KHÔNG cần remap role-id.
    roleCode: text("role_code").notNull(),
    layoutJson: jsonb("layout_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("dashboard_configs_company_idx").on(t.companyId),
    // 1 dashboard active/role/công ty (partial unique trên non-deleted) — parity với migration 0232.
    uniqueIndex("dashboard_configs_company_role_active_uq")
      .on(t.companyId, t.roleCode)
      .where(sql`deleted_at IS NULL`),
  ],
);
export type DashboardConfig = typeof dashboardConfigs.$inferSelect;
