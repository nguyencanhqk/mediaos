-- Migration 0433: FOUNDATION-DB-3 (🔴 RED) — files + file_links + file_access_logs theo DB-08 §8.6/8.7/8.8.
-- Gate: FULL (security-reviewer [RLS + append-only] + database-reviewer + silent-failure-hunter).
--
-- BAND 0433 (lane foundation-db). Journal: idx 116, when 1717500510000 (> head 0432 idx 115 / 1717500500000).
-- Nối tiếp ĐƠN ĐIỆU sau head 0432_foundation_db2_audit_logs. Migration đơn điệu sau head 0430 (idx 113).
--
-- MỤC TIÊU (File subsystem dùng chung — metadata + liên kết polymorphic CÓ KIỂM SOÁT + log truy cập):
--   • files            : metadata file dùng chung (KHÔNG lưu binary trong DB). company_id NOT NULL + RLS/FORCE.
--                        upload_status / scan_status / visibility(default Private) + storage_provider/path/checksum.
--   • file_links       : liên kết file ↔ entity nghiệp vụ qua (module_code/entity_type/entity_id) — polymorphic
--                        CÓ KIỂM SOÁT (CHECK link_type/access_scope; uq is_primary / entity / link_type).
--   • file_access_logs : log Preview/Download/Upload/Delete/Link/Unlink/GenerateSignedUrl — APPEND-ONLY.
--
-- BẤT BIẾN (CLAUDE.md §2/§3):
--   #1 company_id ở MỌI bảng nghiệp vụ: company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy
--      tenant_isolation USING/WITH CHECK company_id = current_setting('app.current_company_id') — TẠO TRƯỚC mọi
--      INSERT/backfill (WO này KHÔNG seed). Policy tương thích set_config(...,true) PgBouncer txn-mode.
--   #2 file_access_logs = LOG ⇒ APPEND-ONLY: app role chỉ SELECT/INSERT, REVOKE UPDATE/DELETE tường minh →
--      ghi-rồi-update/delete bằng app role PHẢI FAIL. files/file_links = mutable (soft-delete deleted_at) ⇒
--      app role SELECT/INSERT/UPDATE, KHÔNG DELETE (BẤT BIẾN #2 không hard-delete).
--   #5 UUID PK + timestamptz UTC-at-rest (ADR-0008).
--
-- ⚠️ LỆCH SPEC có chủ đích (xem report deviationsFromSpec):
--   • file_access_logs.actor_employee_id: DB-08 ghi "FK employees.id" nhưng schema HR hiện dùng bảng
--     employee_profiles (KHÔNG có bảng `employees`). Giữ cột uuid KHÔNG FK để tránh FK trỏ bảng sai/không tồn
--     tại (FK sẽ thêm ở phase HR khi chuẩn hoá tên bảng). Cô lập tenant vẫn ép qua company_id RLS.
--   • CHECK file_access_logs.action MỞ RỘNG thêm 'GenerateSignedUrl' so với cột "Ghi chú" trong bảng cột
--     (DB-08 §8.8) — KHỚP đúng block constraint SQL của spec (đã liệt kê GenerateSignedUrl).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 1) files — metadata file dùng chung (DB-08 §8.6). RLS+FORCE + policy tenant_isolation TẠO TRƯỚC mọi
--    INSERT (CLAUDE.md §3). company_id NOT NULL DEFAULT current_setting (mẫu 0431 company_settings).
--    visibility DEFAULT 'Private' (DB-08 §5.7 file private là mặc định).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL
                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies(id) ON DELETE CASCADE,
  original_name     varchar(500) NOT NULL,
  stored_name       varchar(500) NOT NULL,
  file_extension    varchar(50),
  mime_type         varchar(255) NOT NULL,
  file_size_bytes   bigint NOT NULL,
  storage_provider  varchar(50) NOT NULL,
  storage_bucket    varchar(255),
  storage_path      text NOT NULL,
  checksum_sha256   varchar(128),
  content_hash      varchar(128),
  visibility        varchar(50) NOT NULL DEFAULT 'Private',
  upload_status     varchar(50) NOT NULL DEFAULT 'Pending',
  scan_status       varchar(50) NOT NULL DEFAULT 'NotRequired',
  scan_result       jsonb,
  owner_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  last_accessed_at  timestamptz,
  download_count    integer NOT NULL DEFAULT 0,
  is_temporary      boolean NOT NULL DEFAULT false,
  expires_at        timestamptz,
  retention_until   timestamptz,
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  deleted_by        uuid REFERENCES users(id) ON DELETE SET NULL
);
--> statement-breakpoint
-- ── RLS TRƯỚC mọi INSERT/backfill (CLAUDE.md §3) ──
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE files FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON files
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE files
  ADD CONSTRAINT chk_files_storage_provider
  CHECK (storage_provider IN ('Local', 'S3', 'GCS', 'MinIO', 'Azure'));
--> statement-breakpoint
ALTER TABLE files
  ADD CONSTRAINT chk_files_visibility
  CHECK (visibility IN ('Private', 'Internal', 'Public'));
--> statement-breakpoint
ALTER TABLE files
  ADD CONSTRAINT chk_files_upload_status
  CHECK (upload_status IN ('Pending', 'Uploaded', 'Failed', 'Deleted'));
--> statement-breakpoint
ALTER TABLE files
  ADD CONSTRAINT chk_files_scan_status
  CHECK (scan_status IN ('NotRequired', 'Pending', 'Clean', 'Infected', 'Failed'));
--> statement-breakpoint
ALTER TABLE files
  ADD CONSTRAINT chk_files_size_non_negative
  CHECK (file_size_bytes >= 0);
--> statement-breakpoint
CREATE INDEX idx_files_company_uploaded
  ON files (company_id, uploaded_at DESC)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_files_uploaded_by
  ON files (company_id, uploaded_by, uploaded_at DESC)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_files_content_hash
  ON files (company_id, content_hash)
  WHERE deleted_at IS NULL AND content_hash IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_files_temporary_expiry
  ON files (company_id, is_temporary, expires_at)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX files_company_id_idx ON files (company_id);
--> statement-breakpoint
-- Mutable metadata + soft-delete (deleted_at). App SELECT/INSERT/UPDATE — KHÔNG DELETE (BẤT BIẾN #2 soft-delete).
GRANT SELECT, INSERT, UPDATE ON files TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON files TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 2) file_links — liên kết file ↔ entity nghiệp vụ (DB-08 §8.7). Polymorphic CÓ KIỂM SOÁT: (module_code,
--    entity_type, entity_id) + CHECK link_type/access_scope. RLS+FORCE TẠO TRƯỚC INSERT. uq is_primary
--    per (company, module, entity_type, entity_id, link_type) WHERE is_primary AND deleted_at IS NULL.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE file_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL
                  DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                  REFERENCES companies(id) ON DELETE CASCADE,
  file_id       uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  module_code   varchar(50) NOT NULL,
  entity_type   varchar(100) NOT NULL,
  entity_id     uuid NOT NULL,
  entity_code   varchar(255),
  link_type     varchar(100) NOT NULL,
  purpose       varchar(255),
  is_primary    boolean NOT NULL DEFAULT false,
  sort_order    integer,
  access_scope  varchar(50) NOT NULL DEFAULT 'Company',
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES users(id) ON DELETE SET NULL
);
--> statement-breakpoint
-- ── RLS TRƯỚC mọi INSERT/backfill (CLAUDE.md §3) ──
ALTER TABLE file_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE file_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON file_links
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE file_links
  ADD CONSTRAINT chk_file_links_link_type
  CHECK (link_type IN ('Avatar', 'Attachment', 'Contract', 'Proof', 'Document', 'Import', 'Export', 'Other'));
--> statement-breakpoint
ALTER TABLE file_links
  ADD CONSTRAINT chk_file_links_access_scope
  CHECK (access_scope IN ('Owner', 'Team', 'Department', 'Company', 'System'));
--> statement-breakpoint
CREATE INDEX idx_file_links_entity
  ON file_links (company_id, module_code, entity_type, entity_id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_file_links_file
  ON file_links (file_id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
-- 1 file primary / (entity, link_type) chưa soft-delete (DB-08 §8.7 constraint).
CREATE UNIQUE INDEX uq_file_links_primary_per_entity_type
  ON file_links (company_id, module_code, entity_type, entity_id, link_type)
  WHERE is_primary = true AND deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX file_links_company_id_idx ON file_links (company_id);
--> statement-breakpoint
-- Mutable link + soft-delete (gỡ link = soft-delete, DB-08 §8.7 rule 5). App SELECT/INSERT/UPDATE — KHÔNG DELETE.
GRANT SELECT, INSERT, UPDATE ON file_links TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON file_links TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 3) file_access_logs — log truy cập file, APPEND-ONLY (DB-08 §8.8). RLS+FORCE TẠO TRƯỚC INSERT. KHÔNG
--    soft-delete, KHÔNG updated_at (log bất biến). app role chỉ SELECT/INSERT → REVOKE UPDATE/DELETE.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE file_access_logs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  file_id            uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  file_link_id       uuid REFERENCES file_links(id) ON DELETE SET NULL,
  actor_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  -- LỆCH SPEC: DB-08 ghi FK employees.id nhưng schema HR dùng employee_profiles (không có bảng employees).
  -- Giữ uuid KHÔNG FK để tránh FK trỏ bảng sai; chuẩn hoá ở phase HR.
  actor_employee_id  uuid,
  action             varchar(50) NOT NULL,
  module_code        varchar(50),
  entity_type        varchar(100),
  entity_id          uuid,
  permission_code    varchar(150),
  access_granted     boolean NOT NULL,
  denied_reason      varchar(255),
  ip_address         varchar(45),
  user_agent         text,
  request_id         varchar(100),
  metadata           jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- ── RLS TRƯỚC mọi INSERT/backfill (CLAUDE.md §3) ──
ALTER TABLE file_access_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE file_access_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON file_access_logs
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE file_access_logs
  ADD CONSTRAINT chk_file_access_logs_action
  CHECK (action IN ('Preview', 'Download', 'Upload', 'Delete', 'Link', 'Unlink', 'GenerateSignedUrl'));
--> statement-breakpoint
CREATE INDEX idx_file_access_logs_file_created
  ON file_access_logs (file_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_file_access_logs_actor_created
  ON file_access_logs (company_id, actor_user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_file_access_logs_entity
  ON file_access_logs (company_id, module_code, entity_type, entity_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX file_access_logs_company_id_idx ON file_access_logs (company_id);
--> statement-breakpoint
-- APPEND-ONLY (BẤT BIẾN #2). app role chỉ SELECT/INSERT. REVOKE UPDATE,DELETE tường minh (idempotent —
-- chưa grant thì REVOKE là no-op an toàn) → ghi-rồi-update/delete bằng app role PHẢI FAIL.
GRANT SELECT, INSERT ON file_access_logs TO mediaos_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON file_access_logs FROM mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON file_access_logs TO mediaos_worker;

-- -------- Down (manual) --------
-- DROP TABLE IF EXISTS file_access_logs;
-- DROP TABLE IF EXISTS file_links;
-- DROP TABLE IF EXISTS files;
