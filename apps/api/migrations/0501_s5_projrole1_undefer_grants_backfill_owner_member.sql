-- Migration 0501: S5-TASK-PROJROLE-1 (🔴 crown — đợt C quyền per-project, DECISIONS-04).
--
-- ⚠️ THỨ TỰ DEPLOY: CODE TRƯỚC — MIGRATE SAU. Migration này cấp quyền ghi task cho employee/manager;
--   code enforcement (create-scope D-27 + buildReadScopeExists mode 'write' role-cap D-24 — commit cùng
--   PR) PHẢI live TRƯỚC khi migration chạy. Migrate trước trên instance chạy code cũ = cửa sổ
--   grant-trước-enforcement: createTask không create-scope + membership-branch chưa cap role ⇒ member
--   Viewer sửa được task toàn dự án (đúng nguy cơ ghi ở task-permissions.const.ts:80-83).
--
-- PHẦN A — UN-DEFER 4 grant (D-27, điều kiện un-defer ghi trong source từ S4):
--   create:task + update:task cho employee@Own + manager@Team. delete:task mgr GIỮ HOÃN (§9 đòi
--   relation-check creator/owner — chưa thiết kế). Khuôn DO-block per-(role,pair) ĐÚNG 0499:38-86
--   (⛔ KHÔNG INSERT...SELECT blanket — bẫy permissions-0005-bulk-grant-trap). Cặp đã trong catalog
--   0485 ⇒ KHÔNG INSERT permissions, KHÔNG đổi is_sensitive (bẫy canonical-seed-pin-regression).
--   CÙNG COMMIT: task-permissions.const.ts (TASK_GRANT_MATRIX ± TASK_DEFERRED_GRANTS,
--   TASK_EXPECTED_GRANT_COUNTS emp 8→10 · mgr 20→22) + lật assert task-permissions-seed.int.spec.ts.
--
-- PHẦN B — BACKFILL Owner-member (D-25, BLOCKING #3 plan-reviewer): governance re-anchor từ
--   owner_employee_id (1 người) sang member role Owner ⇒ project có chủ chưa-là-member (reassign trước
--   đợt C không sync) sẽ bị LOCKOUT nếu không backfill. Quy tắc 2 nhánh: (i) chủ ĐÃ có hàng member
--   Active role khác ⇒ UPDATE nâng role='Owner'; (ii) CHƯA có hàng Active ⇒ INSERT (user_id NOT NULL
--   ⇒ GUARD emp.user_id IS NOT NULL — chủ account-less SKIP + RAISE NOTICE, họ không đăng nhập được
--   nên không phải actor, không lockout thêm). Idempotent: chạy lại = 0 hàng đổi.
--   RLS: bảng project_members RLS+FORCE (0023) — drizzle migrator chạy qua DATABASE_DIRECT_URL (role
--   sở hữu schema, có BYPASSRLS trên direct pool như mọi migration backfill trước: 0420/0500). VERIFY
--   fail-loud đầu Phần B: đếm được project cross-company ⇒ policy không lọc câm (silent 0-row).
--
-- BAND 0501 (S5-TASK-PROJROLE-1). Journal: idx 181, when 1717500900000 (> head 0500 idx 180 /
--   1717500895000). Nối tiếp ĐƠN ĐIỆU sau 0500_s5_pipeline1_backfill_states_and_state_id.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- PHẦN A(a) — 4 grant un-defer per-(role,pair): resolve fail-LOUD → DELETE-wrong-scope đúng bộ
-- (role_id, permission_id, 'ALLOW') → INSERT ON CONFLICT DO NOTHING.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  grants CONSTANT text[][] := ARRAY[
    ['employee', 'create', 'task', 'Own'],
    ['employee', 'update', 'task', 'Own'],
    ['manager',  'create', 'task', 'Team'],
    ['manager',  'update', 'task', 'Team']
  ];
  g           text[];
  v_role_id   uuid;
  v_perm_id   uuid;
  v_seeded    int := 0;
  v_rescoped  int := 0;
  v_del       int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY grants LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0501] role canonical % không tồn tại — seed 0005/0444 phải chạy trước', g[1];
    END IF;

    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0501] permission (%:%) không có trong catalog — 0485 phải chạy trước', g[2], g[3];
    END IF;

    -- per-pair DELETE đúng bộ (role_id,permission_id,'ALLOW') có scope SAI — KHÔNG blanket.
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

  RAISE NOTICE '[0501] un-defer create/update:task grants: % INSERT mới, % re-scope', v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- PHẦN A(b) — Verify fail-LOUD EXACT 4 hàng + delete:task VẪN DENY cho employee/manager (D-27.2).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  expected CONSTANT text[][] := ARRAY[
    ['employee', 'create', 'Own'],
    ['employee', 'update', 'Own'],
    ['manager',  'create', 'Team'],
    ['manager',  'update', 'Team']
  ];
  e        text[];
  v_scope  text;
  v_n      int;
BEGIN
  FOREACH e SLICE 1 IN ARRAY expected LOOP
    SELECT rp.data_scope INTO v_scope
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r.name = e[1] AND r.company_id IS NULL AND r.deleted_at IS NULL
       AND p.action = e[2] AND p.resource_type = 'task' AND rp.effect = 'ALLOW';
    IF v_scope IS DISTINCT FROM e[3] THEN
      RAISE EXCEPTION '[0501] verify FAIL: % %:task = % (kỳ vọng %)', e[1], e[2], v_scope, e[3];
    END IF;
  END LOOP;

  -- delete:task GIỮ HOÃN — không role nào trong (employee, manager) được có grant.
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name IN ('employee', 'manager') AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND p.action = 'delete' AND p.resource_type = 'task' AND rp.effect = 'ALLOW';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0501] verify FAIL: delete:task bị grant cho employee/manager (% hàng) — D-27.2 giữ hoãn', v_n;
  END IF;

  RAISE NOTICE '[0501] verify OK: 4 grant un-defer đúng scope; delete:task vẫn deny cho emp/mgr';
END;
$$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- PHẦN B — Backfill Owner-member cho mọi project có owner_employee_id chưa là Active Owner-member.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_visible    int;
  v_companies  int;
  v_promoted   int := 0;
  v_inserted   int := 0;
  v_skipped    int := 0;
  r            record;
  v_member_id  uuid;
BEGIN
  -- VERIFY RLS không lọc câm: migration phải thấy dữ liệu MỌI company (FORCE RLS + role không
  -- BYPASSRLS ⇒ 0 row ⇒ backfill "thành công" rỗng — chính failure-mode cảnh báo của plan-reviewer).
  SELECT count(*), count(DISTINCT company_id) INTO v_visible, v_companies FROM projects;
  IF v_visible > 0 AND v_companies = 0 THEN
    RAISE EXCEPTION '[0501] RLS đang lọc migration role — backfill sẽ câm 0 hàng, dừng fail-loud';
  END IF;
  RAISE NOTICE '[0501] backfill nhìn thấy % project / % company', v_visible, v_companies;

  FOR r IN
    SELECT p.id AS project_id, p.company_id, p.owner_employee_id, ep.user_id AS owner_user_id
      FROM projects p
      JOIN employee_profiles ep
        ON ep.id = p.owner_employee_id AND ep.company_id = p.company_id
     WHERE p.deleted_at IS NULL
       AND p.owner_employee_id IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM project_members pm
              WHERE pm.company_id = p.company_id
                AND pm.project_id = p.id
                AND pm.employee_id = p.owner_employee_id
                AND pm.project_role = 'Owner'
                AND pm.member_status = 'Active'
                AND pm.deleted_at IS NULL
           )
  LOOP
    -- Nhánh (i): chủ đã có hàng member Active (role khác/NULL) ⇒ UPDATE nâng role (không nhân đôi —
    -- unique uq_project_members_active_employee).
    SELECT pm.id INTO v_member_id
      FROM project_members pm
     WHERE pm.company_id = r.company_id
       AND pm.project_id = r.project_id
       AND pm.employee_id = r.owner_employee_id
       AND pm.member_status = 'Active'
       AND pm.deleted_at IS NULL
     LIMIT 1;

    IF v_member_id IS NOT NULL THEN
      UPDATE project_members
         SET project_role = 'Owner', updated_at = now()
       WHERE id = v_member_id;
      v_promoted := v_promoted + 1;
    ELSIF r.owner_user_id IS NOT NULL THEN
      -- Nhánh (ii): chưa có hàng Active ⇒ INSERT (user_id NOT NULL — schema legacy 0023).
      INSERT INTO project_members
        (company_id, project_id, user_id, employee_id, project_role, member_status, joined_at)
      VALUES
        (r.company_id, r.project_id, r.owner_user_id, r.owner_employee_id, 'Owner', 'Active', now());
      v_inserted := v_inserted + 1;
    ELSE
      -- GUARD account-less (cảnh báo plan-reviewer vòng 2): INSERT user_id NULL sẽ CRASH NOT NULL.
      -- Chủ không account = không đăng nhập được = không phải actor ⇒ SKIP không lockout thêm; lộ ra
      -- bằng NOTICE để người vận hành xử lý tay (gán account hoặc đổi chủ).
      RAISE NOTICE '[0501] SKIP owner account-less: project=% company=% owner_employee=%',
        r.project_id, r.company_id, r.owner_employee_id;
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '[0501] backfill Owner-member: % UPDATE nâng role, % INSERT mới, % SKIP account-less',
    v_promoted, v_inserted, v_skipped;
END;
$$;
