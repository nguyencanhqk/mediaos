-- Migration 0477: S2-HR-EMPFILE-1 (🔴 RED, zone=red) — permission catalog + grant cho file hồ sơ
--   nhân viên (Employee File). Seed 3 cặp file-view/file-upload/file-delete × 'employee' + grant
--   hr/company-admin → data_scope='Company'. THUẦN SEED — KHÔNG bảng mới, KHÔNG RLS, KHÔNG audit CHECK.
--
-- MỤC TIÊU (đối chiếu done_when S2-HR-EMPFILE-1 · API-03 HR-API-801..805):
--   (A) Catalog 3 cặp MỚI is_sensitive=false — cổng quyền cho 5 route dưới /hr/employees/:id/files:
--         ('file-view',   'employee')  — GET list · GET :fileId (metadata) · GET :fileId/download
--         ('file-upload', 'employee')  — POST (link file đã upload+confirm qua FileService)
--         ('file-delete', 'employee')  — DELETE :fileId (soft-delete file_link + file)
--       EmployeeFileResolver (lane BE) đăng ký (HR, employee_profile) vào FilePolicyService và ánh xạ
--       canView/canDownload↔file-view, canLink↔file-upload, canDelete/canUnlink↔file-delete. Cặp
--       DÀNH RIÊNG cho hồ sơ nhân viên (KHÁC view/manage:contract của HrContractFileResolver) — cô lập
--       cổng file hồ sơ khỏi cổng hợp đồng. ON CONFLICT(action,resource_type) DO NOTHING (hot-file UNION).
--   (B) Grant role_permissions THEO TỪNG CẶP: hr · company-admin → data_scope='Company' cho cả 3 cặp
--       (SCOPE CHỐT: file hồ sơ nhân viên CHỈ Company cho hr/company-admin — Manager/Employee KHÔNG có
--       grant nào ⇒ deny-path → 403 fail-closed). SA = runtime System (KHÔNG seed ở đây). Per-pair
--       DELETE-wrong-scope + INSERT target (clone khối D mig 0462). RAISE nếu role canonical / permission
--       chưa tồn tại (fail-loud — seed 0005/0444 phải chạy trước).
--
-- HOT-FILE §9.3 / BẤT BIẾN:
--   • THUẦN SEED: KHÔNG CREATE TABLE, KHÔNG ALTER … employee_profiles ENABLE/FORCE/POLICY (RLS+FORCE của
--     employee_profiles/files/file_links đã land mig 0442/0433 — GIỮ NGUYÊN). KHÔNG sửa CHECK
--     audit_logs.object_type: FileService audit FileLinked/FileDeleted TÁI DÙNG 'file'/'file_link' đã seed
--     mig 0440 (KHÔNG object_type mới) ⇒ BẤT BIẾN #2 (append-only) không đụng tới.
--   • Catalog: INSERT ON CONFLICT(action,resource_type) DO NOTHING — cặp mới, chạy lại no-op.
--   • role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ per-pair DELETE
--     wrong-scope + INSERT target (mirror 0462). App role KHÔNG có UPDATE trên role_permissions ⇒ đổi
--     scope qua DELETE+INSERT (BẤT BIẾN #2). Seed qua DO-block (không biểu diễn được bằng Drizzle schema).
--   • is_sensitive=false: file hồ sơ = HR CRUD thường (như view/manage:contract mig 0462); cô lập tenant +
--     data-scope + scan_status guard nằm ở resolver/service (lane BE), KHÔNG ở cờ sensitive.
--   • KHÔNG db:generate cho file này (DO-block/seed thủ công). Fail-LOUD verify cuối file (mẫu 0476/0466).
--
-- BAND 0477 (WO S2-HR-EMPFILE-1 / lane s2hrempfile1-mig). Journal: idx 157, when 1717500780000
--   (> head 0476 idx 156 / 1717500775000). NỐI TIẾP ĐƠN ĐIỆU forward-only/no-gap sau head thực tế
--   0476_s2_authuserops1_user_delete_restore_resetpw_perms (verify _journal.json — KHÔNG tin tên
--   file/STATUS). Drizzle migrator áp theo THỨ TỰ mảng journal (resolve file theo `tag`).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── A. Seed permission catalog 3 cặp file-* × 'employee' ───────────────
-- ON CONFLICT(action,resource_type) DO NOTHING (hot-file UNION). is_sensitive=false (HR file CRUD thường).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('file-view',   'employee', false),
  ('file-upload', 'employee', false),
  ('file-delete', 'employee', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────── B. Seed role_permissions THEO TỪNG CẶP (role, action, resource_type) = data_scope ───────────────
--   SCOPE CHỐT: file-view + file-upload + file-delete : employee = hr · company-admin → Company.
--   Manager/Employee KHÔNG (deny-path → 403). SA = runtime System (KHÔNG ở đây). Per-pair
--   DELETE-wrong-scope + INSERT target (clone khối D mig 0462). RAISE nếu role/permission chưa có.
DO $$
DECLARE
  grants CONSTANT text[][] := ARRAY[
    -- HR.EMPLOYEE.FILE_VIEW
    ['hr',            'file-view',   'employee', 'Company'],
    ['company-admin', 'file-view',   'employee', 'Company'],
    -- HR.EMPLOYEE.FILE_UPLOAD
    ['hr',            'file-upload', 'employee', 'Company'],
    ['company-admin', 'file-upload', 'employee', 'Company'],
    -- HR.EMPLOYEE.FILE_DELETE
    ['hr',            'file-delete', 'employee', 'Company'],
    ['company-admin', 'file-delete', 'employee', 'Company']
  ];
  g           text[];
  v_role_id   uuid;
  v_perm_id   uuid;
  v_seeded    int := 0;
  v_rescoped  int := 0;
  v_del       int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY grants LOOP
    -- resolve role (system role canonical: company_id NULL, chưa xoá mềm — roles_system_name_active_uq 0005)
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0477] role canonical % không tồn tại — seed 0005/0444 phải chạy trước', g[1];
    END IF;

    -- resolve permission (catalog gap (A) phải đã chạy)
    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0477] permission (%:%) không có trong catalog — bước (A) phải chạy trước', g[2], g[3];
    END IF;

    -- DELETE đúng bộ (role_id, permission_id, 'ALLOW') có scope SAI (per-pair, KHÔNG blanket).
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

  RAISE NOTICE '[0477] EMPLOYEE-FILE perms seed: % cặp INSERT mới, % cặp re-scope (DELETE wrong-scope+INSERT)',
    v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ─────────────── C. Fail-LOUD verify (mẫu 0476/0466): 3 cặp × 2 role × Company phải tồn tại sau seed ───────────────
DO $$
DECLARE
  r         text;
  a         text;
  v_roles   CONSTANT text[] := ARRAY['hr', 'company-admin'];
  v_actions CONSTANT text[] := ARRAY['file-view', 'file-upload', 'file-delete'];
BEGIN
  FOREACH a IN ARRAY v_actions LOOP
    IF NOT EXISTS (
      SELECT 1 FROM permissions WHERE action = a AND resource_type = 'employee'
    ) THEN
      RAISE EXCEPTION '[0477] pair (%:employee) KHÔNG tồn tại trong catalog sau seed — bước (A) trượt.', a;
    END IF;

    FOREACH r IN ARRAY v_roles LOOP
      IF NOT EXISTS (
        SELECT 1
          FROM role_permissions rp
          JOIN roles r2      ON r2.id = rp.role_id
          JOIN permissions p ON p.id = rp.permission_id
         WHERE r2.name = r AND r2.company_id IS NULL AND r2.deleted_at IS NULL
           AND p.action = a AND p.resource_type = 'employee'
           AND rp.effect = 'ALLOW' AND rp.data_scope = 'Company'
      ) THEN
        RAISE EXCEPTION '[0477] grant % × %:employee × ALLOW × Company KHÔNG tồn tại sau seed — bước (B) trượt.', r, a;
      END IF;
    END LOOP;
  END LOOP;

  -- Manager/Employee KHÔNG được cấp grant (deny-path → 403). Fail-loud nếu lỡ seed.
  IF EXISTS (
    SELECT 1
      FROM role_permissions rp
      JOIN roles r2      ON r2.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r2.name IN ('manager', 'employee') AND r2.company_id IS NULL AND r2.deleted_at IS NULL
       AND p.resource_type = 'employee'
       AND p.action IN ('file-view', 'file-upload', 'file-delete')
       AND rp.effect = 'ALLOW'
  ) THEN
    RAISE EXCEPTION '[0477] manager/employee KHÔNG được cấp file-*:employee (deny-path) — grant thừa, kiểm khối (B).';
  END IF;

  RAISE NOTICE '[0477] verify OK — 3 cặp file-*:employee × {hr,company-admin} Company seeded; manager/employee deny giữ nguyên.';
END $$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id
--     AND r.name IN ('hr','company-admin') AND r.company_id IS NULL
--     AND p.resource_type='employee'
--     AND p.action IN ('file-view','file-upload','file-delete');
-- DELETE FROM permissions WHERE resource_type='employee'
--   AND action IN ('file-view','file-upload','file-delete');
