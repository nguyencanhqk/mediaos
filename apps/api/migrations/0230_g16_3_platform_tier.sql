-- Migration 0230: G16-3 SaaS prep — PLATFORM tier (workspace/company management above company-admin).
-- Gate: FULL (security-reviewer [cross-tenant RLS escape-hatch] + database-reviewer + silent-failure-hunter + santa).
--
-- BAND 0230-0239 (lane g16 — SaaS prep tràn band; band gốc 0120-0129 đã dùng G16-1/G16-2). Hook
--   guard-migration-band cập nhật BANDS.g16 = [[120,129],[230,239]] (multi-range như G12). TASKS.md §5.2.
-- Journal: idx 91, when 1717500260000 (> high-water 250000 của 0221) khi land — RECONCILE theo master max.
--
-- MỤC TIÊU: tầng platform-admin quản trị VÒNG ĐỜI tenant (tạo/đình chỉ/cấu hình/list mọi công ty) — cao
--   hơn company-admin (chỉ quản công ty của mình). `companies` ĐÃ tồn tại (0002) — đây là tầng QUẢN LÝ.
--
-- THIẾT KẾ TENANCY (ADR-0017): tầng platform cần truy cập CHÉO tenant, nhưng `companies` có FORCE RLS
--   keyed `id = app.current_company_id`. Giải pháp: thêm GUC escape-hatch `app.platform_admin` CHỈ cho
--   policy `companies` (default-DENY: GUC chưa set ⇒ '' = 'on' là false ⇒ KHÔNG bypass). `withPlatformContext`
--   (db.service.ts) set GUC này (LOCAL) cho ĐÚNG 1 thao tác KHÔNG có ngữ cảnh tenant: LIST mọi công ty.
--   CREATE dùng id tự sinh + `withTenant(newId)` (insert+provision+audit ATOMIC, không cần hatch). Mọi
--   thao tác khác (get-one/suspend/configure/set-plan + AUDIT) chạy `withTenant(targetCompanyId)` BÌNH
--   THƯỜNG — KHÔNG mở rộng escape-hatch sang bảng nghiệp vụ nào khác.
--   Audit công ty ở tầng platform TÁI DÙNG object_type 'company' (action mới: CompanyProvisioned/...).
--
-- BẤT BIẾN: #1 escape-hatch default-deny + chỉ 1 bảng (companies) + RLS mọi bảng khác nguyên vẹn.
--   #2 không hard-delete (suspend = status, soft-delete = deleted_at). #3 không secret (không có ở đây).

-- ── Seed: permissions catalog cho tầng platform (is_sensitive=TRUE — wildcard *:* KHÔNG kế thừa) ──────
-- App role SELECT-only trên `permissions` (0005). Sensitive ⇒ chỉ role được GRANT TƯỜNG MINH mới qua cổng
-- (permission.service.ts §sensitive gate). ON CONFLICT idempotent (re-run an toàn).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('view',   'platform-company',      true),
  ('manage', 'platform-company',      true),
  ('apply',  'platform-template',     true),
  ('manage', 'platform-subscription', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ── Seed: system role `platform-admin` (company_id NULL, is_system) ──────────────────────────────────
-- UUID cố định nối tiếp dải system-role 0005 (…001..008).
-- AC-0b (operator-auth boundary): requires_two_factor=TRUE — role god-mode chéo tenant (control plane)
--   BẮT BUỘC 2FA. TwoFactorEnforcementGuard DENY mọi operator chưa enroll TOTP (code
--   TWO_FACTOR_SETUP_REQUIRED). Harness test/e2e giữ xanh bằng PRE-ENROLL operator (seedTwoFactorEnabled),
--   KHÔNG dùng kill-switch TWO_FACTOR_ENFORCEMENT_ENABLED để giấu. INSERT mới (fresh DB) lấy giá trị này;
--   DB dài-hạn đã chạy 0230 cũ hội tụ qua UPDATE ở demo-seed/bootstrap (xem demo-seed-dashboard.mjs).
INSERT INTO roles (id, company_id, name, description, is_system, requires_two_factor) VALUES
  ('00000000-0000-0000-0000-0000000000f0', NULL, 'platform-admin',
   'Platform operator: manage tenant lifecycle across all companies (SaaS control plane)', true, true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- AC-0b: hội tụ DB dài-hạn đã seed role …f0 với requires_two_factor=false TRƯỚC bản vá này. ON CONFLICT
-- DO NOTHING ở trên KHÔNG cập nhật cờ cho row đã tồn tại → UPDATE tường minh (idempotent, an toàn re-run).
UPDATE roles SET requires_two_factor = true
  WHERE id = '00000000-0000-0000-0000-0000000000f0' AND requires_two_factor IS DISTINCT FROM true;
--> statement-breakpoint

-- Grant 4 platform permissions cho platform-admin TƯỜNG MINH (sensitive ⇒ explicit non-wildcard ALLOW).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-0000000000f0', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (
    ('view',   'platform-company'),
    ('manage', 'platform-company'),
    ('apply',  'platform-template'),
    ('manage', 'platform-subscription')
  )
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ── RLS escape-hatch trên `companies` (chỉ bảng này) ────────────────────────────────────────────────
-- Policy gốc (0002) chỉ cho `id = app.current_company_id`. Thêm nhánh OR `app.platform_admin = 'on'` để
-- `withPlatformContext` thấy/ghi CHÉO tenant. DEFAULT-DENY: cả 2 GUC chưa set ⇒ USING/CHECK đều false ⇒
-- 0 row (company-admin thường vẫn CHỈ thấy công ty mình; không có platform context ⇒ KHÔNG rò chéo).
-- current_setting(...,true) = missing_ok (NULL khi chưa set) ⇒ 'NULL = on' là NULL ⇒ false. An toàn.
DROP POLICY IF EXISTS companies_tenant_isolation ON companies;
--> statement-breakpoint
CREATE POLICY companies_tenant_isolation ON companies
  USING (
    id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );
--> statement-breakpoint

-- (Audit object_type KHÔNG đổi ở 0230 — company lifecycle tầng platform TÁI DÙNG 'company'.)

-- -------- Down (manual) --------
-- DELETE FROM role_permissions WHERE role_id = '00000000-0000-0000-0000-0000000000f0';
-- DELETE FROM roles WHERE id = '00000000-0000-0000-0000-0000000000f0';
-- DELETE FROM permissions WHERE resource_type IN ('platform-company','platform-template','platform-subscription');
-- DROP POLICY companies_tenant_isolation ON companies; CREATE POLICY ... (restore 0002 single-tenant form).
