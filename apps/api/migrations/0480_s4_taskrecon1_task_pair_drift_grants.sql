-- Migration 0480: S4-TASK-RECON-1 (🔴 RED, zone=red, crown) — đối soát TASK pair-drift + grant tồn dư.
--   Nguồn sự thật: DB-06 §12.1 (TASK.TASK.COMMENT = (comment,'task')) + §6/§12.2 data scope; ma trận
--   §6 canonical (company-admin=Company · employee=Own). NỐI TIẾP 0479 (S4-NOTI-DB-1) — hot-file APPEND.
--
-- BỐI CẢNH (drift): POST /tasks/:taskId/comments đang enforce cặp LEGACY (comment,'comment') — media-era
--   (0005/0420). Canonical DB-06 §12.1 = (comment,'task'). Lane controllerSwap đổi decorator
--   tasks.controller.ts:206 sang ('comment','task') CÙNG release.
--
-- ⚠️ EXPAND-ONLY (owner chốt 2026-07-09). Bản nháp đầu gộp cả contract (gỡ grant comment:comment) vào
--   migration này, dựa trên giả định "single-node stop→migrate→start atomic". GIẢ ĐỊNH ĐÓ SAI:
--   mediaos.ps1 Invoke-Migrate chỉ chạy `pnpm db:migrate` và KHÔNG stop service (Release job trong
--   .github/workflows/api.yml còn là placeholder TODO). TasksModule CÓ mount (app.module.ts:53) ⇒ giữa
--   lúc migrate xong và lúc rebuild+restart, code CŨ vẫn enforce (comment,'comment') trong khi grant đã
--   bị gỡ ⇒ employee ăn 403 khi bình luận. Không có wildcard (*,*) trong 0005 để cứu.
--   ⇒ Migration này CHỈ EXPAND: seed cặp mới + cấp grant mới, GIỮ NGUYÊN grant legacy (comment,'comment').
--     Hai grant cùng tồn tại ⇒ KHÔNG có cửa sổ 403 theo BẤT KỲ thứ tự deploy nào (migrate trước hay sau).
--   ⇒ CONTRACT (gỡ (comment,'comment') khỏi employee + company-admin) tách sang S4-TASK-RECON-2, chạy ở
--     RELEASE SAU khi code gate (comment,'task') đã chạy ổn định. Đúng expand-contract.
--
-- NỘI-THỨ-TỰ BẮT BUỘC (bước (3) đổi decorator ở lane controllerSwap; bước (4) contract ở RECON-2):
--   (1) Catalog: INSERT (comment,'task') is_sensitive=false — cặp canonical MỚI, SONG SONG (comment,'comment').
--   (2) Grant  : cấp (comment,'task') ALLOW cho role đang GIỮ (comment,'comment') = employee(Own) +
--                company-admin(Company) → giữ hành vi bình luận LIÊN TỤC qua khe đổi decorator.
--   (4') Park  : gỡ grant TỒN DƯ ngoài ma trận §6 mà KHÔNG route sống nào enforce, PER-PAIR (resolve
--                role_id+permission_id, DELETE đúng bộ). KHÔNG blanket theo role_id (mirror 0444/0445).
--                • company-admin: (submit,task),(manage,task),(manage,project),(assign,project)
--                • employee     : (submit,task)
--                • manager/hr   : KHÔNG có grant task/project để gỡ (0444/0445 chỉ cấp AUTH/HR).
--                • (comment,'comment') CỐ Ý GIỮ LẠI ở migration này — xem EXPAND-ONLY ở trên.
--
-- ĐÍCH HỘI TỤ (task+project grant-set MỖI role canonical sau 0480, không dư/không thiếu):
--   company-admin = {create,read,update,delete,assign,comment}:task ∪ {create,read,update,delete}:project
--                   ∪ {(comment,'comment')}   ← legacy, gỡ ở RECON-2
--   employee      = {read,comment}:task ∪ {(comment,'comment')}   ← legacy, gỡ ở RECON-2
--   manager = ∅ · hr = ∅
--
-- HOT-FILE §9.3 / BẤT BIẾN:
--   • THUẦN ADDITIVE DATA: chỉ INSERT/DELETE data (permissions/role_permissions). KHÔNG DDL, KHÔNG đụng
--     RLS/FORCE/policy/grant của mig 0005 → BẤT BIẾN #1 GIỮ NGUYÊN. KHÔNG db:generate (DO-block thủ công).
--   • KHÔNG đụng cột is_sensitive của row khác — chỉ INSERT (comment,'task') is_sensitive=false; catalog
--     23-mã canonical còn lại thuộc S4-TASK-SEED-1 (WO khác). KHÔNG UPDATE is_sensitive.
--   • Catalog: INSERT ON CONFLICT(action,resource_type) DO NOTHING (hot-file UNION — cặp có sẵn không nhân đôi).
--   • role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ ON CONFLICT KHÔNG sửa
--     scope. Grant per-pair = DELETE đúng (role_id,permission_id,'ALLOW') có scope SAI + INSERT lại scope §6.
--     Park = DELETE đúng (role_id,permission_id,'ALLOW') per-pair. ⛔ KHÔNG blanket DELETE theo role_id (mất
--     grant media/parked). App role KHÔNG có UPDATE/DELETE role_permissions ở runtime (mig 0005) — migrator
--     chạy role privileged (DATABASE_DIRECT_URL) → di quyền qua DELETE+INSERT tại migrate-time (BẤT BIẾN #2).
--   • Idempotent BỘ-BA (role_id, permission_id, data_scope): chạy lại = no-op (grant DELETE-wrong-scope
--     không khớp + INSERT trúng ON CONFLICT; park DELETE 0 row vì đã gỡ). journal đơn điệu.
--
-- BAND 0480 (lane reconMig / S4-TASK-RECON-1). Journal: idx 160, when 1717500795000 (> head 0479 idx 159 /
--   1717500790000). Nối tiếp ĐƠN ĐIỆU sau 0479_s4_notidb1_notification_core.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (1) Catalog: cặp canonical (comment,'task') (DB-06 §12.1 TASK.TASK.COMMENT). is_sensitive=false (WRITE
--     thường, mirror mọi cặp TASK). ON CONFLICT(action,resource_type) DO NOTHING (hot-file UNION).
--     ⛔ KHÔNG đụng is_sensitive của cặp khác — chỉ thêm 1 row MỚI. Phần catalog 23-mã còn lại = S4-TASK-SEED-1.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('comment', 'task', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (2) Grant (comment,'task') cho role đang GIỮ (comment,'comment') = employee(Own) + company-admin(Company)
--     (data_scope §6/§12.2). Mirror 0444 DO-block: resolve role_id+permission_id → DELETE đúng bộ
--     (role_id,permission_id,'ALLOW') có scope SAI (per-pair, KHÔNG blanket) → INSERT lại scope §6
--     ON CONFLICT(role_id,permission_id,effect) DO NOTHING. Idempotent bộ-ba: lần 2 = no-op.
--     Cặp MỚI ⇒ DELETE-wrong-scope thực tế no-op lần đầu; INSERT thêm grant. Giữ bình luận LIÊN TỤC.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  grants CONSTANT text[][] := ARRAY[
    -- TASK.TASK.COMMENT (comment,'task') — §6 canonical scope
    ['employee',      'comment', 'task', 'Own'],
    ['company-admin', 'comment', 'task', 'Company']
  ];
  g           text[];
  v_role_id   uuid;
  v_perm_id   uuid;
  v_seeded    int := 0;
  v_rescoped  int := 0;
  v_del       int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY grants LOOP
    -- resolve role canonical (system role: company_id NULL, chưa xoá mềm)
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0480] role canonical % không tồn tại — seed 0005/0444 phải chạy trước', g[1];
    END IF;

    -- resolve permission (catalog (1) phải đã chạy)
    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0480] permission (%:%) không có trong catalog — bước (1) phải chạy trước', g[2], g[3];
    END IF;

    -- DELETE đúng bộ (role_id,permission_id,'ALLOW') có scope SAI (per-pair, KHÔNG blanket) → idempotent + KHÔNG đụng cặp/role khác.
    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW'
       AND data_scope <> g[4];
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    -- INSERT lại scope §6. ON CONFLICT(role_id,permission_id,effect) DO NOTHING → idempotent.
    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', g[4])
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0480] (comment,task) grant: % cặp INSERT mới, % cặp re-scope', v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (4) Park grant TỒN DƯ ngoài ma trận §6 (per-pair DELETE — resolve role_id+permission_id, mirror 0444/0445).
--     ⛔ TUYỆT ĐỐI KHÔNG blanket DELETE theo role_id (giữ mọi grant media/parked/AUTH/HR khác).
--     Chỉ gỡ đúng bộ (role_id, permission_id, 'ALLOW') liệt kê tường minh. Idempotent: lần 2 DELETE 0 row.
--     Role/permission thiếu ⇒ CONTINUE (không có gì để park — DB không có row cần gỡ).
--     • company-admin got ALL is_sensitive=false (0005) ⇒ dư submit/manage:task, manage/assign:project,
--       comment:comment (legacy). Gỡ 5 cặp → về {create,read,update,delete,assign,comment}:task ∪ CRUD:project.
--     • employee (0005) got read/submit:task + comment:comment ⇒ gỡ submit:task + comment:comment → {read,comment}:task.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- EXPAND-ONLY: chỉ gỡ grant tồn dư mà KHÔNG route sống nào enforce.
  -- (comment,'comment') CỐ Ý KHÔNG có ở đây — code cũ còn enforce nó tới lúc restart ⇒ gỡ bây giờ = 403.
  -- Contract cặp đó nằm ở S4-TASK-RECON-2 (release sau). Xem khối EXPAND-ONLY ở đầu file.
  revokes CONSTANT text[][] := ARRAY[
    -- company-admin: gỡ 4 cặp tồn dư (submit/manage:task · manage/assign:project)
    ['company-admin', 'submit',  'task'],
    ['company-admin', 'manage',  'task'],
    ['company-admin', 'manage',  'project'],
    ['company-admin', 'assign',  'project'],
    -- employee: gỡ submit:task (legacy over-grant, không route nào enforce)
    ['employee',      'submit',  'task']
  ];
  r           text[];
  v_role_id   uuid;
  v_perm_id   uuid;
  v_parked    int := 0;
  v_del       int;
BEGIN
  FOREACH r SLICE 1 IN ARRAY revokes LOOP
    -- resolve role canonical (system role: company_id NULL, chưa xoá mềm)
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = r[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      CONTINUE;  -- role không có ⇒ không có grant để park
    END IF;

    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = r[2] AND resource_type = r[3];
    IF v_perm_id IS NULL THEN
      CONTINUE;  -- permission không có trong catalog ⇒ không có grant để park
    END IF;

    -- PER-PAIR DELETE (KHÔNG blanket): chỉ đúng bộ (role_id, permission_id, 'ALLOW').
    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW';
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_parked := v_parked + v_del;
  END LOOP;

  RAISE NOTICE '[0480] park residual: % grant DELETE (per-pair)', v_parked;
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- Khôi phục residual (nếu roll back TRƯỚC khi controllerSwap land — nếu không sẽ mở 403):
-- DO $$ DECLARE v_ca uuid; v_emp uuid; BEGIN
--   SELECT id INTO v_ca  FROM roles WHERE name='company-admin' AND company_id IS NULL AND deleted_at IS NULL;
--   SELECT id INTO v_emp FROM roles WHERE name='employee'      AND company_id IS NULL AND deleted_at IS NULL;
--   INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
--   SELECT v_ca, p.id, 'ALLOW', 'Company' FROM permissions p
--    WHERE (p.action,p.resource_type) IN (('submit','task'),('manage','task'),('manage','project'),('assign','project'),('comment','comment'))
--   ON CONFLICT DO NOTHING;
--   INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
--   SELECT v_emp, p.id, 'Company' ... (submit,task),(comment,comment) ON CONFLICT DO NOTHING;
-- END $$;
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id AND r.company_id IS NULL
--     AND r.name IN ('employee','company-admin') AND (p.action,p.resource_type)=('comment','task');
-- DELETE FROM permissions WHERE (action,resource_type)=('comment','task');  -- chỉ khi 0 grant tham chiếu
