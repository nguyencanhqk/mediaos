-- Migration 0496: S5-HR-IMPORT-BE-1 / MIG-IMPORT-PERM-AUDITTYPE (🔴 RED, zone=red, crown) —
--   (a) FLIP độ nhạy cặp quyền ('import','employee') false→true;
--   (b) grant per-(permission,role) data_scope='Company', effect ALLOW cho hr + company-admin;
--   (c) UNION-add audit object_type 'employee_import' vào CHECK audit_logs (sync AUDIT_OBJECT_TYPES cùng commit);
--   (e) fail-LOUD verify cuối file.
--   THUẦN DATA + 1 DO-block DDL trên CHECK audit_logs. KHÔNG db:generate (SQL tay convention 04xx).
--   KHÔNG đụng RLS/FORCE/policy/schema table nghiệp vụ.
--
-- VÌ SAO WO NÀY (parity + fail-closed — mirror 0492 export:employee):
--   • 0019 dòng 23 seed ('import','employee', is_sensitive=false) — LỆCH với export:employee (0492 true).
--     Import hàng loạt danh bạ nhân sự = ghi PII toàn tenant + tạo employee_profiles hàng loạt ⇒ PHẢI là
--     cặp NHẠY CẢM, ngang hàng export:employee (0492) / view-sensitive:employee (0444).
--   • is_sensitive=true ⇒ PermissionService fail-closed: chỉ grant EXACT (action,resource_type) mới thoả;
--     grant wildcard '*:*' KHÔNG kế thừa cặp nhạy cảm (permissions.ts "must be granted per-user only").
--     hr + company-admin nhận grant EXACT ('import','employee', scope Company) ⇒ endpoint POST
--     /hr/employees/import (route MỚI, BE lane cùng WO) enforce đúng. KHÔNG consumer live nào bị mất quyền
--     đột ngột (route mới) ⇒ không cửa sổ 403 (migrate + deploy cùng đợt, N=1).
--
-- BỐI CẢNH (UPDATE/INSERT qua migrator owner, KHÔNG qua app role — mirror 0492/0476):
--   permissions = catalog GLOBAL, KHÔNG có company_id ⇒ KHÔNG RLS. App role CHỈ có GRANT SELECT (không
--   UPDATE/DELETE trên permissions/role_permissions — mig 0005). Migrator chạy DATABASE_DIRECT_URL = role
--   owner mediaos (privileged) ⇒ UPDATE/INSERT/ALTER catalog chạy TRỰC TIẾP tại migrate-time. Runtime app
--   role KHÔNG sửa được độ nhạy/grant/CHECK — bất biến giữ.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 KHÔNG đụng cô lập tenant: permissions/role_permissions không có company_id; migration KHÔNG tạo/sửa
--      policy, KHÔNG backfill company_id, KHÔNG ALTER bảng nghiệp vụ. RLS+FORCE đã bật ở migration của chúng.
--   #2 audit append-only GIỮ NGUYÊN: chỉ MỞ RỘNG tập giá trị object_type hợp lệ (UNION ADD-only DO-block
--      0456), KHÔNG cấp UPDATE/DELETE cho app role, KHÔNG rewrite cứng CHECK. KHÔNG hard-delete/rewrite
--      catalog: chỉ UPDATE cột is_sensitive IN-PLACE (giữ id ⇒ FK role_permissions.permission_id nguyên vẹn).
--   #3 Idempotent bộ ba: (a) INSERT ON CONFLICT DO NOTHING + UPDATE ... IS DISTINCT FROM true → chạy lại 0
--      hàng; (b) grant ON CONFLICT(role_id,permission_id,effect) DO NOTHING; (c) DO-block chỉ ADD giá trị
--      chưa có. Chạy 2 lần = 0 đổi, KHÔNG ném exception.
--
-- BAND 0496 (lane MIG-IMPORT-PERM-AUDITTYPE / S5-HR-IMPORT-BE-1 — NỐI TIẾP TRƯỚC). Journal: idx 176,
--   when 1717500875000 (> head THẬT 0495_s5_medb1 idx 175 / 1717500870000). Nối tiếp ĐƠN ĐIỆU sau head.
--   Drizzle migrator resolve file THEO `tag` + áp theo THỨ TỰ mảng journal (KHÔNG theo số tiền tố file).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) FLIP is_sensitive false→true cho cặp EXACT ('import','employee'). INSERT ON CONFLICT DO NOTHING
--     (no-op giữ cho DB dựng-mới — cặp ĐÃ tồn tại từ 0019 dòng 23 ⇒ conflict) + UPDATE idempotent
--     (IS DISTINCT FROM true ⇒ chạy lại 0 hàng). Sau flip: import danh bạ = cặp nhạy cảm fail-closed
--     (parity export:employee 0492); wildcard *:* không thoả; hr/company-admin nhận grant EXACT ở (b).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('import', 'employee', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

UPDATE permissions
SET is_sensitive = true
WHERE action = 'import'
  AND resource_type = 'employee'
  AND is_sensitive IS DISTINCT FROM true;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (b) Grant cặp ('import','employee') → hr + company-admin (system role: company_id NULL, is_system=true)
--     × ALLOW × data_scope='Company'. Resolve role/perm THEO THUỘC TÍNH (KHÔNG hard-code id §13 per-pair).
--     RAISE nếu role/perm NULL. INSERT ON CONFLICT(role_id,permission_id,effect) DO NOTHING (idempotent).
--
--     + BACKFILL PER-PAIR DỌN DRIFT (bài học blanket-grant-role-drift): 0019 dòng 69-75 blanket-grant
--       INSERT...SELECT MỌI quyền employee non-sensitive cho role media-era 'hr-manager' (id …009) —
--       gồm import:employee KHI cặp còn is_sensitive=false. Sau flip (a), grant EXPLICIT ALLOW đó SỐNG SÓT
--       ⇒ role parked media-era vẫn import được (bypass, phá fail-closed). DELETE per-pair MỌI grant ALLOW
--       import:employee của role KHÁC hr/company-admin (chỉ cặp NÀY, effect ALLOW) ⇒ import:employee sensitive
--       CHỈ hr + company-admin. Idempotent: lần 2 DELETE 0 hàng. KHÔNG đụng cặp/role khác.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_role_id uuid;
  v_perm_id uuid;
  v_role    text;
  v_del     bigint;
BEGIN
  SELECT id INTO v_perm_id FROM permissions
   WHERE action = 'import' AND resource_type = 'employee';
  IF v_perm_id IS NULL THEN
    RAISE EXCEPTION '[0496] permission (import:employee) không có trong catalog — bước (a) phải chạy trước';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['hr', 'company-admin']
  LOOP
    SELECT id INTO v_role_id FROM roles
     WHERE name = v_role AND company_id IS NULL AND is_system = true AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0496] role % (system, company_id NULL) không tồn tại — seed 0005/0444 phải chạy trước', v_role;
    END IF;

    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', 'Company')
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
  END LOOP;

  -- Dọn stray blanket grant (hr-manager …009 từ 0019) — chỉ cặp import:employee, effect ALLOW, role ≠ hr/company-admin.
  DELETE FROM role_permissions rp
   USING roles r
   WHERE rp.role_id = r.id
     AND rp.permission_id = v_perm_id
     AND rp.effect = 'ALLOW'
     AND r.name NOT IN ('hr', 'company-admin');
  GET DIAGNOSTICS v_del = ROW_COUNT;

  RAISE NOTICE '[0496] grant import:employee → hr + company-admin (ALLOW, scope Company) seeded; dọn % stray blanket grant (idempotent)', v_del;
END $$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (c) UNION-add audit object_type 'employee_import' vào CHECK audit_logs (DO-block ADD-only idempotent,
--     clone 0456/0491). Session-audit của import ghi 1 dòng object_type='employee_import' {fileName,ok,fail}
--     (BE lane cùng WO). AUDIT_OBJECT_TYPES (schema/audit.ts) sync giá trị này CÙNG commit. Append-only #2
--     nguyên vẹn: chỉ MỞ RỘNG tập giá trị hợp lệ, KHÔNG cấp UPDATE/DELETE, KHÔNG rewrite cứng CHECK.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['employee_import'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[0496] khong tim thay CHECK object_type tren audit_logs — bo qua (idempotent)';
    RETURN;
  END IF;

  v_def := pg_get_constraintdef(v_oid);
  IF position('ANY' IN upper(v_def)) > 0 THEN
    v_cur := substring(v_def FROM '\{[^}]*\}')::text[];
  ELSE
    SELECT array_agg(m[1]) INTO v_cur
      FROM (
        SELECT regexp_matches(v_def, '''([^'']+)''', 'g') AS m
      ) sub;
  END IF;

  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) = 0 THEN
    RAISE NOTICE '[0496] employee_import da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
  RAISE NOTICE '[0496] da them % vao CHECK object_type cua audit_logs', array_to_string(v_add, ', ');
END;
$$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (e) Fail-LOUD verify (mẫu 0466/0476): RAISE nếu (1) pair ('import','employee') KHÔNG is_sensitive=true,
--     (2) thiếu grant hr/company-admin × ALLOW × Company, HOẶC (3) object_type 'employee_import' chưa vào
--     CHECK audit_logs. Khẳng định trạng thái CUỐI (fail-closed, chống xanh-giả migrate).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_role   text;
  v_oid    oid;
  v_def    text;
  v_cur    text[];
BEGIN
  -- (1) pair is_sensitive=true
  IF NOT EXISTS (
    SELECT 1 FROM permissions
     WHERE action = 'import' AND resource_type = 'employee' AND is_sensitive = true
  ) THEN
    RAISE EXCEPTION '[0496] pair (import:employee) is_sensitive=true KHÔNG tồn tại sau seed — bước (a) trượt.';
  END IF;

  -- (2) grant hr + company-admin × ALLOW × Company
  FOREACH v_role IN ARRAY ARRAY['hr', 'company-admin']
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM role_permissions rp
        JOIN roles r       ON r.id = rp.role_id
        JOIN permissions p ON p.id = rp.permission_id
       WHERE r.name = v_role AND r.company_id IS NULL AND r.is_system = true
         AND r.deleted_at IS NULL
         AND p.action = 'import' AND p.resource_type = 'employee'
         AND rp.effect = 'ALLOW' AND rp.data_scope = 'Company'
    ) THEN
      RAISE EXCEPTION '[0496] grant % × import:employee × ALLOW × Company KHÔNG tồn tại sau seed — bước (b) trượt.', v_role;
    END IF;
  END LOOP;

  -- (2b) EXCLUSIVITY: KHÔNG role nào KHÁC hr/company-admin còn ALLOW import:employee (dọn drift bước (b)).
  IF EXISTS (
    SELECT 1
      FROM role_permissions rp
      JOIN roles r       ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE p.action = 'import' AND p.resource_type = 'employee'
       AND rp.effect = 'ALLOW'
       AND r.name NOT IN ('hr', 'company-admin')
  ) THEN
    RAISE EXCEPTION '[0496] còn role NGOÀI hr/company-admin giữ ALLOW import:employee sau dọn — bước (b) DELETE trượt.';
  END IF;

  -- (3) object_type 'employee_import' đã vào CHECK audit_logs. Parse ROBUST cả 2 dạng render của
  --     pg_get_constraintdef (ANY('{...}'::text[]) → giá trị BARE trong {} · IN-list → giá trị 'quoted'),
  --     giống DO-block (c) — KHÔNG dựa dấu nháy đơn (sau 0456-rewrite giá trị không còn nháy đơn).
  SELECT oid INTO v_oid
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;
  IF v_oid IS NOT NULL THEN
    v_def := pg_get_constraintdef(v_oid);
    IF position('ANY' IN upper(v_def)) > 0 THEN
      v_cur := substring(v_def FROM '\{[^}]*\}')::text[];
    ELSE
      SELECT array_agg(m[1]) INTO v_cur
        FROM (
          SELECT regexp_matches(v_def, '''([^'']+)''', 'g') AS m
        ) sub;
    END IF;
    IF v_cur IS NULL OR NOT (v_cur @> ARRAY['employee_import']) THEN
      RAISE EXCEPTION '[0496] object_type ''employee_import'' chưa vào CHECK audit_logs sau seed — bước (c) trượt.';
    END IF;
  END IF;

  RAISE NOTICE '[0496] verify PASS: import:employee sensitive + grant hr/company-admin Company + employee_import trong CHECK';
END $$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- UPDATE permissions SET is_sensitive = false WHERE (action,resource_type)=('import','employee');
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id
--     AND r.name IN ('hr','company-admin') AND r.company_id IS NULL AND r.is_system=true
--     AND (p.action,p.resource_type)=('import','employee') AND rp.effect='ALLOW';
-- Re-stamp CHECK bỏ 'employee_import' (CHỈ khi không còn row audit_logs nào dùng nó).
