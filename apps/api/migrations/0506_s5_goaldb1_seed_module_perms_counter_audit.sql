-- Migration 0506: S5-GOAL-DB-1 (🔴 RED, zone=red, crown) — SEED nghiệp vụ GOAL:
--   module GOAL + 7 cặp quyền goal + grant per-pair (ma trận D5) + UNION-ADD 'goal' vào audit CHECK +
--   sequence_counters 'goal' cho MỌI company. THUẦN DATA/DDL-CHECK — mirror 0495/0481/0498/0474. KHÔNG db:generate.
--
-- BỐI CẢNH (seed qua migrator owner-bypass — mirror 0481:6-11 / 0498:17-22):
--   migrator chạy DATABASE_DIRECT_URL = role owner mediaos (rolbypassrls) ⇒ INSERT modules/permissions
--   (no-RLS/global) + role_permissions + sequence_counters (tenant-scoped, company_id TƯỜNG MINH) chạy TRỰC
--   TIẾP. WITH CHECK/RLS chỉ chặn app role runtime, KHÔNG chặn owner-bypass tại migrate-time.
--
-- QUYẾT ĐỊNH CHỐT (plan §0):
--   D1 is_sensitive=false cho CẢ 7 cặp goal (kể cả finalize) — owner chốt 20/07/2026. KHÔNG đụng allowlist
--      sensitive FE / pin auth-seed-canonical-roles (chỉ THÊM cặp mới, không flip cặp cũ).
--   D2 counter 'goal': scope Company · module GOAL · prefix 'GOAL-' · padding_length=4 · Never · current_value=0
--      ⇒ mã đầu GOAL-0001. KHÔNG backfill (bảng goals rỗng — 0 hàng).
--   D4 module GOAL: module_group='Collaboration' (cùng nhóm TASK — 0435:292), is_core=false, is_mvp=true,
--      is_active=true, sort_order=6.
--   D5 ma trận grant per-(permission,role) — 22 hàng (bảng dưới). hr chỉ view Company (đánh giá Phase 2),
--      KHÔNG grant ghi. employee KHÔNG finalize.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #2 role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ đổi scope = DELETE đúng bộ
--      (role_id,permission_id,'ALLOW') scope SAI (per-pair, KHÔNG blanket/CROSS JOIN — bài học blanket-grant-drift)
--      + INSERT scope §13 ON CONFLICT DO NOTHING. CHECK audit_logs.object_type: UNION ADD-only 'goal' (DO-block
--      mẫu 0474, idempotent) — KHÔNG rewrite, KHÔNG drop giá trị cũ (append-only nguyên vẹn). permissions/modules
--      seed ON CONFLICT DO NOTHING (hot-file UNION §9.3).
--   • super-admin KHÔNG enumerate (company-scoped, nhận qua SuperAdminBootstrap runtime — roles company_id IS
--     NULL không có 'super-admin' ⇒ enumerate = RAISE vỡ; mirror ghi chú 0481/0495).
--   • Idempotent bộ-ba (role, permission, data_scope) + ON CONFLICT DO NOTHING counter + DO-block CHECK rẽ nhánh
--     theo trạng thái ⇒ chạy lại KHÔNG nhân đôi, KHÔNG đổi count.
--
-- BAND 0506 (lane S5-GOAL-DB-1). Journal: idx 186, when 1717587308000 (> 0505 idx 185 / 1717587307000).
--   AUDIT_OBJECT_TYPES (schema/audit.ts) sync 'goal' CÙNG commit.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) SEED module GOAL (DB-10 mirror 0435/0495). ON CONFLICT (uq module_code chưa xoá) ──────
INSERT INTO modules (module_code, name, module_group, is_core, is_mvp, is_active, sort_order) VALUES
  ('GOAL', 'Mục tiêu', 'Collaboration', false, true, true, 6)
ON CONFLICT (module_code) WHERE deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────────── (2) Catalog 7 cặp quyền goal is_sensitive=false (D1). ON CONFLICT(action,resource) DO NOTHING ──
--     Mã quy ước GOAL.GOAL.* (SPEC-10 §11) chỉ ghi ở COMMENT — bảng permissions CHỈ có (action,resource_type,
--     is_sensitive) (0005:56-62, KHÔNG có cột code/name). is_sensitive=false: access=cổng nav (getCapabilities
--     lọc bỏ sensitive); view/create/update/delete/checkin/finalize = thao tác nghiệp vụ goal, scope §13 đủ chặn.
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('access',   'goal', false),  -- GOAL.ACCESS
  ('view',     'goal', false),  -- GOAL.GOAL.VIEW
  ('create',   'goal', false),  -- GOAL.GOAL.CREATE
  ('update',   'goal', false),  -- GOAL.GOAL.UPDATE
  ('delete',   'goal', false),  -- GOAL.GOAL.DELETE
  ('checkin',  'goal', false),  -- GOAL.GOAL.CHECKIN
  ('finalize', 'goal', false)   -- GOAL.GOAL.FINALIZE
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────── (3) Grant per-(role,pair) theo ma trận D5 = 22 hàng (mirror 0481:4a per-pair DELETE+INSERT) ──
--     resolve role THEO THUỘC TÍNH (name + company_id IS NULL + deleted_at IS NULL — KHÔNG hard-code id, KHÔNG
--     CROSS JOIN blanket, bài học §13 + blanket-grant-role-drift) → per-pair DELETE scope SAI → INSERT scope đúng
--     ON CONFLICT(role,perm,effect) DO NOTHING. Role vắng trong pair = KHÔNG grant (deny — least privilege).
DO $$
DECLARE
  goal_grants CONSTANT text[][] := ARRAY[
    ['employee',      'access',   'goal', 'Own'],
    ['manager',       'access',   'goal', 'Own'],
    ['hr',            'access',   'goal', 'Own'],
    ['company-admin', 'access',   'goal', 'Own'],
    ['employee',      'view',     'goal', 'Department'],
    ['manager',       'view',     'goal', 'Department'],
    ['hr',            'view',     'goal', 'Company'],
    ['company-admin', 'view',     'goal', 'Company'],
    ['employee',      'create',   'goal', 'Own'],
    ['manager',       'create',   'goal', 'Department'],
    ['company-admin', 'create',   'goal', 'Company'],
    ['employee',      'update',   'goal', 'Own'],
    ['manager',       'update',   'goal', 'Department'],
    ['company-admin', 'update',   'goal', 'Company'],
    ['employee',      'delete',   'goal', 'Own'],
    ['manager',       'delete',   'goal', 'Department'],
    ['company-admin', 'delete',   'goal', 'Company'],
    ['employee',      'checkin',  'goal', 'Own'],
    ['manager',       'checkin',  'goal', 'Department'],
    ['company-admin', 'checkin',  'goal', 'Company'],
    ['manager',       'finalize', 'goal', 'Department'],
    ['company-admin', 'finalize', 'goal', 'Company']
  ];
  g          text[];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_rescoped int := 0;
  v_del      int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY goal_grants LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0506] role canonical % không tồn tại — seed 0005/0444 phải chạy trước', g[1];
    END IF;

    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0506] permission (%:%) không có trong catalog — bước (2) phải chạy trước', g[2], g[3];
    END IF;

    -- DELETE đúng bộ (role_id,permission_id,'ALLOW') scope SAI (per-pair, KHÔNG blanket) → idempotent rescope.
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

  RAISE NOTICE '[0506] GOAL grants: % INSERT mới, % re-scope (4 role × ma trận D5 = 22 hàng)', v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ─────────────── (4) CHECK audit_logs.object_type += 'goal' (UNION ADD-only, clone 0474) ───────────
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['goal'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[0506] khong tim thay CHECK object_type tren audit_logs — bo qua (idempotent)';
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
    RAISE NOTICE '[0506] goal da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
  RAISE NOTICE '[0506] da them % vao CHECK object_type cua audit_logs', array_to_string(v_add, ', ');
END;
$$;
--> statement-breakpoint

-- ─────────────── (5) SEED sequence_counters 'goal' cho MỌI company (D2, clone 0498 bước 1). ON CONFLICT ──────
--     bare DO NOTHING bắt partial-unique uq_sequence_counters_company_key_scope_active. current_value=0 ⇒ mã đầu
--     (nextCode) = GOAL-0001. KHÔNG backfill/sync (goals rỗng — thiếu counter là SequenceNotFoundError goal đầu).
INSERT INTO sequence_counters (
  company_id, module_code, sequence_key, scope_type,
  prefix, padding_length, reset_policy, increment_by, current_value, status
)
SELECT c.id, 'GOAL', 'goal', 'Company',
       'GOAL-', 4, 'Never', 1, 0, 'Active'
  FROM companies c
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (6) VERIFY fail-LOUD (RAISE EXCEPTION — mirror 0495/0498): đủ 7 perm · ma trận D5 22 hàng đúng · counter
--     mọi company · CHECK audit ⊇ 'goal' · module GOAL active. Idempotent: chạy lại vẫn PASS.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_n int;
BEGIN
  -- (a) đủ 7 cặp goal trong catalog
  SELECT COUNT(*) INTO v_n FROM permissions WHERE resource_type = 'goal';
  IF v_n <> 7 THEN
    RAISE EXCEPTION '[0506] verify: catalog có % cặp goal, kỳ vọng 7 — bước (2) trượt', v_n;
  END IF;

  -- (b1) tổng ĐÚNG 22 grant ALLOW resource=goal cho 4 role canonical (chống over/under-grant)
  SELECT COUNT(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name IN ('employee', 'manager', 'hr', 'company-admin')
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW' AND p.resource_type = 'goal';
  IF v_n <> 22 THEN
    RAISE EXCEPTION '[0506] verify: % grant goal cho 4 role canonical, kỳ vọng 22 — over/under-grant (drift?)', v_n;
  END IF;

  -- (b2) employee KHÔNG có finalize:goal (D5)
  SELECT COUNT(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name = 'employee' AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW' AND p.action = 'finalize' AND p.resource_type = 'goal';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0506] verify: employee CÓ finalize:goal (% hàng) — vỡ D5 (không được grant)', v_n;
  END IF;

  -- (b3) hr KHÔNG có cặp GHI goal (create/update/delete/checkin/finalize) — chỉ access+view
  SELECT COUNT(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name = 'hr' AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW' AND p.resource_type = 'goal'
     AND p.action IN ('create', 'update', 'delete', 'checkin', 'finalize');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0506] verify: hr CÓ % cặp ghi goal — vỡ D5 (hr chỉ view Company)', v_n;
  END IF;

  -- (c) mọi company có counter 'goal' scope Company (prefix/pad/Never)
  SELECT COUNT(*) INTO v_n
    FROM companies c
   WHERE NOT EXISTS (
     SELECT 1 FROM sequence_counters sc
      WHERE sc.company_id = c.id AND sc.sequence_key = 'goal'
        AND sc.scope_type = 'Company' AND sc.prefix = 'GOAL-'
        AND sc.padding_length = 4 AND sc.reset_policy = 'Never' AND sc.deleted_at IS NULL
   );
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0506] verify: % company thiếu counter goal — nextCode goal đầu tiên sẽ 404', v_n;
  END IF;

  -- (d) CHECK audit_logs.object_type chứa 'goal'. ⚠️ 0474 re-stamp dạng '{...}'::text[] (giá trị BARE, không
  --     bao nháy) ⇒ so LIKE '%''goal''%' (nháy đơn) MẤT khớp. Dùng regex biên [, { '] goal [' , }] — phủ cả
  --     dạng bare (',goal,' trong '{...}') lẫn dạng ARRAY-quoted ('goal') nếu CHECK từng re-stamp kiểu khác.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
       AND conname LIKE '%object_type%'
       AND pg_get_constraintdef(oid) ~ '[,{'']goal['',}]'
  ) THEN
    RAISE EXCEPTION '[0506] verify: CHECK audit_logs.object_type CHƯA chứa ''goal'' — bước (4) trượt';
  END IF;

  -- (e) module GOAL active
  IF NOT EXISTS (
    SELECT 1 FROM modules
     WHERE module_code = 'GOAL' AND deleted_at IS NULL
       AND is_active = true AND module_group = 'Collaboration' AND sort_order = 6
  ) THEN
    RAISE EXCEPTION '[0506] verify: module GOAL (Collaboration, sort_order 6, active) không tồn tại sau seed';
  END IF;

  RAISE NOTICE '[0506] verify PASS: 7 perm goal + 22 grant D5 + counter mọi company + audit CHECK goal + module GOAL';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM role_permissions rp USING permissions p
--   WHERE rp.permission_id = p.id AND p.resource_type = 'goal';
-- DELETE FROM permissions WHERE resource_type = 'goal';
-- DELETE FROM modules WHERE module_code = 'GOAL';
-- UPDATE sequence_counters SET deleted_at = now() WHERE sequence_key = 'goal' AND scope_type = 'Company';
-- -- CHECK audit_logs object_type union KHÔNG thu hẹp (append-only #2 — ADD-only vô hại).
