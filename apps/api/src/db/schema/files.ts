import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { users } from "./users";

/**
 * FOUNDATION-DB-3 — File subsystem (DB-08 §8.6/8.7/8.8). DDL/RLS/grant ở migration 0433. Inference dưới đây
 * PARITY với migration (drizzle KHÔNG mô tả RLS/grant — quy ước bằng comment + migration là nguồn sự thật).
 *
 * BẤT BIẾN (CLAUDE.md §2/§3):
 *  - files / file_links: company_id NOT NULL + RLS ENABLE/FORCE + policy tenant_isolation; soft-delete
 *    (deleted_at) — app role SELECT/INSERT/UPDATE, KHÔNG DELETE (không hard-delete).
 *  - file_access_logs: company_id NOT NULL + RLS ENABLE/FORCE + APPEND-ONLY — app role chỉ SELECT/INSERT
 *    (REVOKE UPDATE/DELETE ở migration). KHÔNG soft-delete, log bất biến.
 */

/**
 * `files` — metadata file dùng chung (DB-08 §8.6). KHÔNG lưu binary trong DB.
 * visibility ∈ Private/Internal/Public (default Private) · upload_status ∈ Pending/Uploaded/Failed/Deleted ·
 * scan_status ∈ NotRequired/Pending/Clean/Infected/Failed · storage_provider ∈ Local/S3/GCS/MinIO/Azure
 * (CHECK ở migration). file_size_bytes >= 0.
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    originalName: varchar("original_name", { length: 500 }).notNull(),
    storedName: varchar("stored_name", { length: 500 }).notNull(),
    fileExtension: varchar("file_extension", { length: 50 }),
    mimeType: varchar("mime_type", { length: 255 }).notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    storageProvider: varchar("storage_provider", { length: 50 }).notNull(),
    storageBucket: varchar("storage_bucket", { length: 255 }),
    storagePath: text("storage_path").notNull(),
    checksumSha256: varchar("checksum_sha256", { length: 128 }),
    contentHash: varchar("content_hash", { length: 128 }),
    visibility: varchar("visibility", { length: 50 }).notNull().default("Private"),
    uploadStatus: varchar("upload_status", { length: 50 }).notNull().default("Pending"),
    scanStatus: varchar("scan_status", { length: 50 }).notNull().default("NotRequired"),
    scanResult: jsonb("scan_result"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    downloadCount: integer("download_count").notNull().default(0),
    isTemporary: boolean("is_temporary").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("idx_files_company_uploaded")
      .on(t.companyId, t.uploadedAt.desc())
      .where(sql`deleted_at IS NULL`),
    index("idx_files_uploaded_by")
      .on(t.companyId, t.uploadedBy, t.uploadedAt.desc())
      .where(sql`deleted_at IS NULL`),
    index("idx_files_content_hash")
      .on(t.companyId, t.contentHash)
      .where(sql`deleted_at IS NULL AND content_hash IS NOT NULL`),
    index("idx_files_temporary_expiry")
      .on(t.companyId, t.isTemporary, t.expiresAt)
      .where(sql`deleted_at IS NULL`),
    // DB-09 §8.6 (mig 0472) — lọc file theo trạng thái upload mới→cũ (chỉ hàng sống) + cleanup file đã xoá.
    index("idx_files_company_status")
      .on(t.companyId, t.uploadStatus, t.uploadedAt.desc())
      .where(sql`deleted_at IS NULL`),
    index("idx_files_cleanup_deleted")
      .on(t.deletedAt)
      .where(sql`deleted_at IS NOT NULL`),
    index("files_company_id_idx").on(t.companyId),
  ],
);

/**
 * `file_links` — liên kết file ↔ entity nghiệp vụ (DB-08 §8.7). Polymorphic CÓ KIỂM SOÁT qua
 * (module_code, entity_type, entity_id). link_type ∈ Avatar/Attachment/Contract/Proof/Document/Import/
 * Export/Other · access_scope ∈ Owner/Team/Department/Company/System (CHECK ở migration). uq is_primary /
 * (entity, link_type) WHERE is_primary AND deleted_at IS NULL. Gỡ link = soft-delete.
 */
export const fileLinks = pgTable(
  "file_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    moduleCode: varchar("module_code", { length: 50 }).notNull(),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    entityCode: varchar("entity_code", { length: 255 }),
    linkType: varchar("link_type", { length: 100 }).notNull(),
    purpose: varchar("purpose", { length: 255 }),
    isPrimary: boolean("is_primary").notNull().default(false),
    sortOrder: integer("sort_order"),
    accessScope: varchar("access_scope", { length: 50 }).notNull().default("Company"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("idx_file_links_entity")
      .on(t.companyId, t.moduleCode, t.entityType, t.entityId)
      .where(sql`deleted_at IS NULL`),
    index("idx_file_links_file")
      .on(t.fileId)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("uq_file_links_primary_per_entity_type")
      .on(t.companyId, t.moduleCode, t.entityType, t.entityId, t.linkType)
      .where(sql`is_primary = true AND deleted_at IS NULL`),
    // DB-09 §8.7 (mig 0472) — chặn LINK TRÙNG: 1 file gắn 1 lần / (entity, link_type). ĐÚNG 6 cột (thêm
    // file_id so với uq is_primary 5 cột ở trên). Partial WHERE deleted_at IS NULL (re-link sau soft-delete OK).
    uniqueIndex("uq_file_links_entity_file_active")
      .on(t.companyId, t.moduleCode, t.entityType, t.entityId, t.fileId, t.linkType)
      .where(sql`deleted_at IS NULL`),
    index("file_links_company_id_idx").on(t.companyId),
  ],
);

/**
 * `file_access_logs` — log truy cập file (DB-08 §8.8). APPEND-ONLY (app role chỉ SELECT/INSERT — REVOKE
 * UPDATE/DELETE ở migration). action ∈ Preview/Download/Upload/Delete/Link/Unlink/GenerateSignedUrl (CHECK).
 * KHÔNG soft-delete, KHÔNG updated_at (log bất biến).
 *
 * LỆCH SPEC: actor_employee_id giữ uuid KHÔNG FK (schema HR dùng employee_profiles, không có bảng employees).
 */
export const fileAccessLogs = pgTable(
  "file_access_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    fileLinkId: uuid("file_link_id").references(() => fileLinks.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorEmployeeId: uuid("actor_employee_id"),
    action: varchar("action", { length: 50 }).notNull(),
    moduleCode: varchar("module_code", { length: 50 }),
    entityType: varchar("entity_type", { length: 100 }),
    entityId: uuid("entity_id"),
    permissionCode: varchar("permission_code", { length: 150 }),
    accessGranted: boolean("access_granted").notNull(),
    deniedReason: varchar("denied_reason", { length: 255 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    requestId: varchar("request_id", { length: 100 }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_file_access_logs_file_created").on(t.fileId, t.createdAt.desc()),
    index("idx_file_access_logs_actor_created").on(t.companyId, t.actorUserId, t.createdAt.desc()),
    index("idx_file_access_logs_entity").on(
      t.companyId,
      t.moduleCode,
      t.entityType,
      t.entityId,
      t.createdAt.desc(),
    ),
    index("file_access_logs_company_id_idx").on(t.companyId),
  ],
);

export type FileRecord = typeof files.$inferSelect;
export type NewFileRecord = typeof files.$inferInsert;
export type FileLink = typeof fileLinks.$inferSelect;
export type NewFileLink = typeof fileLinks.$inferInsert;
export type FileAccessLog = typeof fileAccessLogs.$inferSelect;
export type NewFileAccessLog = typeof fileAccessLogs.$inferInsert;
