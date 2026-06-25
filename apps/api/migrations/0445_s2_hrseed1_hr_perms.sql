-- Migration 0445: S2-HR-SEED-1 (🔴 RED, zone=red) — seed HR permission gaps + role grants §13/API-10.
--   Nguồn sự thật: docs/plans/S2-HR-SEED-1.md · API-10 PERMISSION MATRIX §5.2/§6.2 · IMPLEMENTATION-05
--   §9.2 (HR-S2-004) §13. NỐI TIẾP 0444 (S2-AUTH-SEED-1) — KHÔNG lặp cặp 0444 đã seed.
--
-- PHẠM VI (chỉ phần CÒN THIẾU so với 0444):
--   HR.DEPARTMENT.UPDATE/DELETE · HR.POSITION.CREATE/UPDATE/DELETE · HR.MASTER_DATA.MANAGE ·
--   HR.EMPLOYEE_CODE.PREVIEW — grant cho hr(…011) + company-admin(…001), data_scope=Company (API-10 §6.2).
--   (read:department/read:position + read/create/update/... :employee + view-sensitive:employee +
--    create:department + create/approve:profile-change-request ĐÃ seed 0444 → KHÔNG đụng.)
--
-- ⛔ KHÔNG seed master-data (job_levels/contract_types/employee_code_configs/department/position):
--   company-scoped (company_id NOT NULL) + KHÔNG có company nào ở migrate-time (companies = tenant runtime,
--   app.current_company_id chưa set). ⇒ SAI TẦNG. Seed master-data per-company = RUNTIME qua
--   SeedTrackingService + withTenant (HR backend lane). Xem plan §1.
--
-- HOT-FILE §9.3 / BẤT BIẾN:
--   • THUẦN ADDITIVE: chỉ INSERT data (permissions / role_permissions). KHÔNG DDL, KHÔNG đụng RLS/FORCE/
--     policy/grant của mig 0005 → BẤT BIẾN #1 GIỮ NGUYÊN. KHÔNG db:generate (DO-block thủ công mirror 0444).
--   • Catalog gaps: INSERT ON CONFLICT(action,resource_type) DO NOTHING — cặp đã có (update/delete:department
--     mig 0005; create/update/delete:position mig 0019) KHÔNG nhân đôi. manage:master-data /
--     preview:employee-code = cặp MỚI.
--   • role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ ON CONFLICT KHÔNG sửa
--     scope. Per-pair: DELETE đúng (role_id,permission_id,'ALLOW') có scope SAI + INSERT lại scope target.
--     ⛔ KHÔNG blanket DELETE theo role_id (mất grant media/foundation parked). App role KHÔNG có UPDATE
--     trên role_permissions (mig 0005:109) — đổi scope phải qua DELETE+INSERT (BẤT BIẾN #2).
--   • Idempotent đo BỘ BA (role_id, permission_id, data_scope): chạy lại = no-op. Target = Company cho mọi
--     cặp ⇒ DELETE-wrong-scope thực tế no-op (cặp mới), INSERT trúng ON CONFLICT.
--   • SENSITIVE (view-salary/update-salary:employee · reveal-secret:platform-account) KHÔNG role-grant
--     cho 4 role canonical (KHÔNG auto qua wildcard) — 7 cặp 0445 đều is_sensitive=false (CRUD/admin
--     thường, mirror quyết định mig 0030 org_unit).
--
-- BAND 0445 (lane S2-HR-SEED-1). Journal: idx 128, when 1717500630000 (> head 0444 idx 127 /
--   1717500620000). Nối tiếp ĐƠN ĐIỆU sau 0444_s2_authseed1_canonical_roles_perms.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) Catalog permission gaps. ON CONFLICT(action,resource_type) DO NOTHING (hot-file UNION).
--     update/delete:department (mig 0005) + create/update/delete:position (mig 0019) ĐÃ có → skip.
--     manage:master-data + preview:employee-code = CẶP MỚI (is_sensitive=false). Dùng resource
--     'department' (KHÔNG 'org_unit') nhất quán với 0444 canonical HR matrix.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  -- HR.DEPARTMENT (write) — đã có ở 0005, INSERT idempotent để self-contained
  ('update',  'department',     false),
  ('delete',  'department',     false),
  -- HR.POSITION (write) — đã có ở 0019, INSERT idempotent để self-contained
  ('create',  'position',       false),
  ('update',  'position',       false),
  ('delete',  'position',       false),
  -- HR.MASTER_DATA.MANAGE — MỚI (job_levels/contract_types quản trị)
  ('manage',  'master-data',    false),
  -- HR.EMPLOYEE_CODE.PREVIEW — MỚI (preview mã NV tiếp theo)
  ('preview', 'employee-code',  false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (b)+(c) Seed role_permissions THEO TỪNG CẶP (role, action, resource_type) = data_scope.
--   Mirror 0444 DO-block: với MỖI hàng, resolve role_id (system role canonical company_id NULL) +
--   permission_id, rồi DELETE đúng bộ (role_id, permission_id, 'ALLOW') có data_scope <> target
--   (per-pair, KHÔNG blanket), rồi INSERT (role_id, permission_id, 'ALLOW', target) ON CONFLICT
--   (role_id,permission_id,effect) DO NOTHING. Toàn bộ 1 transaction (drizzle migrator bọc mỗi file).
--   Idempotent bộ-ba: lần 2 → DELETE-wrong-scope không khớp + INSERT trúng ON CONFLICT = no-op.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- API-10 §6.2: DEPARTMENT.*(write) / POSITION.*(write) / MASTER_DATA.MANAGE / EMPLOYEE_CODE* =
  --   SA · CA · HR(✓). SA = runtime System (KHÔNG ở đây). HR(✓) → seed hr canonical = Company (chuẩn
  --   hóa "nếu được cấp" → mặc định cho role hr). CA = Company. manager/employee KHÔNG (trống §6.2).
  grants CONSTANT text[][] := ARRAY[
    -- HR.DEPARTMENT.UPDATE
    ['hr',            'update',  'department',    'Company'],
    ['company-admin', 'update',  'department',    'Company'],
    -- HR.DEPARTMENT.DELETE
    ['hr',            'delete',  'department',    'Company'],
    ['company-admin', 'delete',  'department',    'Company'],
    -- HR.POSITION.CREATE
    ['hr',            'create',  'position',      'Company'],
    ['company-admin', 'create',  'position',      'Company'],
    -- HR.POSITION.UPDATE
    ['hr',            'update',  'position',      'Company'],
    ['company-admin', 'update',  'position',      'Company'],
    -- HR.POSITION.DELETE
    ['hr',            'delete',  'position',      'Company'],
    ['company-admin', 'delete',  'position',      'Company'],
    -- HR.MASTER_DATA.MANAGE
    ['hr',            'manage',  'master-data',   'Company'],
    ['company-admin', 'manage',  'master-data',   'Company'],
    -- HR.EMPLOYEE_CODE.PREVIEW
    ['hr',            'preview', 'employee-code', 'Company'],
    ['company-admin', 'preview', 'employee-code', 'Company']
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
      RAISE EXCEPTION '[0445] role canonical % không tồn tại — seed 0444/0005 phải chạy trước', g[1];
    END IF;

    -- resolve permission (catalog gap (a) phải đã chạy)
    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0445] permission (%:%) không có trong catalog — seed (a) phải chạy trước', g[2], g[3];
    END IF;

    -- DELETE đúng bộ (role_id, permission_id, 'ALLOW') có scope SAI (per-pair, KHÔNG blanket).
    --   Chỉ xoá khi data_scope KHÁC target → giữ idempotent + KHÔNG đụng cặp/role khác.
    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW'
       AND data_scope <> g[4];
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    -- INSERT lại scope target. ON CONFLICT(role_id,permission_id,effect) DO NOTHING → idempotent.
    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', g[4])
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0445] HR perms seed: % cặp INSERT mới, % cặp re-scope (DELETE wrong-scope+INSERT)',
    v_seeded, v_rescoped;
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id
--     AND r.name IN ('hr','company-admin') AND r.company_id IS NULL
--     AND (p.action,p.resource_type) IN (
--       ('update','department'),('delete','department'),
--       ('create','position'),('update','position'),('delete','position'),
--       ('manage','master-data'),('preview','employee-code'));
-- DELETE FROM permissions WHERE (action,resource_type) IN
--   (('manage','master-data'),('preview','employee-code'));
-- (update/delete:department + create/update/delete:position thuộc 0005/0019 — KHÔNG xoá ở down 0445.)
