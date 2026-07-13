-- Migration 0494: HR-IDENTITY-READ-1 (🔴 RED, zone=red, crown) — seed cặp quyền NHẠY CẢM MỚI
--   ('view-identity','employee', is_sensitive=true) + grant per-(role,action,resource,scope) TƯỜNG MINH.
--   Mở surface đọc CMND/CCCD (identity_number/identity_issue_date/identity_issue_place — cột đã có từ 0451)
--   qua gate riêng, TÁCH khỏi view-sensitive:employee (lương/PII khác). THUẦN DATA — INSERT catalog +
--   DO-block grant, KHÔNG DDL, KHÔNG RLS/FORCE, KHÔNG db:generate (DO-block thủ công mirror 0444).
--
-- VÌ SAO WO NÀY (fail-closed + parity view-sensitive):
--   • is_sensitive=true ⇒ PermissionService fail-closed: chỉ grant EXACT (action,resource_type) mới thoả;
--     grant wildcard '*:*' KHÔNG kế thừa cặp nhạy cảm (permissions.ts "must be granted per-user only").
--   • Tập grant = MIRROR view-sensitive:employee của 0444 §13 (dòng 104-106): employee=Own (self),
--     hr=Company, company-admin=Company. manager KHÔNG có (không đọc giấy tờ tuỳ thân team).
--   • 'employee' đã là object_type audit hợp lệ (từ view-salary/view-sensitive) ⇒ KHÔNG cần audit CHECK mới.
--
-- BỐI CẢNH (INSERT/DO-block qua migrator owner, KHÔNG qua app role — mirror 0444/0492):
--   permissions = catalog GLOBAL, KHÔNG có company_id ⇒ KHÔNG RLS. App role CHỈ có GRANT SELECT (mig 0005,
--   không UPDATE/DELETE). Migrator chạy DATABASE_DIRECT_URL = role owner mediaos ⇒ INSERT/DELETE catalog +
--   role_permissions chạy tại migrate-time. Runtime app role KHÔNG sửa được — BẤT BIẾN #2/#3 giữ.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 KHÔNG đụng cô lập tenant: permissions/role_permissions catalog GLOBAL không company_id/RLS; migration
--      KHÔNG tạo/sửa policy, KHÔNG backfill company_id. RLS+FORCE bảng nghiệp vụ đã bật ở migration riêng.
--   #2 KHÔNG hard-delete dữ liệu, KHÔNG blanket DELETE theo role_id: chỉ DELETE ĐÚNG BỘ
--      (role_id,permission_id,'ALLOW') có data_scope SAI (per-pair) rồi INSERT lại scope §13 → giữ grant
--      khác/role khác. App role KHÔNG có UPDATE role_permissions ⇒ đổi scope = DELETE+INSERT (mirror 0444).
--   #3 Idempotent đo BỘ BA (role_id, permission_id, data_scope): chạy lại = no-op (DELETE-wrong-scope không
--      khớp gì + INSERT trúng ON CONFLICT). Catalog INSERT ON CONFLICT(action,resource_type) DO NOTHING.
--   ⛔ KHÔNG CROSS JOIN (bài học blanket-grant drift): mảng grants explicit ĐÚNG 3 hàng, KHÔNG phẳng role.
--
-- BAND 0494 (lane mig-identity-perm / HR-IDENTITY-READ-1). Journal: idx 174, when 1717500865000
--   (> head THẬT 0493_s4_dashcatalog2 idx 173 / 1717500860000). Nối tiếp ĐƠN ĐIỆU sau head.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) Catalog cặp quyền MỚI ('view-identity','employee', is_sensitive=true). ON CONFLICT(action,
--     resource_type) DO NOTHING (hot-file UNION — cặp đã có KHÔNG nhân đôi). view-identity KHÁC
--     view-sensitive (salary/PII chung) — cặp MỚI, KHÔNG alias.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('view-identity', 'employee', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (b) Seed role_permissions THEO TỪNG CẶP (role, action, resource_type) = data_scope. Mảng EXPLICIT
--     ĐÚNG 3 hàng mirror view-sensitive:employee (0444 §13): employee=Own, hr=Company, company-admin=
--     Company. manager KHÔNG có. DO-block: resolve role_id + permission_id, (d) DELETE đúng bộ
--     (role_id,permission_id,'ALLOW') data_scope <> target (per-pair, KHÔNG blanket), (c) INSERT lại
--     scope ON CONFLICT(role_id,permission_id,effect) DO NOTHING. Idempotent bộ-ba: lần 2 = no-op.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- (role_name, action, resource_type, data_scope) — mirror view-sensitive:employee 0444.
  --   employee=Own (self), hr=Company, company-admin=Company. manager KHÔNG (không có hàng).
  grants CONSTANT text[][] := ARRAY[
    ['employee',      'view-identity', 'employee', 'Own'],
    ['hr',            'view-identity', 'employee', 'Company'],
    ['company-admin', 'view-identity', 'employee', 'Company']
  ];
  g           text[];
  v_role_id   uuid;
  v_perm_id   uuid;
  v_seeded    int := 0;
  v_rescoped  int := 0;
  v_del       int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY grants LOOP
    -- resolve role (system role canonical: company_id NULL, không xoá mềm)
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0494] role canonical % không tồn tại — seed 0444 (b) phải chạy trước', g[1];
    END IF;

    -- resolve permission (catalog (a) vừa INSERT ở trên)
    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0494] permission (%:%) không có trong catalog — (a) phải chạy trước', g[2], g[3];
    END IF;

    -- (d) DELETE đúng bộ (role_id, permission_id, 'ALLOW') có scope SAI (per-pair, KHÔNG blanket).
    --     Chỉ xoá khi data_scope KHÁC target → giữ idempotent + KHÔNG đụng cặp khác/role khác.
    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW'
       AND data_scope <> g[4];
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    -- (c) INSERT lại scope. ON CONFLICT(role_id,permission_id,effect) DO NOTHING → idempotent.
    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', g[4])
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0494] view-identity:employee seed: % cặp INSERT mới, % cặp re-scope (DELETE wrong-scope+INSERT)',
    v_seeded, v_rescoped;
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id
--     AND r.name IN ('employee','hr','company-admin') AND r.company_id IS NULL
--     AND (p.action,p.resource_type) = ('view-identity','employee');
-- DELETE FROM permissions WHERE (action,resource_type) = ('view-identity','employee');
