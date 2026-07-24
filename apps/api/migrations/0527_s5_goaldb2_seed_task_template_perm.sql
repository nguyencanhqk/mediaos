-- Migration 0527: S5-GOAL-DB-2 (🔴 RED, zone=red, crown) — SEED quyền quản lý template phân rã:
--   cặp ('manage','task-template') is_sensitive=false + grant per-(role,pair) theo SPEC-10 §11.
--   THUẦN DATA — mirror 0506 (bước 2/3/6). KHÔNG db:generate. KHÔNG đụng audit (tách sang 0528 — plan-review #1).
--
-- BỐI CẢNH (seed qua migrator owner-bypass — mirror 0506:5-8):
--   migrator chạy DATABASE_DIRECT_URL = role owner mediaos (rolbypassrls) ⇒ INSERT permissions (global) +
--   role_permissions (system role company_id NULL) chạy TRỰC TIẾP. RLS chỉ chặn app role runtime.
--
-- QUYẾT ĐỊNH CHỐT (plan §0 D2/D3):
--   D2 ma trận grant = 2 hàng (SPEC-10 §11: "Trưởng đơn vị: department · BOD/Admin: all · Nhân viên: không";
--      hr KHÔNG — hr không phải trưởng-đơn-vị/admin): manager→Department, company-admin→Company.
--   D3 is_sensitive=false (SPEC-10 §11: "is_sensitive đề xuất false cho tất cả"). Chỉ THÊM cặp mới — KHÔNG
--      flip cặp cũ ⇒ KHÔNG đụng allowlist sensitive FE / pin auth-seed-canonical-roles (canonical-seed-pin).
--   • Không cặp 'access' riêng cho task-template — quản lý template nằm TRONG module GOAL (đã seed 0506),
--     truy cập gated bởi màn GOAL-SCREEN-006 (SPEC-10 §11 ghi chú).
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§9):
--   #2 role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ đổi scope = DELETE đúng
--      bộ (role_id,permission_id,'ALLOW') scope SAI (per-pair, KHÔNG blanket/CROSS JOIN — blanket-grant-drift)
--      + INSERT ON CONFLICT DO NOTHING. permissions seed ON CONFLICT(action,resource_type) DO NOTHING.
--   • Idempotent: chạy lại KHÔNG nhân đôi, KHÔNG đổi count.
--
-- BAND 0527 (lane S5-GOAL-DB-2). Journal: idx 194, when 1717587316000 (> 0526 idx 193 / 1717587315000).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) Catalog cặp ('manage','task-template') is_sensitive=false (D3). ON CONFLICT DO NOTHING ──
--     Mã quy ước TASK-TEMPLATE.MANAGE (SPEC-10 §11) chỉ ghi ở COMMENT — bảng permissions CHỈ có (action,
--     resource_type, is_sensitive) (0005:56-62). resource_type 'task-template' (GẠCH-NỐI) ≠ audit object_type
--     'task_template' (gạch-dưới, 0528).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('manage', 'task-template', false)  -- TASK-TEMPLATE.MANAGE
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────── (2) Grant per-(role,pair) theo ma trận D2 = 2 hàng (mirror 0506:3 per-pair DELETE+INSERT) ──
--     resolve role THEO THUỘC TÍNH (name + company_id IS NULL + deleted_at IS NULL — KHÔNG hard-code id, KHÔNG
--     CROSS JOIN blanket) → per-pair DELETE scope SAI → INSERT scope đúng ON CONFLICT(role,perm,effect) DO
--     NOTHING. Role vắng (employee/hr) = KHÔNG grant (deny — least privilege).
DO $$
DECLARE
  tt_grants CONSTANT text[][] := ARRAY[
    ['manager',       'manage', 'task-template', 'Department'],
    ['company-admin', 'manage', 'task-template', 'Company']
  ];
  g          text[];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_rescoped int := 0;
  v_del      int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY tt_grants LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0527] role canonical % không tồn tại — seed 0005/0444 phải chạy trước', g[1];
    END IF;

    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0527] permission (%:%) không có trong catalog — bước (1) phải chạy trước', g[2], g[3];
    END IF;

    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW'
       AND data_scope <> g[4];
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', g[4])
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0527] task-template grants: % INSERT mới, % re-scope (manager/company-admin = 2 hàng)',
    v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (3) VERIFY fail-LOUD (RAISE EXCEPTION — mirror 0506:6): cặp tồn tại is_sensitive=false · đúng 2 grant
--     canonical · manager=Department + company-admin=Company · employee/hr KHÔNG. Idempotent: chạy lại PASS.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_n     int;
  v_scope text;
BEGIN
  -- (a) cặp tồn tại + is_sensitive=false
  SELECT COUNT(*) INTO v_n
    FROM permissions WHERE action = 'manage' AND resource_type = 'task-template' AND is_sensitive = false;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0527] verify: cặp (manage:task-template) is_sensitive=false phải tồn tại đúng 1 — bước (1) trượt (n=%)', v_n;
  END IF;

  -- (b) tổng ĐÚNG 2 grant ALLOW cho 4 role canonical (chống over/under-grant)
  SELECT COUNT(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name IN ('employee', 'manager', 'hr', 'company-admin')
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW' AND p.action = 'manage' AND p.resource_type = 'task-template';
  IF v_n <> 2 THEN
    RAISE EXCEPTION '[0527] verify: % grant manage:task-template cho 4 role canonical, kỳ vọng 2 — over/under-grant', v_n;
  END IF;

  -- (c) manager = Department
  SELECT rp.data_scope INTO v_scope
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name = 'manager' AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW' AND p.action = 'manage' AND p.resource_type = 'task-template';
  IF v_scope IS DISTINCT FROM 'Department' THEN
    RAISE EXCEPTION '[0527] verify: manager manage:task-template scope = % (kỳ vọng Department)', COALESCE(v_scope, 'NULL');
  END IF;

  -- (d) company-admin = Company
  SELECT rp.data_scope INTO v_scope
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name = 'company-admin' AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW' AND p.action = 'manage' AND p.resource_type = 'task-template';
  IF v_scope IS DISTINCT FROM 'Company' THEN
    RAISE EXCEPTION '[0527] verify: company-admin manage:task-template scope = % (kỳ vọng Company)', COALESCE(v_scope, 'NULL');
  END IF;

  -- (e) employee + hr KHÔNG có (D2 — nhân viên/hr không quản lý template)
  SELECT COUNT(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name IN ('employee', 'hr') AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW' AND p.action = 'manage' AND p.resource_type = 'task-template';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0527] verify: employee/hr CÓ % grant manage:task-template — vỡ D2 (không được grant)', v_n;
  END IF;

  RAISE NOTICE '[0527] verify PASS: cặp manage:task-template + 2 grant (manager Department, company-admin Company)';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM role_permissions rp USING permissions p
--   WHERE rp.permission_id = p.id AND p.action = 'manage' AND p.resource_type = 'task-template';
-- DELETE FROM permissions WHERE action = 'manage' AND resource_type = 'task-template';
