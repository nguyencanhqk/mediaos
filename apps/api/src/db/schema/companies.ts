import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * companies — gốc tenant (ERD §6). DDL/RLS thật ở migration 0002 (hand-written); schema này CHỈ để
 * gõ kiểu cho query. `slug` ở DB là citext (case-insensitive, unique toàn cục khi chưa xoá mềm).
 * Giữ ĐỒNG BỘ với 0002_companies_users.sql khi đổi cột.
 */
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
