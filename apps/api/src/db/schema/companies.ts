import { check, date, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * companies — gốc tenant (ERD §6). DDL/RLS thật ở migration 0002 (hand-written); schema này CHỈ để
 * gõ kiểu cho query. `slug` ở DB là citext (case-insensitive, unique toàn cục khi chưa xoá mềm).
 * G5-1: thêm cột settings — DDL ở migration 0015.
 * S2-FND-DB-1 (mig 0467): mediaos_app CHỈ SELECT/INSERT/UPDATE — DELETE đã REVOKE (BẤT BIẾN #2, không
 *   hard-delete tenant gốc). Xoá công ty = soft-delete qua UPDATE `deletedAt`; KHÔNG bao giờ `.delete(companies)`.
 * Giữ ĐỒNG BỘ với 0002/0015 khi đổi cột.
 */
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").notNull().default("active"),
    logoUrl: text("logo_url"),
    timezone: text("timezone").notNull().default("Asia/Ho_Chi_Minh"),
    currency: text("currency").notNull().default("VND"),
    language: text("language").notNull().default("vi"),
    workingDaysJson: jsonb("working_days_json")
      .notNull()
      .default({ days: [1, 2, 3, 4, 5] }),
    payrollConfigJson: jsonb("payroll_config_json").notNull().default({ cutoffDay: 25, payDay: 5 }),
    schemaVersion: integer("schema_version").notNull().default(1),
    // CS-5: hồ sơ công ty đầy đủ (migration 0360 — additive, nullable).
    shortName: text("short_name"),
    taxCode: text("tax_code"),
    businessType: text("business_type"),
    companyCode: text("company_code"),
    regNumber: text("reg_number"),
    regDate: date("reg_date"),
    regPlace: text("reg_place"),
    legalRepName: text("legal_rep_name"),
    legalRepTitle: text("legal_rep_title"),
    establishedDate: date("established_date"),
    address: text("address"),
    phone: text("phone"),
    fax: text("fax"),
    email: text("email"),
    website: text("website"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("companies_language_check", sql`language IN ('vi', 'en')`),
    check("companies_currency_check", sql`currency IN ('VND', 'USD')`),
  ],
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
