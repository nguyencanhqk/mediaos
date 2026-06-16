import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { platformAccounts } from "./media";
import { users } from "./users";

/** Trạng thái 1 grant break-glass. Đồng bộ CHECK `break_glass_grants_status_check` (mig 0200). */
export const BREAK_GLASS_GRANT_STATUSES = ["pending", "active", "revoked"] as const;
export type BreakGlassGrantStatus = (typeof BREAK_GLASS_GRANT_STATUSES)[number];

/** Ngưỡng SoD tối thiểu (DB CHECK `required_approvals >= 2`). 1/0 người duyệt KHÔNG kích hoạt được. */
export const BREAK_GLASS_MIN_APPROVALS = 2;

/**
 * break_glass_grants — yêu cầu truy cập KHẨN CẤP 1 platform_account secret (G6-2 PR-B). DDL/RLS/grant +
 * FSM trigger ở migration 0200. MUTABLE status (pending→active→revoked) nhưng column-grant: app UPDATE
 * CHỈ cột vòng đời (status, activated_at, revoked_at, revoked_by, updated_at) — KHÔNG sửa account/
 * requester/reason/required_approvals/expires_at (frozen sau request). RLS theo company_id + FORCE (#1).
 * KHÔNG chứa secret (BẤT BIẾN #3) — chỉ trỏ platform_account_id; reveal thật ở reveal-path (ROUND 2).
 */
export const breakGlassGrants = pgTable(
  "break_glass_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    platformAccountId: uuid("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    requesterUserId: uuid("requester_user_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull(),
    requiredApprovals: integer("required_approvals").notNull().default(BREAK_GLASS_MIN_APPROVALS),
    status: text("status").notNull().default("pending"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("break_glass_grants_company_id_idx").on(t.companyId),
    index("break_glass_grants_company_account_idx").on(t.companyId, t.platformAccountId),
    // ROUND 2 (mig 0201): phủ listGrantsForRequester (màn "grant của tôi") lọc (company_id, requester_user_id).
    index("break_glass_grants_requester_idx").on(t.companyId, t.requesterUserId),
    // Partial index (khớp mig 0200): tra cứu grant 'active' của 1 requester/account — ROUND 2 reveal gate.
    index("break_glass_grants_active_idx")
      .on(t.companyId, t.platformAccountId, t.requesterUserId)
      .where(sql`status = 'active'`),
  ],
);

export type BreakGlassGrant = typeof breakGlassGrants.$inferSelect;
export type NewBreakGlassGrant = typeof breakGlassGrants.$inferInsert;

/**
 * break_glass_approvals — phiếu duyệt break-glass (APPEND-ONLY, BẤT BIẾN #2: app SELECT/INSERT, KHÔNG
 * UPDATE/DELETE). SoD ép Ở DB: UNIQUE(company_id, grant_id, approver_user_id) chống duyệt-trùng +
 * CHECK(approver_user_id <> requester_user_id) chống tự-duyệt (requester denormalized lên hàng). RLS+FORCE.
 */
export const breakGlassApprovals = pgTable(
  "break_glass_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => breakGlassGrants.id, { onDelete: "cascade" }),
    approverUserId: uuid("approver_user_id")
      .notNull()
      .references(() => users.id),
    requesterUserId: uuid("requester_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("break_glass_approvals_company_id_idx").on(t.companyId),
    index("break_glass_approvals_grant_idx").on(t.companyId, t.grantId),
    uniqueIndex("break_glass_approvals_grant_approver_uq").on(
      t.companyId,
      t.grantId,
      t.approverUserId,
    ),
  ],
);

export type BreakGlassApproval = typeof breakGlassApprovals.$inferSelect;
export type NewBreakGlassApproval = typeof breakGlassApprovals.$inferInsert;
