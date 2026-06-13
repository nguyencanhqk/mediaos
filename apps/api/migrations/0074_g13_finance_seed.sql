-- Migration 0074: G13-4 — seed catalog quyền expense-request + system role finance-manager + grants.
-- Journal: wire khi land (xem MERGE NOTE 0070). KHÔNG bảng mới, KHÔNG đổi RLS. permissions = catalog toàn
-- cục (không company_id). ON CONFLICT DO NOTHING (idempotent).
--
-- ⚠️ finance perms (create/read/update/delete:finance non-sensitive + view-finance:finance SENSITIVE) ĐÃ
--    seed ở 0005. company-admin (…0001) đã có MỌI non-sensitive qua wildcard 0005 → đã có 4 quyền finance.
-- ⚠️ Catalog vs grant TÁCH: can() đọc role_permissions/object_permissions, KHÔNG tra catalog. Seed catalog
--    expense-request 1 mình KHÔNG mở khoá; 0005 grant company-admin chạy MỘT LẦN ở idx 5 → KHÔNG hồi tố
--    quyền thêm sau → PHẢI grant expense-request cho company-admin TAY ở đây (mirror 0036/0019).
-- ⚠️ SPELLING HYPHEN `expense-request` — khớp byte-identical @RequirePermission ở expenses.controller.ts.

-- 1. Catalog — 3 quyền expense-request (đều non-sensitive: số tiền expense KHÔNG mask với người liên quan).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('create',  'expense-request', false),
  ('read',    'expense-request', false),
  ('approve', 'expense-request', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- 2. System role finance-manager (…000a). company_id = NULL, is_system = true (mirror 0019 hr-manager).
INSERT INTO roles (id, company_id, name, description, is_system) VALUES
  ('00000000-0000-0000-0000-00000000000a', NULL, 'finance-manager',
   'Finance manager: full finance ledger management + view-finance (sensitive) + approve expense', true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 3. Grant non-sensitive finance + expense-request cho finance-manager (…000a).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-00000000000a', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type IN ('finance', 'expense-request')
  AND p.is_sensitive = false
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 4. Grant view-finance (SENSITIVE) TƯỜNG MINH cho finance-manager. Wildcard KHÔNG đủ cho is_sensitive
--    (ADR-0010). Đây là quyền lộ số tiền sổ cái (reveal ⟹ audit).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-00000000000a', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type = 'finance'
  AND p.action = 'view-finance'
  AND p.is_sensitive = true
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 5. Grant expense-request (non-sensitive MỚI) cho company-admin (…0001) — 0005 wildcard không hồi tố.
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type = 'expense-request'
  AND p.is_sensitive = false
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 6. Grant create/read:expense-request cho role 'employee' (…0008) — nhân viên đề xuất chi + xem của mình.
--    KHÔNG grant approve cho employee (chỉ finance-manager/company-admin duyệt).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000008', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type = 'expense-request'
  AND p.action IN ('create', 'read')
ON CONFLICT DO NOTHING;

-- Down: DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE resource_type='expense-request');
--       DELETE FROM roles WHERE id = '00000000-0000-0000-0000-00000000000a';
--       DELETE FROM permissions WHERE resource_type = 'expense-request';
