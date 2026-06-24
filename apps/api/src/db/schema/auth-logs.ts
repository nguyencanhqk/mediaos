import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { userSessions } from "./auth";
import { companies } from "./companies";
import { currentCompanyDefault } from "./_helpers";
import { users } from "./users";

/**
 * AUTH logs — append-only (BẤT BIẾN #2). S2-AUTH-DB-2 (DB-02 §7.8/§7.9 · IMPLEMENTATION-05 §12.1, mig 0443).
 *
 * app role GRANT SELECT,INSERT only (KHÔNG UPDATE/DELETE — log không sửa được). metadata/payload chỉ chứa
 * ngữ cảnh non-sensitive (count, ip, reason code) — CẤM password/token/secret (BẤT BIẾN #3).
 */

/**
 * login_logs — nhật ký đăng nhập (success/failed/blocked). `company_id` NULLABLE (DB-02 §7.8): fail với email
 * KHÔNG tồn tại không resolve được company nhưng VẪN phải ghi log (chống brute-force, KHÔNG lộ user tồn tại).
 * RLS nullable-tenant (USING own+NULL; WITH CHECK own hoặc NULL khi pre-auth) — DDL/policy ở migration 0443.
 */
export const loginLogs = pgTable(
  "login_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable: pre-auth fail (email không tồn tại) không có tenant. DEFAULT = ngữ cảnh hiện tại nếu có.
    companyId: uuid("company_id")
      .default(currentCompanyDefault)
      .references(() => companies.id),
    userId: uuid("user_id").references(() => users.id),
    email: text("email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    /** success | failed | blocked (lowercase theo chuẩn codebase). */
    loginStatus: text("login_status").notNull(),
    /** WrongPassword | UserNotFound | Locked | Inactive | TooManyAttempts | CompanyInactive … (nullable). */
    failureReason: text("failure_reason"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    platform: text("platform"),
    sessionId: uuid("session_id").references(() => userSessions.id),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("login_logs_company_created_idx").on(t.companyId, t.createdAt),
    index("login_logs_email_created_idx").on(t.normalizedEmail, t.createdAt),
    index("login_logs_user_created_idx").on(t.userId, t.createdAt),
    index("login_logs_ip_created_idx").on(t.ipAddress, t.createdAt),
    index("login_logs_company_status_idx").on(t.companyId, t.loginStatus),
  ],
);

export type LoginLog = typeof loginLogs.$inferSelect;
export type NewLoginLog = typeof loginLogs.$inferInsert;

/**
 * user_security_events — timeline sự kiện bảo mật tài khoản (PASSWORD_CHANGED, USER_LOCKED, ROLE_ASSIGNED…).
 * company_id NOT NULL (sự kiện luôn gắn user đã biết → company resolve được). Append-only. DDL ở migration 0443.
 */
export const userSecurityEvents = pgTable(
  "user_security_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    eventType: text("event_type").notNull(),
    /** info | low | medium | high | critical. */
    severity: text("severity").notNull().default("info"),
    /** Actor thực hiện (null = hệ thống). */
    actorUserId: uuid("actor_user_id").references(() => users.id),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("user_security_events_company_user_idx").on(t.companyId, t.userId, t.createdAt),
    index("user_security_events_company_type_idx").on(t.companyId, t.eventType),
  ],
);

export type UserSecurityEvent = typeof userSecurityEvents.$inferSelect;
export type NewUserSecurityEvent = typeof userSecurityEvents.$inferInsert;
