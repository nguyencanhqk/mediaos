import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * AC-9 db-ops — 3 bảng GLOBAL no-RLS OPERATOR-SCOPED (target_tenant_id, KHÔNG company_id).
 *
 * Vì KHÔNG có company_id ⇒ tự loại khỏi rls-guards/rls-coverage-assert ⇒ KHÔNG vào rls-registry/
 * cleanupTenants (verify trong tenant-isolation regression). Append-only + frozen cols ép Ở DB qua
 * REVOKE/column-GRANT (migration 0345) — KHÔNG có RLS. DDL/grant/seed ở migration 0345; Drizzle inference
 * dưới đây = parity check với migration.
 *
 * BẤT BIẾN #3: reason KHÔNG bao giờ vào data-browser allowlist/DTO (nhạy cảm nghiệp vụ).
 */

/** db_ops_grants — break-glass grant lifecycle (MUTABLE status FSM, column-grant). */
export const dbOpsGrants = pgTable("db_ops_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  requesterUserId: uuid("requester_user_id").notNull(),
  /** null = phạm vi all-tenant (migration-status / export all). */
  targetTenantId: uuid("target_tenant_id"),
  reason: text("reason").notNull(),
  requiredApprovals: integer("required_approvals").notNull().default(2),
  status: text("status").notNull().default("pending"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: uuid("revoked_by"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type DbOpsGrant = typeof dbOpsGrants.$inferSelect;

/** db_ops_grant_approvals — phiếu duyệt APPEND-ONLY (SoD ép Ở DB: UNIQUE + CHECK self-approve). */
export const dbOpsGrantApprovals = pgTable("db_ops_grant_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  grantId: uuid("grant_id").notNull(),
  approverUserId: uuid("approver_user_id").notNull(),
  requesterUserId: uuid("requester_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type DbOpsGrantApproval = typeof dbOpsGrantApprovals.$inferSelect;

/** db_export_jobs — export job (WAVE 3 C2: worker materialize — mig 0347 thêm object_key + error). */
export const dbExportJobs = pgTable("db_export_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  requesterUserId: uuid("requester_user_id").notNull(),
  targetTenantId: uuid("target_tenant_id").notNull(),
  tableName: text("table_name").notNull(),
  filter: jsonb("filter"),
  status: text("status").notNull().default("queued"),
  rowCount: integer("row_count"),
  /** Vị trí file export trong bucket ({target}/db-exports/{jobId}, server-derived). NULL trước khi 'done'. */
  objectKey: text("object_key"),
  /** Lý do fail (non-sensitive infra message — KHÔNG row data, BẤT BIẾN #3). NULL trừ khi 'failed'. */
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
export type DbExportJob = typeof dbExportJobs.$inferSelect;
