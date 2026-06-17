-- Migration 0345: AC-9 db-ops (🔴 CROWN-JEWEL, LANE CUỐI) — operator data-ops read-only + break-glass SoD.
-- Gate: FULL (security-reviewer + database-reviewer + silent-failure-hunter + santa) + break-glass review.
--
-- BAND 0345-0349 (lane ac9). Journal: idx 103, when 1717500380000 (> high-water 370000 = 0340_ac8_observability)
--   khi land — RECONCILE theo master max mỗi rebase. Hook guard-migration-band: BANDS.ac9 = [[345,349]].
--
-- MỤC TIÊU (operator-only, platform-admin, CHỈ-ĐỌC):
--   P1 Migration status — đọc __drizzle_migrations (global) + đối chiếu _journal.json (read-only, KHÔNG mig).
--   P2 Data browser TENANT-SCOPED — operator chọn 1 target + 1 bảng allowlist → withTenant(target) (RLS ÉP).
--   P3 Break-glass SoD gate (3 bảng dưới) — request → approve (≥2 KHÁC NHAU) → active → revoke, TTL.
--   P4 Export job (scaffold; worker materialize file DEFER).
--
-- THIẾT KẾ TENANCY (ADR-0020, mở rộng 0019 Tầng 1): KHÔNG GUC mới · KHÔNG BYPASSRLS · KHÔNG mở rộng
--   app.platform_admin. Data-browser chéo-tenant đi qua withTenant(targetCompanyId) — RLS company_id=current
--   ÉP khi current=target. All-tenant scan (Tầng 3 role-DB-read-only) = DEFER (ADR-0020 §Tầng 3).
--
-- 3 BẢNG db_ops_* = GLOBAL no-RLS OPERATOR-SCOPED (dùng target_tenant_id, KHÔNG company_id) ⇒ tự loại khỏi
--   rls-guards/rls-coverage-assert (no company_id) ⇒ KHÔNG vào rls-registry/cleanupTenants. Append-only +
--   frozen cols ép Ở DB qua REVOKE/column-GRANT (giống break-glass column policy, nhưng KHÔNG có RLS).
--
-- SoD ÉP 3 TẦNG (mirror G6-2 0200): UNIQUE(grant_id,approver_user_id) + CHECK(approver<>requester) +
--   CHECK(required_approvals>=2) Ở DB + service COUNT(DISTINCT approver)>=required mới flip 'active'.
--
-- Audit operator-action TÁI DÙNG object_type='company' (action operator.db_read/db_export/db_grant_*) ⇒
--   KHÔNG đổi audit CHECK / schema/audit.ts.

-- ===== db_ops_grants: yêu cầu break-glass db-ops (GLOBAL no-RLS, MUTABLE status FSM, column-grant) =====
CREATE TABLE db_ops_grants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id  uuid NOT NULL REFERENCES users(id),
  -- target tenant null = phạm vi all-tenant (migration-status/export all). KHÔNG company_id (global table).
  target_tenant_id   uuid REFERENCES companies(id) ON DELETE CASCADE,
  reason             text NOT NULL,
  required_approvals int  NOT NULL DEFAULT 2,
  status             text NOT NULL DEFAULT 'pending',
  activated_at       timestamptz,
  revoked_at         timestamptz,
  revoked_by         uuid REFERENCES users(id),
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE db_ops_grants
  ADD CONSTRAINT db_ops_grants_status_check CHECK (status IN ('pending','active','revoked')),
  -- SoD: ngưỡng tối thiểu 2 người duyệt khác nhau (1/0 KHÔNG đủ → không kích hoạt được).
  ADD CONSTRAINT db_ops_grants_required_approvals_check CHECK (required_approvals >= 2),
  -- TTL hợp lệ: hết hạn phải sau lúc tạo.
  ADD CONSTRAINT db_ops_grants_ttl_check CHECK (expires_at > created_at),
  -- active ⇒ có vết kích hoạt.
  ADD CONSTRAINT db_ops_grants_active_pair_check
    CHECK (status <> 'active' OR activated_at IS NOT NULL),
  -- revoked ⇒ có vết thu hồi đầy đủ.
  ADD CONSTRAINT db_ops_grants_revoked_pair_check
    CHECK (status <> 'revoked' OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL));
--> statement-breakpoint
CREATE INDEX db_ops_grants_requester_idx ON db_ops_grants(requester_user_id);
--> statement-breakpoint
-- Tra cứu nhanh grant 'active' CÒN HẠN của 1 requester trên 1 target (data-browser/export gate đọc qua đây).
CREATE INDEX db_ops_grants_active_idx
  ON db_ops_grants(requester_user_id, target_tenant_id)
  WHERE status = 'active';
--> statement-breakpoint
-- App: SELECT/INSERT + UPDATE CHỈ cột vòng đời. KHÔNG cấp UPDATE cột bất biến (requester/target/reason/
-- required_approvals/expires_at) → frozen sau request. REVOKE DELETE (append-history; revoke = status flip).
GRANT SELECT, INSERT ON db_ops_grants TO mediaos_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON db_ops_grants FROM mediaos_app;
--> statement-breakpoint
GRANT UPDATE (status, activated_at, revoked_at, revoked_by, updated_at)
  ON db_ops_grants TO mediaos_app;
--> statement-breakpoint

-- ===== db_ops_grant_approvals: phiếu duyệt (GLOBAL no-RLS, APPEND-ONLY) — SoD ép Ở DB =====
CREATE TABLE db_ops_grant_approvals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id          uuid NOT NULL REFERENCES db_ops_grants(id) ON DELETE CASCADE,
  approver_user_id  uuid NOT NULL REFERENCES users(id),
  -- requester denormalized → CHECK self-approve ép được Ở DB (FK không có ngữ cảnh actor).
  requester_user_id uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Anti duyệt-trùng: 1 người duyệt tối đa 1 lần / grant.
CREATE UNIQUE INDEX db_ops_grant_approvals_grant_approver_uq
  ON db_ops_grant_approvals(grant_id, approver_user_id);
--> statement-breakpoint
CREATE INDEX db_ops_grant_approvals_grant_idx ON db_ops_grant_approvals(grant_id);
--> statement-breakpoint
-- Anti tự-duyệt (SoD) ÉP Ở DB.
ALTER TABLE db_ops_grant_approvals
  ADD CONSTRAINT db_ops_grant_approvals_sod_check CHECK (approver_user_id <> requester_user_id);
--> statement-breakpoint
-- APPEND-ONLY (BẤT BIẾN #2): app SELECT/INSERT, KHÔNG UPDATE/DELETE.
GRANT SELECT, INSERT ON db_ops_grant_approvals TO mediaos_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON db_ops_grant_approvals FROM mediaos_app;
--> statement-breakpoint

-- ===== db_export_jobs: export job (GLOBAL no-RLS, scaffold; worker DEFER) =====
CREATE TABLE db_export_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id uuid NOT NULL REFERENCES users(id),
  target_tenant_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  table_name        text NOT NULL,
  filter            jsonb,
  status            text NOT NULL DEFAULT 'queued',
  row_count         int,
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);
--> statement-breakpoint
ALTER TABLE db_export_jobs
  ADD CONSTRAINT db_export_jobs_status_check
    CHECK (status IN ('queued','running','done','failed','expired'));
--> statement-breakpoint
CREATE INDEX db_export_jobs_requester_idx ON db_export_jobs(requester_user_id);
--> statement-breakpoint
CREATE INDEX db_export_jobs_target_idx ON db_export_jobs(target_tenant_id);
--> statement-breakpoint
-- App: SELECT/INSERT + UPDATE CHỈ cột worker-lifecycle (status/row_count/completed_at). REVOKE DELETE.
GRANT SELECT, INSERT ON db_export_jobs TO mediaos_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON db_export_jobs FROM mediaos_app;
--> statement-breakpoint
GRANT UPDATE (status, row_count, completed_at) ON db_export_jobs TO mediaos_app;
--> statement-breakpoint

-- ===== Permission seed (is_sensitive=TRUE — wildcard *:* KHÔNG kế thừa) =====
-- read:db-browser  = data browser read-only (P2).
-- manage:db-ops    = export + break-glass grant lifecycle (P3/P4).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('read',   'db-browser', true),
  ('manage', 'db-ops',     true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- Grant cho platform-admin (…f0) TƯỜNG MINH (Operator tier, cross-tenant data-ops).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-0000000000f0', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (('read','db-browser'), ('manage','db-ops'))
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ===== Migration-status viewer (P1): app role đọc drizzle.__drizzle_migrations (global, no-RLS) =====
-- MigrationStatusService.readAppliedWhens chạy SELECT created_at FROM drizzle.__drizzle_migrations qua app
-- role (runRaw). Mặc định schema 'drizzle' chỉ owner truy cập ⇒ GRANT USAGE + SELECT (READ-ONLY) cho app.
-- Bảng catalog migration KHÔNG nhạy cảm (chỉ hash + created_at epoch) ⇒ an toàn đọc. KHÔNG cấp ghi.
GRANT USAGE ON SCHEMA drizzle TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON drizzle.__drizzle_migrations TO mediaos_app;
--> statement-breakpoint

-- (Audit object_type KHÔNG đổi — operator.db_read / operator.db_export / operator.db_grant_* TÁI DÙNG 'company'.)

-- -------- Down (manual) --------
-- DROP TABLE db_export_jobs;
-- DROP TABLE db_ops_grant_approvals;
-- DROP TABLE db_ops_grants;
-- DELETE FROM role_permissions WHERE permission_id IN
--   (SELECT id FROM permissions WHERE resource_type IN ('db-browser','db-ops'));
-- DELETE FROM permissions WHERE resource_type IN ('db-browser','db-ops');
