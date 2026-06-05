import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";

/**
 * users — tối thiểu cho auth (G2-6). DDL/RLS thật ở migration 0002. `email` ở DB là citext, unique
 * theo (company_id, email) khi chưa xoá mềm (KHÔNG unique toàn cục — nền cho login §3b).
 * `company_id` ở DB có DEFAULT current_setting('app.current_company_id') → app khỏi tự set.
 * KHÔNG bao giờ đưa `passwordHash` vào DTO (BẤT BIẾN #3).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .default(currentCompanyDefault)
    .references(() => companies.id),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
