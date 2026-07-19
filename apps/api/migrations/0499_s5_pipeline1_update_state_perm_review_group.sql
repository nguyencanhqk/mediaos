-- Migration 0499: S5-TASK-PIPELINE-1 lane migration (🔴 crown) — (1) seed permission pair MỚI
--   `update-state:task` (cổng đổi CỘT pipeline, tách khỏi update-status — DECISIONS-03 D-17/D-21,
--   SPEC-06 §6.8/§14.13) + (2) ALTER CHECK project_states.state_group THÊM giá trị 'review'
--   (owner chốt 18/07/2026 — không có nhóm này thì không thao tác board nào sinh ra được In Review).
--   Plan: docs/plans/S5-TASK-PIPELINE-1.md (lane pipeline-migration, rev 8). Backfill dữ liệu TÁCH
--   RIÊNG sang 0500 (rollback độc lập — owner duyệt).
--
-- THIẾT KẾ (mirror 0485 per-(role,pair) DO-block — ⛔ KHÔNG INSERT...SELECT blanket theo role_id,
--   bẫy permissions-0005-bulk-grant-trap / blanket-grant-migration-role-drift):
--   • MA TRẬN GRANT TƯỜNG MINH — MIRROR ĐÚNG update-status:task (không lệch quyền với auto-map,
--     plan lane be-write 4b): employee=Own · manager=Team · hr=Company · company-admin=Company.
--   • CÙNG COMMIT sửa task-permissions.const.ts: TASK_PERMISSION_COUNT 23→24 + TASK_GRANT_MATRIX
--     + TASK_EXPECTED_GRANT_COUNTS (employee 8 · manager 20 · hr 19 · company-admin 24) — pin lệch
--     là task-permissions-seed.int.spec ĐỎ (bẫy canonical-seed-pin-regression).
--   • CHECK: recreate constraint = danh sách CŨ + 'review' (APPEND giá trị — hot-file UNION,
--     CLAUDE.md §9; không rewrite bớt giá trị nào). Drizzle schema workflow.ts sửa CÙNG COMMIT.
--   • THUẦN additive: không RLS mới (project_states đã RLS+FORCE từ 0420), không bảng mới,
--     không đổi grant table-level. Idempotent: ON CONFLICT + DELETE-wrong-scope + DROP/ADD CHECK
--     qua IF tồn tại — chạy lại = no-op.
--
-- BAND 0499 (S5-TASK-PIPELINE-1). Journal: idx 179, when 1717500890000 (> head 0498 idx 178 /
--   1717500885000). Nối tiếp ĐƠN ĐIỆU sau 0498_s5_notifix2_task_code_seqgen.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) Catalog: 1 cặp mới update-state:task, non-sensitive (cùng lớp update-status — thao tác thường,
--     không phải cổng getCapabilities). ON CONFLICT DO NOTHING (hot-file UNION).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('update-state', 'task', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (b) Grants per-(role,pair) 4 hàng — mirror 0485 DO-block: resolve fail-LOUD → per-pair
--     DELETE-wrong-scope → INSERT ON CONFLICT. Scope MIRROR ĐÚNG update-status:task.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  grants CONSTANT text[][] := ARRAY[
    ['employee',      'update-state', 'task', 'Own'],
    ['manager',       'update-state', 'task', 'Team'],
    ['hr',            'update-state', 'task', 'Company'],
    ['company-admin', 'update-state', 'task', 'Company']
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
      RAISE EXCEPTION '[0499] role canonical % không tồn tại — seed 0005/0444 phải chạy trước', g[1];
    END IF;

    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0499] permission (%:%) không có trong catalog — bước (a) trượt', g[2], g[3];
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

  RAISE NOTICE '[0499] update-state:task grants: % INSERT mới, % re-scope', v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (c) Verify fail-LOUD EXACT: 4 role canonical × update-state:task đúng scope mirror update-status.
--     So le với chính update-status:task để chống lệch quyền (auto-map dựa vào cặp mirror này).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  expected CONSTANT text[][] := ARRAY[
    ['employee', 'Own'], ['manager', 'Team'], ['hr', 'Company'], ['company-admin', 'Company']
  ];
  e        text[];
  v_scope  text;
  v_mirror text;
BEGIN
  FOREACH e SLICE 1 IN ARRAY expected LOOP
    SELECT rp.data_scope INTO v_scope
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r.name = e[1] AND r.company_id IS NULL AND r.deleted_at IS NULL
       AND p.action = 'update-state' AND p.resource_type = 'task' AND rp.effect = 'ALLOW';
    IF v_scope IS DISTINCT FROM e[2] THEN
      RAISE EXCEPTION '[0499] verify FAIL: % update-state:task = % (kỳ vọng %)', e[1], v_scope, e[2];
    END IF;

    SELECT rp.data_scope INTO v_mirror
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r.name = e[1] AND r.company_id IS NULL AND r.deleted_at IS NULL
       AND p.action = 'update-status' AND p.resource_type = 'task' AND rp.effect = 'ALLOW';
    IF v_mirror IS DISTINCT FROM v_scope THEN
      RAISE EXCEPTION '[0499] verify FAIL: % update-state (%) KHÔNG mirror update-status (%)',
        e[1], v_scope, v_mirror;
    END IF;
  END LOOP;
  RAISE NOTICE '[0499] verify OK: update-state:task mirror đúng update-status:task cho 4 role';
END;
$$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (d) CHECK state_group: APPEND 'review' (danh sách cũ + review — UNION, không bớt giá trị).
--     Postgres không ALTER CHECK in-place ⇒ DROP + ADD cùng tên trong 1 migration-tx. Idempotent:
--     ADD guard bằng catalog check (constraint đã có 6 giá trị thì DROP/ADD lại vẫn cùng kết quả).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE project_states DROP CONSTRAINT IF EXISTS project_states_group_check;
--> statement-breakpoint
ALTER TABLE project_states
  ADD CONSTRAINT project_states_group_check
  CHECK (state_group IN ('backlog', 'unstarted', 'started', 'review', 'completed', 'cancelled'));
