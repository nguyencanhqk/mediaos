import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
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
 * refresh_tokens — rotation + hash-at-rest (G2-6). token_hash = SHA-256 của refresh token (entropy cao).
 * Rotate: revoke token cũ (revoked_at) + replaced_by trỏ token mới. DDL/RLS ở migration 0004.
 *
 * FS-1a (mig 0400): `family_id` nhóm chuỗi rotation thành 1 HỌ token (SSO cookie). Login → family MỚI
 * (DEFAULT gen_random_uuid()); rotation → token mới KẾ THỪA family_id token cũ. Reuse-detection/logout →
 * thu hồi MỌI token cùng family_id. DEFAULT đơn-lẻ ⇒ hàng cũ + seed harness an toàn (không backfill).
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    /** Họ token (rotation chain). Login phát family mới; rotation kế thừa; reuse/logout thu hồi cả họ. */
    familyId: uuid("family_id").notNull().defaultRandom(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBy: uuid("replaced_by").references((): AnyPgColumn => refreshTokens.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_uq").on(t.tokenHash),
    index("refresh_tokens_user_idx").on(t.companyId, t.userId),
    // Partial: chỉ token còn sống (đường nóng thu hồi family reuse/logout luôn lọc revoked_at IS NULL).
    index("refresh_tokens_family_active_idx")
      .on(t.companyId, t.familyId)
      .where(sql`revoked_at IS NULL`),
  ],
);

export type RefreshToken = typeof refreshTokens.$inferSelect;

/** password_reset_tokens — single-use (used_at) + expires_at + hash-at-rest. DDL/RLS ở 0004. */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("password_reset_tokens_hash_uq").on(t.tokenHash),
    index("password_reset_tokens_user_idx").on(t.companyId, t.userId),
  ],
);

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

/**
 * user_sessions — phiên đăng nhập server-side canonical (DB-02 §7.6 / IMPLEMENTATION-05 §12.1, mig 0443).
 * MUTABLE: revoke = UPDATE `revoked_at` (KHÔNG hard-delete). refresh_token_hash = HASH (BẤT BIẾN #3 — BE-1
 * hash trước khi ghi, KHÔNG plaintext token). company_id NOT NULL + RLS+FORCE (BẤT BIẾN #1).
 *
 * Cùng tồn tại với `refresh_tokens` (impl hiện tại): S2-AUTH-BE-1 chốt session strategy (S2-OQ-001
 * HttpOnly cookie) rồi hợp nhất. DB-2 chỉ dựng bảng canonical §12.1 mà BE-1 cần — KHÔNG drop refresh_tokens.
 */
export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    accessTokenJti: text("access_token_jti"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    deviceId: text("device_id"),
    deviceName: text("device_name"),
    platform: text("platform"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id),
    revokedReason: text("revoked_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_sessions_token_hash_uq").on(t.refreshTokenHash),
    // Đường nóng: liệt kê phiên còn sống của 1 user (lọc expired_at/revoked_at).
    index("user_sessions_user_active_idx").on(t.userId, t.expiredAt, t.revokedAt),
    index("user_sessions_company_created_idx").on(t.companyId, t.createdAt),
  ],
);

export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
