import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { orgUnits } from "./org";
import { roles } from "./permissions";

/**
 * positions — chức vụ trong công ty. Có thể gắn với org_unit và role mặc định.
 * default_role_id: khi tạo employee với chức vụ này, tự động gán role đó (Service lo).
 * DDL/RLS/grant ở migration 0017. Soft-delete: deleted_at.
 */
export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    orgUnitId: uuid("org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    code: text("code"),
    level: integer("level"),
    description: text("description"),
    defaultRoleId: uuid("default_role_id").references(() => roles.id, { onDelete: "set null" }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("positions_company_id_idx").on(t.companyId),
    index("positions_org_unit_id_idx").on(t.orgUnitId),
    uniqueIndex("positions_company_name_active_uq")
      .on(t.companyId, t.name)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("positions_company_code_active_uq")
      .on(t.companyId, t.code)
      .where(sql`deleted_at IS NULL AND code IS NOT NULL`),
    check("positions_status_check", sql`status IN ('active','inactive')`),
  ],
);

export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;
