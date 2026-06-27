-- Migration 0431: FOUNDATION-DB-1 (🔴 RED) — system_settings + company_settings theo DB-08 §8.3/8.4.
-- Gate: FULL (security-reviewer [RLS] + database-reviewer + silent-failure-hunter).
--
-- BAND 0431 (lane foundation-db). idx 114, when 1717500490000 (> head 0430 idx 113 / when 1717500480000).
-- Nối tiếp ĐƠN ĐIỆU sau head 0430_acct2_admin_user_admin_perms.
--
-- MỤC TIÊU (Foundation settings — 2 tầng precedence company → system, BACKEND-11 §13.3):
--   • system_settings  : cấu hình GLOBAL/default toàn hệ thống (KHÔNG company_id) — mirror permissions/
--                        system_modules (no-RLS, app SELECT/INSERT/UPDATE; ghi chủ yếu qua seed/admin System).
--   • company_settings : override theo công ty (company_id NOT NULL + RLS ENABLE/FORCE + policy tenant_isolation).
--
-- BẤT BIẾN (CLAUDE.md §2/§3):
--   #1 company_settings: company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy USING/WITH CHECK
--      company_id = current_setting('app.current_company_id') — TẠO TRƯỚC mọi INSERT/backfill (WO này KHÔNG seed;
--      seed default settings là FOUNDATION-DB-5). Policy tương thích set_config(...,true) PgBouncer txn-mode.
--   #2 settings KHÔNG phải audit/snapshot → KHÔNG append-only. Mutable config: app role giữ UPDATE.
--      Xoá = soft-delete (company_settings.deleted_at) / status=Inactive (system_settings) — KHÔNG hard-delete,
--      app role KHÔNG có quyền DELETE trên 2 bảng này.
--   #5 UUID PK + timestamptz UTC-at-rest (ADR-0008).
--   §5.3 system_settings là dữ liệu system-level (company_id = NULL path) — KHÔNG đặt company_id, KHÔNG bật RLS
--      (mirror catalog toàn cục); chỉ truy cập/ghi qua System scope. KHÔNG rò chéo tenant (không có cột tenant).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 1) system_settings — cấu hình GLOBAL/default (DB-08 §8.3). KHÔNG company_id ⇒ no-RLS (mirror 0330
--    system_modules / 0005 permissions). Tự loại khỏi rls-registry vì không có company_id.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE system_settings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key       varchar(150) NOT NULL,
  setting_value     jsonb NOT NULL,
  value_type        varchar(50) NOT NULL,
  category          varchar(100) NOT NULL,
  module_code       varchar(50),
  description        text,
  is_public         boolean NOT NULL DEFAULT false,
  is_sensitive      boolean NOT NULL DEFAULT false,
  is_encrypted      boolean NOT NULL DEFAULT false,
  secret_ref        varchar(255),
  validation_schema jsonb,
  effective_from    timestamptz,
  effective_to      timestamptz,
  status            varchar(50) NOT NULL DEFAULT 'Active',
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES users(id) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE system_settings
  ADD CONSTRAINT chk_system_settings_value_type
  CHECK (value_type IN ('String', 'Number', 'Boolean', 'JSON', 'Array', 'SecretRef'));
--> statement-breakpoint
ALTER TABLE system_settings
  ADD CONSTRAINT chk_system_settings_status
  CHECK (status IN ('Active', 'Inactive'));
--> statement-breakpoint
-- 1 setting_key Active duy nhất ở cấp hệ thống (DB-08 §8.3 constraint).
CREATE UNIQUE INDEX uq_system_settings_key_active
  ON system_settings (setting_key)
  WHERE status = 'Active';
--> statement-breakpoint
CREATE INDEX idx_system_settings_category
  ON system_settings (category, module_code, status);
--> statement-breakpoint
-- Mutable config (đọc precedence + admin System cập nhật). App SELECT/INSERT/UPDATE — KHÔNG DELETE (soft via
-- status=Inactive). Worker SELECT (đọc default cho job nền). Ghi chủ yếu qua seed/admin; KHÔNG append-only.
GRANT SELECT, INSERT, UPDATE ON system_settings TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON system_settings TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 2) company_settings — override theo công ty (DB-08 §8.4). RLS+FORCE + policy tenant_isolation TẠO TRƯỚC
--    mọi INSERT (CLAUDE.md §3). company_id NOT NULL DEFAULT current_setting (mẫu 0420 project_states / 0380).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE company_settings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL
                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies(id) ON DELETE CASCADE,
  setting_key       varchar(150) NOT NULL,
  setting_value     jsonb NOT NULL,
  value_type        varchar(50) NOT NULL,
  category          varchar(100) NOT NULL,
  module_code       varchar(50),
  description        text,
  is_public         boolean NOT NULL DEFAULT false,
  is_sensitive      boolean NOT NULL DEFAULT false,
  is_encrypted      boolean NOT NULL DEFAULT false,
  secret_ref        varchar(255),
  validation_schema jsonb,
  effective_from    timestamptz,
  effective_to      timestamptz,
  status            varchar(50) NOT NULL DEFAULT 'Active',
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at        timestamptz,
  deleted_by        uuid REFERENCES users(id) ON DELETE SET NULL
);
--> statement-breakpoint
-- ── RLS TRƯỚC mọi INSERT/backfill (CLAUDE.md §3) ──
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON company_settings
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE company_settings
  ADD CONSTRAINT chk_company_settings_value_type
  CHECK (value_type IN ('String', 'Number', 'Boolean', 'JSON', 'Array', 'SecretRef'));
--> statement-breakpoint
ALTER TABLE company_settings
  ADD CONSTRAINT chk_company_settings_status
  CHECK (status IN ('Active', 'Inactive'));
--> statement-breakpoint
-- 1 setting_key Active duy nhất / company, chỉ tính hàng chưa soft-delete (DB-08 §8.4 constraint).
CREATE UNIQUE INDEX uq_company_settings_key_active
  ON company_settings (company_id, setting_key)
  WHERE deleted_at IS NULL AND status = 'Active';
--> statement-breakpoint
CREATE INDEX idx_company_settings_company_category
  ON company_settings (company_id, category, module_code, status)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX company_settings_company_id_idx ON company_settings (company_id);
--> statement-breakpoint
-- Mutable config + soft-delete (deleted_at). App SELECT/INSERT/UPDATE — KHÔNG DELETE (BẤT BIẾN #2 soft-delete).
GRANT SELECT, INSERT, UPDATE ON company_settings TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON company_settings TO mediaos_worker;

-- -------- Down (manual) --------
-- DROP TABLE IF EXISTS company_settings;
-- DROP TABLE IF EXISTS system_settings;
