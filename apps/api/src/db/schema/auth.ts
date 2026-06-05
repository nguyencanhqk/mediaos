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
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBy: uuid("replaced_by").references((): AnyPgColumn => refreshTokens.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_uq").on(t.tokenHash),
    index("refresh_tokens_user_idx").on(t.companyId, t.userId),
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
