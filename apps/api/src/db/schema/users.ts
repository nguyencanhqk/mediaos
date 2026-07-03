import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
  // S2-AUTH-DB-2 (§12.1/§12.4): email chuẩn hoá lowercase — GENERATED STORED từ email (citext) ⇒ KHÔNG drift,
  // app khỏi tự set. Nền cho unique (company_id, normalized_email) + login lookup. KHÔNG đưa vào INSERT.
  normalizedEmail: text("normalized_email").generatedAlwaysAs(sql`lower(email::text)`),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name"),
  status: text("status").notNull().default("active"),
  // S2-AUTH-DB-2 (§12.1): đếm login fail liên tiếp + khoá tài khoản (BE-1 tăng/reset; lock/unlock admin).
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedReason: text("locked_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  // CS-7: thống kê lần đăng nhập cuối — NULL trước lần login đầu. Best-effort (không block login nếu write lỗi).
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  // S2-AUTH-DB-2 (§12.1 "audit columns"): self-ref actor. FK ở DB (migration 0443, ON DELETE SET NULL);
  // schema giữ uuid trần để tránh vòng tham chiếu self-table khi suy luận type.
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  deletedBy: uuid("deleted_by"),
  // S2-AUTH-DB-4 (mig 0466): cờ ép 2FA PER-USER (khác roles.requires_two_factor = ép theo ROLE ở mig 0120).
  // NOT NULL DEFAULT false — không backfill. Nền cho enforcement + admin reset-2fa:user.
  requireTwoFactor: boolean("require_two_factor").notNull().default(false),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
