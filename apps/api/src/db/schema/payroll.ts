import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  jsonb,
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

/**
 * salary_profiles — hồ sơ lương nhân sự (G12-1, CROWN JEWEL).
 *
 * ⚠️ LƯƠNG LÀ DỮ LIỆU NHẠY CẢM (ADR-0010, BẤT BIẾN #3):
 *  - base_salary + allowances là trường nhạy cảm: Service PHẢI mask theo quyền
 *    (view-salary-profile, is_sensitive=TRUE) trước khi trả DTO. KHÔNG kế thừa qua wildcard *:*.
 *  - Mọi sửa lương ghi audit_logs (object_type='salary_profile') TRONG cùng tx (reveal⟹audit atomic).
 *  - KHÔNG secret plaintext, KHÔNG log lương, KHÔNG vào DTO của role không quyền.
 *
 * DDL/RLS/grant ở migration 0091. Soft-delete: deleted_at (KHÔNG hard-delete — BẤT BIẾN #2 spirit,
 * GRANT cho mediaos_app CHỈ SELECT/INSERT/UPDATE). Partial-unique: 1 active profile / (company, user).
 * effective_date có sẵn cho lịch sử lương G12-2 (KHÔNG over-engineer ở G12-1 — YAGNI).
 */
export const salaryProfiles = pgTable(
  "salary_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    salaryType: text("salary_type").notNull().default("monthly"),
    payCycle: text("pay_cycle").notNull().default("monthly"),
    effectiveDate: date("effective_date").notNull(),
    baseSalary: numeric("base_salary", { precision: 18, scale: 2 }).notNull(),
    allowances: jsonb("allowances")
      .notNull()
      .default(sql`'[]'::jsonb`),
    currency: text("currency").notNull().default("VND"),
    status: text("status").notNull().default("active"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("salary_profiles_company_id_idx").on(t.companyId),
    // Composite (company_id, user_id) — phải khớp migration 0091 (company_id leading cho lookup tenant-scoped).
    index("salary_profiles_user_id_idx").on(t.companyId, t.userId),
    // 1 hồ sơ lương ACTIVE / (company, user) khi chưa xoá mềm.
    uniqueIndex("salary_profiles_company_user_active_uq")
      .on(t.companyId, t.userId)
      .where(sql`deleted_at IS NULL AND status = 'active'`),
    check("salary_profile_type_check", sql`salary_type IN ('monthly','hourly','project')`),
    check("salary_profile_pay_cycle_check", sql`pay_cycle IN ('monthly','biweekly','weekly')`),
    check("salary_profile_status_check", sql`status IN ('active','inactive')`),
    check("salary_profile_base_positive_check", sql`base_salary > 0`),
  ],
);

export type SalaryProfile = typeof salaryProfiles.$inferSelect;
export type NewSalaryProfile = typeof salaryProfiles.$inferInsert;
