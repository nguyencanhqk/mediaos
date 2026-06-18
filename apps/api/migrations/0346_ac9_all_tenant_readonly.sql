-- Migration 0346: AC-9 WAVE 3 Tầng 3 (🔴 CROWN-JEWEL) — all-tenant data browse qua role DB read-only.
-- Gate: FULL (security-reviewer + database-reviewer + silent-failure-hunter + santa). ADR-0021.
--
-- BAND 0345-0349 (lane ac9). Journal: idx 104, when 1717500390000 (> high-water 380000 = 0345_ac9_db_ops)
--   — RECONCILE theo master max mỗi rebase. Hook guard-migration-band: BANDS.ac9 = [[345,349]].
--
-- MỤC TIÊU: operator (platform-admin, aud=operator) quét dữ liệu XUYÊN MỌI TENANT (không biết target id
--   trước) trên bảng allowlist data-browser, qua role DB read-only `mediaos_readonly` — KHÔNG BYPASSRLS,
--   KHÔNG GUC escape-hatch mới, KHÔNG pool/credential mới. Hiện thực Tầng 3 của ADR-0019 mà ADR-0020 §19 hoãn.
--
-- THIẾT KẾ (ADR-0021):
--   1. Role `mediaos_readonly` NOSUPERUSER NOBYPASSRLS NOLOGIN — chỉ tiếp cận qua SET LOCAL ROLE từ
--      mediaos_app trong 1 transaction (helper withAllTenantReadContext). NOBYPASSRLS ⇒ vẫn lọt
--      assertWorkerRoleSafe; NOLOGIN ⇒ không connection trực tiếp.
--   2. Per-bảng allowlist: policy `FOR SELECT TO mediaos_readonly USING (true)` (read-only, KHÔNG WITH CHECK)
--      — mirror tiền lệ mediaos_worker đọc all-tenant outbox (mig 0003). RLS OR-combine với *_tenant_isolation
--      (TO PUBLIC, GUC chưa set ⇒ false) ⇒ thấy mọi row. Bảng KHÔNG có policy cho role ⇒ default-deny 0 row.
--   3. GRANT SELECT THEO CỘT (column-scoped) — CHỈ cột allowlist (BẤT BIẾN #3): secret/PII (password_hash,
--      secret_ciphertext, lương, totp...) ungettable Ở TẦNG QUYỀN DB, không chỉ tầng app projection.
--   4. Permission `read:db-all-tenant` (is_sensitive=TRUE) + grant platform-admin …f0.
--
-- ĐỒNG BỘ allowlist ↔ policy (ADR-0021 §Hệ quả): thêm bảng vào DB_BROWSER_ALLOWLIST ⇒ PHẢI thêm policy +
--   column-GRANT ở đây, nếu không browse-all bảng đó = 0 row (fail-closed). Test coverage canh drift.

-- ===== 1. Role read-only chuyên dụng (idempotent — role là cluster-global, mirror 0001) =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mediaos_readonly') THEN
    CREATE ROLE mediaos_readonly WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END $$;
--> statement-breakpoint
-- Re-assert cờ an toàn (mirror 0001 — chống role bị ALTER lỏng ở môi trường cũ). KHÔNG BAO GIỜ LOGIN/BYPASSRLS.
-- NOINHERIT (defense-in-depth): nếu sau này lỡ GRANT 1 role mạnh TO mediaos_readonly, nó KHÔNG tự kế thừa
-- đặc quyền đó (chỉ dùng được qua SET ROLE tường minh). Privilege/policy cấp TRỰC TIẾP cho role (column-SELECT
-- + policy TO mediaos_readonly) KHÔNG bị NOINHERIT ảnh hưởng ⇒ đường đọc all-tenant vẫn chạy.
ALTER ROLE mediaos_readonly WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO mediaos_readonly;
--> statement-breakpoint
-- mediaos_app được SET LOCAL ROLE mediaos_readonly (helper withAllTenantReadContext). KHÔNG cấp cho role khác.
-- ⚠️ WITH INHERIT FALSE (BẮT BUỘC — BẤT BIẾN #1): nếu INHERIT (mặc định), mediaos_app KẾ THỪA policy
--   `*_all_tenant_read USING(true)` của mediaos_readonly (RLS dùng has_privs_of_role, TÔN TRỌNG inherit) ⇒
--   mọi query mediaos_app thấy CHÉO tenant ⇒ VỠ tenant-isolation. INHERIT FALSE: vẫn SET ROLE được
--   (SET ROLE dùng is_member_of_role, BỎ QUA inherit), nhưng KHÔNG kế thừa policy thụ động — chỉ thấy
--   all-tenant SAU khi SET ROLE tường minh (trong withAllTenantReadContext). PG16+.
GRANT mediaos_readonly TO mediaos_app WITH INHERIT FALSE;
--> statement-breakpoint

-- ===== 2+3. Per-bảng allowlist: column-GRANT SELECT + policy all-tenant read =====
-- Cột PHẢI khớp DB_BROWSER_ALLOWLIST (packages/contracts/db-ops-allowlist.ts). GRANT cột sai = migration FAIL
-- (fail-fast). Policy đặt tên `<bảng>_all_tenant_read` (không đụng `<bảng>_tenant_isolation` sẵn có).

-- companies (bảng gốc — không company_id; id = tenant).
GRANT SELECT (id, name, slug, status, timezone, created_at, updated_at)
  ON companies TO mediaos_readonly;
--> statement-breakpoint
CREATE POLICY companies_all_tenant_read ON companies
  FOR SELECT TO mediaos_readonly USING (true);
--> statement-breakpoint

-- users
GRANT SELECT (id, company_id, email, full_name, status, created_at, updated_at)
  ON users TO mediaos_readonly;
--> statement-breakpoint
CREATE POLICY users_all_tenant_read ON users
  FOR SELECT TO mediaos_readonly USING (true);
--> statement-breakpoint

-- org_units
GRANT SELECT (id, company_id, name, parent_id, type, code, status, created_at, updated_at)
  ON org_units TO mediaos_readonly;
--> statement-breakpoint
CREATE POLICY org_units_all_tenant_read ON org_units
  FOR SELECT TO mediaos_readonly USING (true);
--> statement-breakpoint

-- teams
GRANT SELECT (id, company_id, name, org_unit_id, code, status, created_at, updated_at)
  ON teams TO mediaos_readonly;
--> statement-breakpoint
CREATE POLICY teams_all_tenant_read ON teams
  FOR SELECT TO mediaos_readonly USING (true);
--> statement-breakpoint

-- projects
GRANT SELECT (id, company_id, name, code, org_unit_id, priority, status, created_at, updated_at)
  ON projects TO mediaos_readonly;
--> statement-breakpoint
CREATE POLICY projects_all_tenant_read ON projects
  FOR SELECT TO mediaos_readonly USING (true);
--> statement-breakpoint

-- channels
GRANT SELECT (id, company_id, name, platform, code, niche, health_status, status, created_at, updated_at)
  ON channels TO mediaos_readonly;
--> statement-breakpoint
CREATE POLICY channels_all_tenant_read ON channels
  FOR SELECT TO mediaos_readonly USING (true);
--> statement-breakpoint

-- content_items
GRANT SELECT (id, company_id, title, code, project_id, production_status, status, created_at, updated_at)
  ON content_items TO mediaos_readonly;
--> statement-breakpoint
CREATE POLICY content_items_all_tenant_read ON content_items
  FOR SELECT TO mediaos_readonly USING (true);
--> statement-breakpoint

-- tasks
GRANT SELECT (id, company_id, title, task_type, status, assignee_user_id, project_id, created_at, updated_at)
  ON tasks TO mediaos_readonly;
--> statement-breakpoint
CREATE POLICY tasks_all_tenant_read ON tasks
  FOR SELECT TO mediaos_readonly USING (true);
--> statement-breakpoint

-- ===== 4. Permission seed (is_sensitive=TRUE — wildcard *:* KHÔNG kế thừa) =====
-- read:db-all-tenant = all-tenant data browse read-only (WAVE 3 C1). Tách khỏi read:db-browser (tenant-scoped)
-- để có thể grant/deny độc lập (all-tenant = blast-radius cao hơn).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('read', 'db-all-tenant', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint
-- Grant cho platform-admin (…f0) TƯỜNG MINH (Operator tier).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-0000000000f0', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (('read','db-all-tenant'))
ON CONFLICT DO NOTHING;

-- -------- Down (manual) --------
-- DROP POLICY companies_all_tenant_read ON companies;  -- (+ users/org_units/teams/projects/channels/content_items/tasks)
-- REVOKE SELECT ON companies, users, org_units, teams, projects, channels, content_items, tasks FROM mediaos_readonly;
-- REVOKE mediaos_readonly FROM mediaos_app;
-- REVOKE USAGE ON SCHEMA public FROM mediaos_readonly;
-- DROP ROLE mediaos_readonly;
-- DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE resource_type='db-all-tenant');
-- DELETE FROM permissions WHERE resource_type='db-all-tenant';
