import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";

/**
 * CS-9 company_security_policies — chính sách bảo mật MỖI CÔNG TY (1 hàng/tenant). DDL/RLS/grant ở
 * migration 0390. enforce THẬT ở tầng auth (login/refresh — IP/giờ/2FA) + tạo tài khoản (email-domain).
 *
 * BẤT BIẾN #1: company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy tenant_isolation +
 *   UNIQUE(company_id). Mọi data-access qua withTenant(actor.companyId).
 * BẤT BIẾN #3: KHÔNG secret/PII — chỉ cấu hình (cờ + allowlist CIDR/giờ/domain + danh sách user-id miễn).
 */

/** 1 cửa sổ thời gian được phép. day 0–6 (0=CN…6=T7). start/end "HH:MM"; end<start = qua nửa đêm. */
export interface SecurityTimeWindow {
  day: number;
  start: string;
  end: string;
}

export const companySecurityPolicies = pgTable(
  "company_security_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    // null = tắt tự-động-đăng-xuất.
    autoLogoutMinutes: integer("auto_logout_minutes"),
    ipRestrictionEnabled: boolean("ip_restriction_enabled").notNull().default(false),
    allowlistCidrs: jsonb("allowlist_cidrs").$type<string[]>().notNull().default([]),
    timeRestrictionEnabled: boolean("time_restriction_enabled").notNull().default(false),
    timeWindows: jsonb("time_windows").$type<SecurityTimeWindow[]>().notNull().default([]),
    applyScope: text("apply_scope").notNull().default("all"),
    applyAppKeys: jsonb("apply_app_keys").$type<string[]>().notNull().default([]),
    exemptUserIds: jsonb("exempt_user_ids").$type<string[]>().notNull().default([]),
    emailDomainRestrictionEnabled: boolean("email_domain_restriction_enabled")
      .notNull()
      .default(false),
    allowedEmailDomains: jsonb("allowed_email_domains").$type<string[]>().notNull().default([]),
    // null = theo sàn global; true = ép thêm cho công ty (KHÔNG hạ global).
    twoFactorEnforced: boolean("two_factor_enforced"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("company_security_policies_company_id_idx").on(t.companyId),
    uniqueIndex("company_security_policies_company_uq").on(t.companyId),
  ],
);

export type CompanySecurityPolicy = typeof companySecurityPolicies.$inferSelect;
export type NewCompanySecurityPolicy = typeof companySecurityPolicies.$inferInsert;
