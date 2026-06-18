import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";

/**
 * user_invites — CS-10 vòng đời lời mời tài khoản (DDL/RLS thật ở migration 0410).
 *
 * status: 'pending' (đã mời, chờ accept) → 'accepted' (đã đặt mật khẩu, chờ duyệt) → 'approved' | 'rejected'.
 * `tokenHash` = sha256 của token gửi-email (KHÔNG lưu token thật). `passwordHash` = argon2 đặt ở accept,
 * dời sang users.password_hash khi approve. CẢ HAI KHÔNG bao giờ vào DTO (BẤT BIẾN #3).
 * `company_id` có DEFAULT current_setting → app khỏi tự set; RLS FORCE ép tenant.
 */
export const userInvites = pgTable("user_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .default(currentCompanyDefault)
    .references(() => companies.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  tokenHash: text("token_hash").notNull(),
  status: text("status").notNull().default("pending"),
  passwordHash: text("password_hash"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdUserId: uuid("created_user_id"),
  invitedBy: uuid("invited_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserInvite = typeof userInvites.$inferSelect;
export type NewUserInvite = typeof userInvites.$inferInsert;
