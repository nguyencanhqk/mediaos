import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { users } from "./users";

/** Phân loại alert an ninh (G16-1b). Đồng bộ CHECK `security_alerts_type_check` (mig 0122). */
export const SECURITY_ALERT_TYPES = [
  "repeated_reauth_failure",
  "repeated_cross_scope_deny",
  "anomalous_login",
] as const;
export type SecurityAlertType = (typeof SECURITY_ALERT_TYPES)[number];

/** Mức độ nghiêm trọng. Đồng bộ CHECK `security_alerts_severity_check` (mig 0122). */
export const SECURITY_ALERT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type SecurityAlertSeverity = (typeof SECURITY_ALERT_SEVERITIES)[number];

/**
 * security_alerts — APPEND-ONLY (BẤT BIẾN #2). DDL/RLS/grant ở migration 0122. app role chỉ SELECT+INSERT
 * (KHÔNG UPDATE/DELETE). RLS theo company_id + FORCE (BẤT BIẾN #1). `detail` JSONB CHỈ ngữ cảnh
 * non-sensitive (count vượt ngưỡng, reason code, ip) — CẤM secret/password/recovery-code (BẤT BIẾN #3).
 */
export const securityAlerts = pgTable(
  "security_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id),
    alertType: text("alert_type").notNull(),
    severity: text("severity").notNull().default("medium"),
    subject: text("subject"),
    subjectUserId: uuid("subject_user_id").references(() => users.id),
    detail: jsonb("detail").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("security_alerts_company_created_idx").on(t.companyId, t.createdAt),
    index("security_alerts_company_type_idx").on(t.companyId, t.alertType),
  ],
);

export type SecurityAlert = typeof securityAlerts.$inferSelect;
export type NewSecurityAlert = typeof securityAlerts.$inferInsert;
