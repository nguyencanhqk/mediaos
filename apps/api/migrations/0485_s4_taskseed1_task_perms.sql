-- Migration 0485: S4-TASK-SEED-1 (🔴 RED, zone=red, crown) — seed permission TASK 23 mã canonical
--   (DB-06 §12.1) + role-permission mapping per-(role,pair) theo SPEC-06 §9. Plan (truy nguyên từng
--   hàng + owner chốt 2026-07-09): docs/plans/S4-TASK-SEED-1.md.
--
-- OWNER CHỐT 2026-07-09 (backlog done_when):
--   • Catalog = ĐÚNG 23 mã, KHÔNG hơn: KHÔNG cặp 'checklist' (gate bằng update:task); KHÔNG
--     TASK.PROJECT.FILE_UPLOAD/FILE_DELETE (SPEC-06 §8.2 TK-1 có nhưng DB-06 §12.1 không — WO khác).
--   • is_sensitive=TRUE (8): delete/close/archive/manage-member/view-report:project +
--     delete/export:task + view:task-audit-log. Còn lại (15) false.
--   • ('delete','project') + ('delete','task') ĐÃ tồn tại is_sensitive=false từ 0005 ⇒ ON CONFLICT
--     DO NOTHING KHÔNG nâng được → bước (b) UPDATE idempotent riêng (mirror 0476 nâng delete:user).
--
-- HIỆN TRẠNG (chuỗi sạch 0000→0484, đã pre-check DB thật prod/dev 2026-07-10 — KHÔNG drift runtime):
--   • Catalog family: 10 cặp canonical (0005/0480) + legacy submit/manage:task, manage/assign:project,
--     delete-project:project (dị dạng, giữ nguyên), comment:comment (RECON-2 gỡ).
--   • Grants canonical: company-admin 10 cặp @Company · employee read:task @Company (default 0441 —
--     PHẢI re-scope Own) + comment:task @Own (0480) · manager = hr = ∅.
--   • Role media parked (channel-manager/project-manager/…) giữ grant riêng — NGOÀI phạm vi, không đụng.
--
-- THIẾT KẾ / BẤT BIẾN (mirror 0454 + 0476 + 0480):
--   • THUẦN DATA: chỉ INSERT/UPDATE(permissions.is_sensitive)/DELETE-wrong-scope. KHÔNG DDL, KHÔNG
--     RLS/FORCE/policy (bất biến #1 giữ nguyên). KHÔNG seed super-admin (bootstrap load FULL catalog
--     @System mỗi boot — super-admin-bootstrap.repository.ts:127). KHÔNG re-active module task.
--   • role_permissions UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ đổi scope =
--     per-pair DELETE đúng bộ có scope SAI + INSERT (⛔ KHÔNG blanket theo role_id — giữ grant
--     media/parked). App role KHÔNG có UPDATE/DELETE role_permissions runtime (0005) — di quyền
--     tại migrate-time qua DATABASE_DIRECT_URL (bất biến #2).
--   • Idempotent bộ-ba (role, permission, scope): chạy lại = no-op (DELETE-wrong-scope không khớp,
--     INSERT trúng ON CONFLICT, UPDATE lọc WHERE is_sensitive=false).
--   • Re-scope employee read:task Company→Own = THU HẸP CHỦ ĐÍCH (SPEC-06 §9:533 "chỉ task liên
--     quan"); grant ALLOW liên tục — KHÔNG có cửa sổ 403. Route legacy /tasks gate pair-only (chưa
--     áp data-scope) → hành vi runtime hôm nay không đổi; scope có hiệu lực khi S4-TASK-BE-* enforce.
--   • ⚠️ 5 GRANT HOÃN sang S4-TASK-BE-2 (plan-reviewer BLOCK 2026-07-10, chọn fail-closed): route
--     sống pair-only KHÔNG có scope/owner-check trên actor (tasks.controller: POST /tasks ·
--     PATCH /tasks/:id{,/status,/labels/*} · DELETE /tasks/:id + DELETE attachment; tasks.service
--     KHÔNG check creator/assignee/membership) ⇒ grant write/destructive NET-NEW cho role scope-đích
--     < Company sẽ mở ghi/xóa TOÀN-CÔNG-TY ngay khi migrate (migrate không stop service). HOÃN:
--     employee create/update:task@Own · manager create/update/delete:task@Team — BE-2 grant CÙNG
--     release với enforcement scope+membership (TASK_DEFERRED_GRANTS trong task-permissions.const).
--     Employee/manager hôm nay 403 trên các route đó → GIỮ 403 (không regression, không escalation).
--     GIỮ + disclose: manager read:task@Team (net-new READ — cùng lớp đã-chấp-nhận với employee
--     read:task@Company từ 0005; non-destructive) · manager/hr comment:task (mirror RECON-1) ·
--     hr create/update:task@Company (scope-đích = hành vi route → KHÔNG escalation).
--   • Verify (d) fail-LOUD exact-set: 4 role canonical × tập 23 cặp canonical tường minh (miễn nhiễm
--     legacy pairs + role media parked) — pattern MỚI mạnh hơn 0454/0480 (chỉ RAISE resolve-fail),
--     an toàn nhờ pre-check drift ở trên; drift tương lai → RAISE là hành vi ĐÚNG (lộ, không nuốt).
--
-- BAND 0485 (S4-TASK-SEED-1). Journal: idx 165, when 1717500820000 (> head 0484 idx 164 /
--   1717500815000). Nối tiếp ĐƠN ĐIỆU sau 0484_s4_dashseed1_widget_catalog_perms.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) Catalog: 23 cặp canonical. ON CONFLICT(action,resource_type) DO NOTHING (hot-file UNION —
--     10 cặp đã có từ 0005/0480 giữ nguyên row, 13 cặp MỚI insert với is_sensitive đúng đích).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  -- project (8): read/create/update non-sensitive (read = cổng nav FE); lifecycle/member/report sensitive
  ('read',           'project', false),
  ('create',         'project', false),
  ('update',         'project', false),
  ('delete',         'project', true),
  ('close',          'project', true),
  ('archive',        'project', true),
  ('manage-member',  'project', true),
  ('view-report',    'project', true),
  -- task (14): thao tác thường non-sensitive; delete/export sensitive
  ('read',            'task', false),
  ('create',          'task', false),
  ('update',          'task', false),
  ('delete',          'task', true),
  ('assign',          'task', false),
  ('comment',         'task', false),
  ('watch',           'task', false),
  ('export',          'task', true),
  ('view-kanban',     'task', false),
  ('update-status',   'task', false),
  ('update-priority', 'task', false),
  ('update-deadline', 'task', false),
  ('file-upload',     'task', false),
  ('file-delete',     'task', false),
  -- task-audit-log (1): resource DISTINCT (KHÔNG tái dùng generic 'audit-log' — tránh over-grant;
  -- mirror attendance-audit-log/leave-audit-log). task_activity_logs (0478) append-only — chỉ 'view'.
  ('view', 'task-audit-log', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (b) NÂNG is_sensitive false→true cho 8 cặp sensitive (mirror 0476(b) nâng delete:user).
--     Bắt buộc vì delete:project (0005 L225) + delete:task (0005 L251) tồn tại false ⇒ (a) không
--     nâng được. WHERE is_sensitive=false → idempotent; 6 cặp mới insert true = no-op.
--     ⛔ KHÔNG đụng cặp ngoài danh sách (read:project/read:task PHẢI GIỮ false — cổng getCapabilities).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
UPDATE permissions SET is_sensitive = true
 WHERE (action, resource_type) IN (
   ('delete',        'project'),
   ('close',         'project'),
   ('archive',       'project'),
   ('manage-member', 'project'),
   ('view-report',   'project'),
   ('delete',        'task'),
   ('export',        'task'),
   ('view',          'task-audit-log')
 )
   AND is_sensitive = false;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (c) Grants per-(role,pair) 67 hàng = ma trận SPEC-06 §9 (truy nguyên: plan §3) TRỪ 5 grant hoãn
--     (xem khối ⚠️ trên): employee 7 @Own · manager 19 @Team · hr 18 @Company · company-admin 23 @Company.
--     "Nếu owner/creator" của manager (close/delete/archive/manage-member:project, delete:task) =
--     owner-check per-project ở BE (S4-TASK-BE-1) — seed chỉ cấp capability @Team.
--     Mirror 0480/0454 DO-block: resolve fail-LOUD → per-pair DELETE-wrong-scope → INSERT ON CONFLICT.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  grants CONSTANT text[][] := ARRAY[
    -- ── employee (7 @Own — SPEC-06 §9: read member-project :528; task liên quan :533; status
    --    assignee :537; comment :538; upload :539; watch/view-kanban = §6.7 + §12.3(5) + FUNC-013.
    --    KHÔNG file-delete/priority/deadline/assign. create/update:task :534/:536 HOÃN → BE-2 ⚠️)
    ['employee', 'read',          'project', 'Own'],
    ['employee', 'read',          'task',    'Own'],
    ['employee', 'update-status', 'task',    'Own'],
    ['employee', 'comment',       'task',    'Own'],
    ['employee', 'file-upload',   'task',    'Own'],
    ['employee', 'watch',         'task',    'Own'],
    ['employee', 'view-kanban',   'task',    'Own'],
    -- ── manager (19 @Team — mọi cặp trừ view:task-audit-log; create/update/delete:task HOÃN → BE-2 ⚠️)
    ['manager', 'read',            'project', 'Team'],
    ['manager', 'create',          'project', 'Team'],
    ['manager', 'update',          'project', 'Team'],
    ['manager', 'close',           'project', 'Team'],
    ['manager', 'archive',         'project', 'Team'],
    ['manager', 'delete',          'project', 'Team'],
    ['manager', 'manage-member',   'project', 'Team'],
    ['manager', 'view-report',     'project', 'Team'],
    ['manager', 'read',            'task',    'Team'],
    ['manager', 'assign',          'task',    'Team'],
    ['manager', 'comment',         'task',    'Team'],
    ['manager', 'watch',           'task',    'Team'],
    ['manager', 'export',          'task',    'Team'],
    ['manager', 'view-kanban',     'task',    'Team'],
    ['manager', 'update-status',   'task',    'Team'],
    ['manager', 'update-priority', 'task',    'Team'],
    ['manager', 'update-deadline', 'task',    'Team'],
    ['manager', 'file-upload',     'task',    'Team'],
    ['manager', 'file-delete',     'task',    'Team'],
    -- ── hr (18 @Company — SPEC-06 §9 "Không mặc định": close/delete/archive/manage-member:project
    --    + delete:task. view:task-audit-log theo tiền lệ 0454:211/0455 hr+admin)
    ['hr', 'read',            'project',        'Company'],
    ['hr', 'create',          'project',        'Company'],
    ['hr', 'update',          'project',        'Company'],
    ['hr', 'view-report',     'project',        'Company'],
    ['hr', 'read',            'task',           'Company'],
    ['hr', 'create',          'task',           'Company'],
    ['hr', 'update',          'task',           'Company'],
    ['hr', 'assign',          'task',           'Company'],
    ['hr', 'comment',         'task',           'Company'],
    ['hr', 'watch',           'task',           'Company'],
    ['hr', 'export',          'task',           'Company'],
    ['hr', 'view-kanban',     'task',           'Company'],
    ['hr', 'update-status',   'task',           'Company'],
    ['hr', 'update-priority', 'task',           'Company'],
    ['hr', 'update-deadline', 'task',           'Company'],
    ['hr', 'file-upload',     'task',           'Company'],
    ['hr', 'file-delete',     'task',           'Company'],
    ['hr', 'view',            'task-audit-log', 'Company'],
    -- ── company-admin (23 @Company — đủ bộ, done_when #5 "/auth/me đủ 23 cặp")
    ['company-admin', 'read',            'project',        'Company'],
    ['company-admin', 'create',          'project',        'Company'],
    ['company-admin', 'update',          'project',        'Company'],
    ['company-admin', 'delete',          'project',        'Company'],
    ['company-admin', 'close',           'project',        'Company'],
    ['company-admin', 'archive',         'project',        'Company'],
    ['company-admin', 'manage-member',   'project',        'Company'],
    ['company-admin', 'view-report',     'project',        'Company'],
    ['company-admin', 'read',            'task',           'Company'],
    ['company-admin', 'create',          'task',           'Company'],
    ['company-admin', 'update',          'task',           'Company'],
    ['company-admin', 'delete',          'task',           'Company'],
    ['company-admin', 'assign',          'task',           'Company'],
    ['company-admin', 'comment',         'task',           'Company'],
    ['company-admin', 'watch',           'task',           'Company'],
    ['company-admin', 'export',          'task',           'Company'],
    ['company-admin', 'view-kanban',     'task',           'Company'],
    ['company-admin', 'update-status',   'task',           'Company'],
    ['company-admin', 'update-priority', 'task',           'Company'],
    ['company-admin', 'update-deadline', 'task',           'Company'],
    ['company-admin', 'file-upload',     'task',           'Company'],
    ['company-admin', 'file-delete',     'task',           'Company'],
    ['company-admin', 'view',            'task-audit-log', 'Company']
  ];
  g           text[];
  v_role_id   uuid;
  v_perm_id   uuid;
  v_seeded    int := 0;
  v_rescoped  int := 0;
  v_del       int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY grants LOOP
    -- resolve role canonical (system role: company_id NULL, chưa xoá mềm) — fail-LOUD
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0485] role canonical % không tồn tại — seed 0005/0444 phải chạy trước', g[1];
    END IF;

    -- resolve permission (bước (a) phải đã chạy) — fail-LOUD
    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0485] permission (%:%) không có trong catalog — bước (a) trượt', g[2], g[3];
    END IF;

    -- per-pair DELETE đúng bộ (role_id,permission_id,'ALLOW') có scope SAI — KHÔNG blanket.
    -- Ca thật duy nhất trên chuỗi sạch: employee read:task @Company (0441) → Own.
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

  RAISE NOTICE '[0485] TASK grants: % INSERT mới, % re-scope', v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (d) Verify fail-LOUD EXACT-SET: 4 role canonical × tập 23 cặp canonical tường minh.
--     Sau (c), mỗi hàng kỳ vọng CHẮC CHẮN tồn tại đúng scope (DELETE-wrong-scope + INSERT +
--     UNIQUE(role,perm,effect) cho phép đúng 1 hàng ALLOW) ⇒ verify còn lại = chống OVER-grant
--     (đếm EXACT per role trên tập canonical) + cờ sensitive + probe re-scope crux.
--     Miễn nhiễm legacy (submit/manage:task, comment:comment, delete-project:project) + role media
--     parked (không nằm trong 4 role soi). Drift → RAISE = abort migrate (lộ sớm, không nuốt).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  expected_counts CONSTANT text[][] := ARRAY[
    ['employee', '7'], ['manager', '19'], ['hr', '18'], ['company-admin', '23']
  ];
  e         text[];
  v_n       int;
  v_scope   text;
BEGIN
  FOREACH e SLICE 1 IN ARRAY expected_counts LOOP
    SELECT COUNT(*) INTO v_n
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r.name = e[1] AND r.company_id IS NULL AND r.deleted_at IS NULL
       AND rp.effect = 'ALLOW'
       AND (p.action, p.resource_type) IN (
         ('read','project'),('create','project'),('update','project'),('delete','project'),
         ('close','project'),('archive','project'),('manage-member','project'),('view-report','project'),
         ('read','task'),('create','task'),('update','task'),('delete','task'),('assign','task'),
         ('comment','task'),('watch','task'),('export','task'),('view-kanban','task'),
         ('update-status','task'),('update-priority','task'),('update-deadline','task'),
         ('file-upload','task'),('file-delete','task'),
         ('view','task-audit-log')
       );
    IF v_n <> e[2]::int THEN
      RAISE EXCEPTION '[0485] verify: role % có % grant trên tập 23 cặp canonical, kỳ vọng % — over/under-grant (drift?)',
        e[1], v_n, e[2];
    END IF;
  END LOOP;

  -- probe crux re-scope: employee read:task PHẢI @Own (0441 default là Company)
  SELECT rp.data_scope INTO v_scope
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name = 'employee' AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND p.action = 'read' AND p.resource_type = 'task' AND rp.effect = 'ALLOW';
  IF v_scope IS DISTINCT FROM 'Own' THEN
    RAISE EXCEPTION '[0485] verify: employee read:task scope=% — re-scope Company→Own trượt', v_scope;
  END IF;

  -- cờ sensitive: 8 cặp PHẢI true (bước (b) trượt nếu còn false)
  IF EXISTS (
    SELECT 1 FROM permissions
     WHERE (action, resource_type) IN (
       ('delete','project'),('close','project'),('archive','project'),
       ('manage-member','project'),('view-report','project'),
       ('delete','task'),('export','task'),('view','task-audit-log')
     ) AND is_sensitive = false
  ) THEN
    RAISE EXCEPTION '[0485] verify: còn cặp sensitive TASK mang is_sensitive=false — bước (b) trượt';
  END IF;

  -- cổng nav FE: read:project/read:task PHẢI non-sensitive (getCapabilities lọc bỏ mọi sensitive)
  IF EXISTS (
    SELECT 1 FROM permissions
     WHERE (action, resource_type) IN (('read','project'),('read','task'))
       AND is_sensitive = true
  ) THEN
    RAISE EXCEPTION '[0485] verify: read:project/read:task bị nâng sensitive — vỡ cổng nav FE';
  END IF;

  RAISE NOTICE '[0485] verify PASS: employee 7 · manager 19 · hr 18 · company-admin 23; sensitive flags đúng';
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id AND r.company_id IS NULL
--     AND r.name IN ('employee','manager','hr','company-admin')
--     AND p.resource_type IN ('project','task','task-audit-log')
--     AND NOT (r.name='company-admin' AND (p.action,p.resource_type) IN
--       (('create','project'),('read','project'),('update','project'),('delete','project'),
--        ('create','task'),('read','task'),('update','task'),('delete','task'),
--        ('assign','task'),('comment','task')))
--     AND NOT (r.name='employee' AND (p.action,p.resource_type) IN (('read','task'),('comment','task')));
-- -- khôi phục scope 0441 cho employee read:task nếu roll back:
-- -- UPDATE-equivalent qua DELETE+INSERT ('Company'); hạ is_sensitive:
-- UPDATE permissions SET is_sensitive=false WHERE (action,resource_type) IN
--   (('delete','project'),('delete','task'));
-- DELETE FROM permissions WHERE (action,resource_type) IN (('close','project'),('archive','project'),
--   ('manage-member','project'),('view-report','project'),('watch','task'),('export','task'),
--   ('view-kanban','task'),('update-status','task'),('update-priority','task'),
--   ('update-deadline','task'),('file-upload','task'),('file-delete','task'),
--   ('view','task-audit-log'));  -- chỉ khi 0 grant tham chiếu
