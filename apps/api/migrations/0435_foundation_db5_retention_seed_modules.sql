-- Migration 0435: FOUNDATION-DB-5 (🔴 RED) — data_retention_policies + seed_batches + seed_items
--   (DB-08 §8.11/8.12/8.13) + seed modules catalog (§8.2) + system_settings defaults (§8.3) +
--   Foundation permission catalog (engine model action:resource).
-- Gate: FULL (security-reviewer [RLS nullable-tenant + permission seed] + database-reviewer +
--   silent-failure-hunter).
--
-- BAND 0435 (lane foundation-db). Journal: idx 118, when 1717500530000 (> head 0434 idx 117 /
--   1717500520000). Nối tiếp ĐƠN ĐIỆU sau head 0434_foundation_db4_sequences_holidays. Migration
--   đơn điệu sau head 0430 (idx 113). PHỤ THUỘC FOUNDATION-DB-1 (0431 system_settings) — seed defaults.
--
-- MỤC TIÊU:
--   1) modules                 : catalog module CHUẨN spec (§8.2) — KHÔNG company_id (global, mirror
--                                permissions/system_settings). KHÁC `system_modules` (0330 SaaS catalog).
--   2) data_retention_policies : chính sách lưu trữ/cleanup (§8.11). company_id NULLABLE (NULL = global
--                                default, có = company override). RLS+FORCE nullable-tenant.
--   3) seed_batches            : theo dõi batch seed idempotent (§8.12). company_id NULLABLE.
--                                RLS+FORCE nullable-tenant. KHÔNG append-only (seed tool cập nhật status).
--   4) seed_items              : từng item trong batch (§8.13). company_id NULLABLE. RLS+FORCE
--                                nullable-tenant. seed_key (= target_key) / checksum / status.
--   5) SEED idempotent (ON CONFLICT DO NOTHING):
--        • modules catalog (§8.2): AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI active; PAYROLL.. inactive.
--        • system_settings defaults (§8.3): file.max_upload_size_mb, file.allowed_mime_types,
--          system.default_timezone, system.default_locale, audit.default_retention_days.
--        • Foundation permission catalog: ánh xạ FOUNDATION.RESOURCE.ACTION (API-09) → (action,
--          resource_type) của permission engine (KHÔNG chuỗi dotted) — namespace 'foundation-*' để
--          KHÔNG đụng resource cũ (company/audit-log/file...). Grant company-admin (non-sensitive).
--
-- BẤT BIẾN (CLAUDE.md §2/§3) + DB-08 §5.3 (company_id nullable cho global default):
--   #1 Bảng có company_id NULLABLE (data_retention_policies/seed_batches/seed_items) ⇒ RLS ENABLE+FORCE
--      + policy tenant_isolation TẠO TRƯỚC mọi INSERT/backfill (mẫu 0005 roles / 0434 sequence_counters):
--        USING      (company_id = current_setting OR company_id IS NULL) → tenant đọc row CỦA MÌNH + global.
--        WITH CHECK (company_id = current_setting)                       → app role CHỈ ghi row tenant mình;
--                                                                          KHÔNG forge tenant khác, KHÔNG
--                                                                          ghi global (company_id NULL).
--      ⇒ row company_id NULL chỉ ĐỌC dạng GLOBAL CHUNG, KHÔNG rò DỮ LIỆU tenant khác. Ghi global = seed/
--      admin System qua table-owner (bypass FORCE). Tương thích set_config('app.current_company_id',$1,
--      true) PgBouncer txn-mode (NULLIF(...,'')::uuid → company chưa set → khớp company_id IS NULL).
--      • `modules` KHÔNG company_id ⇒ no-RLS (mirror permissions/system_settings); chỉ ghi qua seed/admin.
--   #2 modules/retention/seed = config/master-data MUTABLE (KHÔNG audit/snapshot) ⇒ KHÔNG append-only.
--      App SELECT/INSERT/UPDATE; KHÔNG DELETE (soft-delete deleted_at với modules/retention; seed_batches/
--      seed_items không soft-delete nhưng cũng KHÔNG cấp DELETE — lịch sử seed giữ nguyên §8.12 rule).
--   #5 UUID PK + timestamptz UTC-at-rest (ADR-0008).
--   Permission seed: ON CONFLICT DO NOTHING (hot-file append — CLAUDE.md §9.3). modules/system_settings
--      seed cũng ON CONFLICT DO NOTHING → chạy lại KHÔNG trùng (idempotent).
--
-- ⚠️ LỆCH SPEC có chủ đích (xem report deviationsFromSpec):
--   • Permission code: API-09 ghi dạng dotted 'FOUNDATION.RESOURCE.ACTION'; permission ENGINE hiện tại lưu
--     (action, resource_type) tách rời + key 'action:resourceType' (require-permission.decorator). Theo
--     HỢP ĐỒNG WO ("KHÔNG chuỗi dotted") ⇒ seed dạng tuple, resource namespace 'foundation-<resource>'.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 1) modules — catalog module CHUẨN spec (DB-08 §8.2). KHÔNG company_id ⇒ no-RLS (mirror permissions /
--    system_settings). KHÁC `system_modules` (0330 — SaaS feature-flag catalog). Tự loại khỏi rls-registry.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE modules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code   varchar(50) NOT NULL,
  name          varchar(255) NOT NULL,
  description   text,
  module_group  varchar(100),
  version       varchar(50),
  is_core       boolean NOT NULL DEFAULT false,
  is_mvp        boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  dependencies  jsonb,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES users(id) ON DELETE SET NULL
);
--> statement-breakpoint
-- module_code business key duy nhất / hàng chưa soft-delete (§8.2 constraint).
CREATE UNIQUE INDEX uq_modules_module_code_active
  ON modules (module_code)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_modules_group_active
  ON modules (module_group, is_active)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
-- Catalog mutable + soft-delete (KHÔNG hard-delete module đã phát sinh permission/audit — §8.2 rule 4).
-- App SELECT/INSERT/UPDATE — KHÔNG DELETE. Worker SELECT (đọc catalog cho job nền).
GRANT SELECT, INSERT, UPDATE ON modules TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON modules TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 2) data_retention_policies — chính sách lưu trữ/cleanup (DB-08 §8.11). company_id NULLABLE (NULL =
--    global default, có = company override). RLS+FORCE + policy nullable-tenant (mẫu 0434) TẠO TRƯỚC INSERT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE data_retention_policies (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid REFERENCES companies(id) ON DELETE CASCADE,
  module_code             varchar(50) NOT NULL,
  entity_type             varchar(100) NOT NULL,
  retention_days          integer NOT NULL,
  archive_after_days      integer,
  delete_after_days       integer,
  cleanup_action          varchar(50) NOT NULL DEFAULT 'None',
  is_legal_hold_supported boolean NOT NULL DEFAULT false,
  is_enabled              boolean NOT NULL DEFAULT false,
  description             text,
  metadata                jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at              timestamptz,
  deleted_by              uuid REFERENCES users(id) ON DELETE SET NULL
);
--> statement-breakpoint
-- ── RLS TRƯỚC mọi INSERT/backfill (CLAUDE.md §3) — nullable-tenant policy mẫu 0434 ──
ALTER TABLE data_retention_policies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE data_retention_policies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- USING: tenant thấy policy CỦA MÌNH + global default (company_id IS NULL). WITH CHECK: app role CHỈ ghi
-- policy tenant mình; KHÔNG ghi global (company_id NULL — global seed qua đường system/owner, §5.3).
CREATE POLICY tenant_isolation ON data_retention_policies
  USING (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    OR company_id IS NULL
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
  );
--> statement-breakpoint
ALTER TABLE data_retention_policies
  ADD CONSTRAINT chk_data_retention_cleanup_action
  CHECK (cleanup_action IN ('None', 'Archive', 'Delete', 'Anonymize'));
--> statement-breakpoint
ALTER TABLE data_retention_policies
  ADD CONSTRAINT chk_data_retention_days_positive
  CHECK (retention_days >= 0);
--> statement-breakpoint
-- 1 policy enabled / (company_id, module_code, entity_type) chưa soft-delete (§8.11 constraint).
-- COALESCE company_id để NULL (global) cũng chiếm đúng 1 slot, KHÔNG né uq.
CREATE UNIQUE INDEX uq_data_retention_company_module_entity_active
  ON data_retention_policies (
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    module_code,
    entity_type
  )
  WHERE deleted_at IS NULL AND is_enabled = true;
--> statement-breakpoint
CREATE INDEX idx_data_retention_module_entity
  ON data_retention_policies (module_code, entity_type, is_enabled)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX data_retention_policies_company_id_idx ON data_retention_policies (company_id);
--> statement-breakpoint
-- Config mutable + soft-delete. App SELECT/INSERT/UPDATE — KHÔNG DELETE (BẤT BIẾN #2).
GRANT SELECT, INSERT, UPDATE ON data_retention_policies TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON data_retention_policies TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 3) seed_batches — theo dõi batch seed (DB-08 §8.12). company_id NULLABLE (NULL = global seed, có =
--    company seed). RLS+FORCE + policy nullable-tenant TẠO TRƯỚC INSERT. Worker cần UPDATE (set status/
--    finished khi chạy seed job) ⇒ app+worker SELECT/INSERT/UPDATE; KHÔNG DELETE (giữ lịch sử seed).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE seed_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid REFERENCES companies(id) ON DELETE CASCADE,
  seed_key      varchar(150) NOT NULL,
  seed_version  varchar(50) NOT NULL,
  environment   varchar(50),
  description   text,
  checksum      varchar(128),
  status        varchar(50) NOT NULL DEFAULT 'Pending',
  started_at    timestamptz,
  finished_at   timestamptz,
  executed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  error_message text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- ── RLS TRƯỚC mọi INSERT/backfill (CLAUDE.md §3) — nullable-tenant policy mẫu 0434 ──
ALTER TABLE seed_batches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE seed_batches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON seed_batches
  USING (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    OR company_id IS NULL
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
  );
--> statement-breakpoint
ALTER TABLE seed_batches
  ADD CONSTRAINT chk_seed_batches_status
  CHECK (status IN ('Pending', 'Running', 'Success', 'Failed', 'Skipped', 'RolledBack'));
--> statement-breakpoint
-- 1 batch / (company_id, seed_key, seed_version) — chạy lại KHÔNG tạo trùng (§8.12 rule 1/2 idempotent).
-- COALESCE company_id để NULL (global seed) cũng 1 slot.
CREATE UNIQUE INDEX uq_seed_batches_key_version_company
  ON seed_batches (
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    seed_key,
    seed_version
  );
--> statement-breakpoint
CREATE INDEX idx_seed_batches_status
  ON seed_batches (status, created_at DESC);
--> statement-breakpoint
CREATE INDEX seed_batches_company_id_idx ON seed_batches (company_id);
--> statement-breakpoint
-- Tracking mutable (status Pending→Running→Success/Failed). App+worker SELECT/INSERT/UPDATE — KHÔNG DELETE
-- (giữ lịch sử seed — §8.12). SeedTrackingService (FOUNDATION-BE-8) chạy qua worker job.
GRANT SELECT, INSERT, UPDATE ON seed_batches TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON seed_batches TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 4) seed_items — từng item trong batch (DB-08 §8.13). company_id NULLABLE (NULL = global, có = company).
--    seed_key business key = target_key + checksum + status. RLS+FORCE + policy nullable-tenant TẠO TRƯỚC
--    INSERT. FK seed_batch_id → seed_batches (1 batch n item).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE seed_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_batch_id uuid NOT NULL REFERENCES seed_batches(id) ON DELETE CASCADE,
  company_id    uuid REFERENCES companies(id) ON DELETE CASCADE,
  target_table  varchar(100) NOT NULL,
  target_key    varchar(255) NOT NULL,
  operation     varchar(50) NOT NULL DEFAULT 'Upsert',
  payload       jsonb,
  checksum      varchar(128),
  status        varchar(50) NOT NULL DEFAULT 'Pending',
  target_id     uuid,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- ── RLS TRƯỚC mọi INSERT/backfill (CLAUDE.md §3) — nullable-tenant policy mẫu 0434 ──
ALTER TABLE seed_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE seed_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON seed_items
  USING (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    OR company_id IS NULL
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
  );
--> statement-breakpoint
ALTER TABLE seed_items
  ADD CONSTRAINT chk_seed_items_operation
  CHECK (operation IN ('Insert', 'Update', 'Upsert', 'Delete', 'Skip'));
--> statement-breakpoint
ALTER TABLE seed_items
  ADD CONSTRAINT chk_seed_items_status
  CHECK (status IN ('Pending', 'Success', 'Failed', 'Skipped'));
--> statement-breakpoint
-- 1 item / (seed_batch_id, target_table, target_key) — idempotent theo business key (§8.13 constraint).
CREATE UNIQUE INDEX uq_seed_items_batch_target
  ON seed_items (seed_batch_id, target_table, target_key);
--> statement-breakpoint
CREATE INDEX idx_seed_items_target
  ON seed_items (target_table, target_key);
--> statement-breakpoint
CREATE INDEX seed_items_company_id_idx ON seed_items (company_id);
--> statement-breakpoint
-- Tracking mutable (status Pending→Success/Failed). App+worker SELECT/INSERT/UPDATE — KHÔNG DELETE.
GRANT SELECT, INSERT, UPDATE ON seed_items TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON seed_items TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 5a) SEED modules catalog (DB-08 §8.2). ON CONFLICT (uq module_code chưa soft-delete) DO NOTHING —
--     idempotent. AUTH/HR core; ATT/LEAVE operation; TASK collaboration; DASH/NOTI experience — ACTIVE.
--     PAYROLL.. extension — INACTIVE (is_mvp=false). uq_modules_module_code_active là PARTIAL index
--     (WHERE deleted_at IS NULL) ⇒ ON CONFLICT phải chỉ rõ predicate khớp partial index.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO modules (module_code, name, module_group, is_core, is_mvp, is_active, sort_order) VALUES
  ('AUTH',    'Tài khoản & phân quyền',     'Core',          true,  true,  true,   1),
  ('HR',      'Quản lý nhân sự',            'Core',          true,  true,  true,   2),
  ('ATT',     'Chấm công',                  'Operation',     false, true,  true,   3),
  ('LEAVE',   'Nghỉ phép',                  'Operation',     false, true,  true,   4),
  ('TASK',    'Công việc & Dự án',          'Collaboration', false, true,  true,   5),
  ('DASH',    'Dashboard',                  'Experience',    false, true,  true,   6),
  ('NOTI',    'Thông báo hệ thống',         'Experience',    false, true,  true,   7),
  ('PAYROLL', 'Tiền lương',                 'Extension',     false, false, false,  8),
  ('RECRUIT', 'Tuyển dụng',                 'Extension',     false, false, false,  9),
  ('ASSET',   'Tài sản',                    'Extension',     false, false, false, 10),
  ('ROOM',    'Phòng họp',                  'Extension',     false, false, false, 11),
  ('CHAT',    'Chat nội bộ',                'Extension',     false, false, false, 12),
  ('SOCIAL',  'Mạng xã hội nội bộ',         'Extension',     false, false, false, 13),
  ('MOBILE',  'Mobile app',                 'Extension',     false, false, false, 14),
  ('AI',      'AI & tích hợp',              'Extension',     false, false, false, 15)
ON CONFLICT (module_code) WHERE deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 5b) SEED system_settings defaults (DB-08 §8.3). Global default toàn hệ thống (no company_id). ON CONFLICT
--     (uq_system_settings_key_active = setting_key WHERE status='Active') DO NOTHING — idempotent. Mọi
--     setting is_public=true (FE đọc an toàn), is_sensitive=false. setting_value = jsonb.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO system_settings
  (setting_key, setting_value, value_type, category, module_code, description, is_public, is_sensitive, status)
VALUES
  ('file.max_upload_size_mb',     '25'::jsonb,
     'Number',  'File',   'SYSTEM', 'Dung lượng tối đa mỗi file upload (MB)',                 true,  false, 'Active'),
  ('file.allowed_mime_types',     '["image/png","image/jpeg","image/webp","application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","text/csv","text/plain"]'::jsonb,
     'Array',   'File',   'SYSTEM', 'Danh sách MIME type cho phép upload (server-side allowlist)', true, false, 'Active'),
  ('system.default_timezone',     '"Asia/Ho_Chi_Minh"'::jsonb,
     'String',  'General','SYSTEM', 'Timezone mặc định (UTC-at-rest; hiển thị theo TZ này — ADR-0008)', true, false, 'Active'),
  ('system.default_locale',       '"vi"'::jsonb,
     'String',  'General','SYSTEM', 'Locale mặc định (react-i18next)',                        true,  false, 'Active'),
  ('audit.default_retention_days','365'::jsonb,
     'Number',  'Audit',  'SYSTEM', 'Số ngày giữ audit log mặc định trước khi cleanup/archive',  true,  false, 'Active')
ON CONFLICT (setting_key) WHERE status = 'Active' DO NOTHING;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 5c) SEED Foundation permission catalog. Ánh xạ API-09 FOUNDATION.RESOURCE.ACTION → (action,
--     resource_type) engine. resource namespace 'foundation-<resource>' để KHÔNG đụng resource cũ
--     (company/audit-log/file...). is_sensitive=TRUE cho quyền cấp System/cross-tenant/quản trị
--     retention/seed/job (cổng nhạy cảm — KHÔNG kế thừa qua wildcard, mẫu 0430). ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  -- Company
  ('view',           'foundation-company',         false),
  ('update',         'foundation-company',         false),
  -- Module catalog
  ('view',           'foundation-module',          false),
  ('update',         'foundation-module',          true),
  -- Settings
  ('view',           'foundation-setting',         false),
  ('update',         'foundation-setting',         false),
  ('system-manage',  'foundation-setting',         true),
  -- Audit log
  ('view',           'foundation-audit-log',       false),
  ('export',         'foundation-audit-log',       false),
  -- File
  ('upload',         'foundation-file',            false),
  ('view',           'foundation-file',            false),
  ('download',       'foundation-file',            false),
  ('delete',         'foundation-file',            false),
  ('link',           'foundation-file',            false),
  ('unlink',         'foundation-file',            false),
  ('view',           'foundation-file-access-log', false),
  -- Sequence
  ('view',           'foundation-sequence',        false),
  ('update',         'foundation-sequence',        false),
  -- Holiday
  ('view',           'foundation-holiday',         false),
  ('manage',         'foundation-holiday',         false),
  -- Retention
  ('view',           'foundation-retention',       false),
  ('manage',         'foundation-retention',       true),
  -- Job
  ('view',           'foundation-job',             false),
  ('run',            'foundation-job',             true),
  -- Seed
  ('view',           'foundation-seed',            true),
  ('run',            'foundation-seed',            true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- Grant company-admin (role 0001) các quyền Foundation KHÔNG nhạy cảm (mẫu 0005 — System-scope/cross-tenant
-- nhạy cảm KHÔNG seed cho role; cấp tường minh per-user). ON CONFLICT DO NOTHING (idempotent / hot-file).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.is_sensitive = false
  AND p.resource_type LIKE 'foundation-%'
ON CONFLICT DO NOTHING;

-- -------- Down (manual) --------
-- DELETE FROM role_permissions WHERE permission_id IN
--   (SELECT id FROM permissions WHERE resource_type LIKE 'foundation-%');
-- DELETE FROM permissions WHERE resource_type LIKE 'foundation-%';
-- DELETE FROM system_settings WHERE setting_key IN
--   ('file.max_upload_size_mb','file.allowed_mime_types','system.default_timezone',
--    'system.default_locale','audit.default_retention_days');
-- DELETE FROM modules WHERE module_code IN
--   ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','PAYROLL','RECRUIT','ASSET','ROOM','CHAT','SOCIAL','MOBILE','AI');
-- DROP TABLE IF EXISTS seed_items;
-- DROP TABLE IF EXISTS seed_batches;
-- DROP TABLE IF EXISTS data_retention_policies;
-- DROP TABLE IF EXISTS modules;
