import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { users } from "./users";

/**
 * org_units — phòng ban / khối trong công ty. Hỗ trợ cây cha–con (parent_id → self).
 * G5-2: thêm code, description, head_user_id, status + mở rộng type enum.
 * DDL/RLS/grant ở migration 0006 + 0016. Soft-delete: deleted_at.
 */
export const orgUnits = pgTable(
  "org_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    type: text("type").notNull().default("department"),
    code: text("code"),
    description: text("description"),
    headUserId: uuid("head_user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("org_units_company_id_idx").on(t.companyId),
    index("org_units_parent_id_idx").on(t.parentId),
    uniqueIndex("org_units_company_name_active_uq")
      .on(t.companyId, t.name)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("org_units_company_code_active_uq")
      .on(t.companyId, t.code)
      .where(sql`deleted_at IS NULL AND code IS NOT NULL`),
    check(
      "org_units_type_check",
      sql`type IN ('department', 'division', 'unit', 'office', 'branch')`,
    ),
    check("org_units_status_check", sql`status IN ('active', 'inactive')`),
  ],
);

export type OrgUnit = typeof orgUnits.$inferSelect;
export type NewOrgUnit = typeof orgUnits.$inferInsert;

/**
 * teams — ekip/nhóm sản xuất. G5-3: thêm code, type, leader, description, capacity, status.
 * DDL/RLS/grant ở migration 0006 + 0016. Soft-delete: deleted_at.
 */
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    orgUnitId: uuid("org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    code: text("code"),
    type: text("type").notNull().default("production_team"),
    leaderUserId: uuid("leader_user_id").references(() => users.id, { onDelete: "set null" }),
    description: text("description"),
    capacity: integer("capacity"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("teams_company_id_idx").on(t.companyId),
    index("teams_org_unit_id_idx").on(t.orgUnitId),
    uniqueIndex("teams_company_name_active_uq")
      .on(t.companyId, t.name)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("teams_company_code_active_uq")
      .on(t.companyId, t.code)
      .where(sql`deleted_at IS NULL AND code IS NOT NULL`),
    check(
      "teams_type_check",
      sql`type IN ('production_team','script_team','editor_team','thumbnail_team','seo_team','qa_team','project_team','office_team')`,
    ),
    check("teams_status_check", sql`status IN ('active', 'inactive')`),
  ],
);

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;

/**
 * team_members — 1 user có thể thuộc nhiều team, mỗi membership có role riêng.
 * Soft-delete: deleted_at (không hard-delete — bất biến #2).
 */
export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleName: text("role_name").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("team_members_company_id_idx").on(t.companyId),
    index("team_members_team_id_idx").on(t.teamId),
    index("team_members_user_id_idx").on(t.userId),
    uniqueIndex("team_members_team_user_active_uq")
      .on(t.teamId, t.userId)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
