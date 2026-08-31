-- Migration 0560: S12-RECRUIT-DB-1 (🔴 RED, zone=red, crown) — SEED nghiệp vụ RECRUIT (DB-14 §9 bước B):
--   role hệ thống `recruiter` + 16 cặp quyền (7 sensitive) + 42 grant per-(role,pair) theo ma trận §9f +
--   UNION-ADD 4 giá trị vào CHECK audit_logs.object_type. THUẦN DATA/DDL-CHECK — KHÔNG db:generate.
--
-- BỐI CẢNH (seed qua migrator owner-bypass — mirror 0506:6-11 / 0550):
--   migrator chạy DATABASE_DIRECT_URL = role owner (rolbypassrls) ⇒ INSERT roles/permissions (global) +
--   role_permissions chạy TRỰC TIẾP. RLS chỉ chặn app role runtime.
--
-- QUYẾT ĐỊNH CHỐT (plan docs/plans/S12-RECRUIT-DB-1.md §3 · REC-DEC-001..008):
--   D1 modules.RECRUIT ĐÃ TỒN TẠI từ 0435 (Extension, is_active=false, sort_order 9). KHÔNG INSERT,
--      KHÔNG BẬT. Guard chỉ kiểm TỒN TẠI và **forward-compatible**: KHÔNG RAISE khi is_active=true —
--      chính S12-RECRUIT-FE-1 (khuôn 0556/0557) sẽ bật cờ, và ca idempotency H1 chạy lại NGUYÊN file này
--      (bài học module-enable-guard-blocks-next-wo 0550/0554 · plan-review H1). Hợp đồng "RECRUIT phải
--      inactive cho tới khi có màn" canh ở ĐÚNG chỗ cập nhật được: pin EXTENSION_INACTIVE_MODULES của
--      migration-smoke.int-spec.ts (đã có 'RECRUIT' từ trước — WO này KHÔNG đụng).
--   D2 role `recruiter` (REC-DEC-008): company_id NULL, is_system=true, requires_two_factor=false TƯỜNG
--      MINH, id cố định …0014 (…0012 = asset-manager, …0013 = office-admin). **KHÔNG canonical** — không
--      vào DashCanonicalRole / NOTI_CANONICAL_ROLES / pin auth-seed-canonical-roles (giữ 4 role). Hiring
--      manager = role `manager` sẵn có, KHÔNG role mới.
--   D3 16 cặp: **7 cặp resource `candidate` is_sensitive=TRUE** (REC-DEC-003 — PII ứng viên), 9 cặp còn
--      lại false. Chốt cùng seed, KHÔNG flip sau (canonical-seed-pin-regression). Cặp sensitive PHẢI được
--      khai allowlist capability ở BACKEND cùng WO BE, kẻo màn quản trị biến mất với chính role được grant.
--   D4 ma trận 42 hàng (§9f): employee 0 · manager 3 · hr 7 · company-admin 16 · recruiter 16.
--      Grant cho role canonical `hr` (KHÔNG phải role hệ thống `hr-manager` — role đó không nhận grant
--      RECRUIT ở v1; hệ quả: NOTI-EVENT-019 chỉ gửi `hr`, xem 0561).
--   D5 audit CHECK: clone NGUYÊN khối 0545/0550 (neo 2 tầng `object_type = ANY(…)`, fail-closed,
--      NO-LOSS + NO-GAIN) — KHÔNG clone 0506 bước 4 (parser chưa neo tầng-1:
--      audit-check-union-parse-anchor-trap). 4 giá trị: job_opening · candidate · interview · offer.
--      **Bản đồ hành động → object_type là danh sách ĐÓNG ở SPEC-12 §12**: ghi chú gom dưới `candidate`
--      (payload kèm noteId), feedback gom dưới `interview` (payload kèm feedbackId), export gom dưới
--      `candidate` — KHÔNG có candidate_note / interview_feedback riêng. Ghi ngoài bản đồ = CHECK
--      violation 500. Vế HR của convert audit riêng object_type='employee' (đã có sẵn trong CHECK).
--
-- ⚠️ HAI NAMESPACE CỐ Ý KHÁC NHAU (plan-review LOW): `object_type` audit dùng **snake** (`job_opening`)
--    theo họ giá trị có sẵn trong CHECK; resource của cặp quyền dùng **dash** (`job-opening`) theo quy ước
--    engine (`update-status`, `assign-role`). Census/grep phải quét CẢ HAI.
--
-- BẤT BIẾN / HOT-FILE:
--   #2 role_permissions UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ đổi scope = DELETE đúng
--      bộ scope SAI (per-pair, KHÔNG blanket) + INSERT ON CONFLICT DO NOTHING. CHECK audit: UNION ADD-only.
--      permissions/roles seed ON CONFLICT DO NOTHING. super-admin KHÔNG enumerate (bootstrap runtime).
--   • Mọi câu đếm role NEO `company_id IS NULL AND deleted_at IS NULL` (0506:215) — role tenant trùng tên
--     'hr'/'manager' không được thổi số.
--   • Census grant phủ **4 HÌNH DẠNG WILDCARD** (permission-grant-census-must-cover-four-wildcard-shapes):
--     engine resolve theo `action IN (act,'*') AND resource_type IN (res,'*')`, HAI VẾ ĐỘC LẬP. Census
--     exact-shape một mình MÙ trước hàng `*:*` / `*:candidate` / `view:*` — verify (b6) bịt lại.
--
-- BAND 0560 (lane S12-RECRUIT-DB-1). Journal: idx 227, when 1717587349000 (> 0559 idx 226 / 1717587348000).
--   AUDIT_OBJECT_TYPES (schema/audit.ts) sync 4 giá trị CÙNG commit.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) modules.RECRUIT: verify TỒN TẠI, KHÔNG bật cờ (mirror 0550:(1)) ───────────────
DO $$
DECLARE v_n int;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  SELECT count(*) INTO v_n FROM modules WHERE module_code = 'RECRUIT' AND deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0560] modules.RECRUIT khong ton tai (ky vong 1 hang tu mig 0435, dem duoc %)', v_n;
  END IF;
  -- CỐ Ý KHÔNG assert is_active (forward-compat — xem D1 + khối verify (e)).
  RAISE NOTICE '[0560] modules.RECRUIT ton tai (0560 KHONG bat co; S12-RECRUIT-FE-1 moi bat)';
END;
$$;
--> statement-breakpoint

-- ─────────────── (2) Role hệ thống recruiter (tiền lệ 0550 asset-manager; bare ON CONFLICT hợp lệ với partial unique) ─
INSERT INTO roles (id, company_id, name, description, is_system, requires_two_factor) VALUES
  ('00000000-0000-0000-0000-000000000014', NULL, 'recruiter',
   'Recruiter: phu trach tuyen dung toan cong ty — vi tri tuyen, ho so ung vien, pipeline, phong van, offer (SPEC-01 §10.7)',
   true, false)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ─────────────── (3) Catalog 16 cặp quyền RECRUIT (SPEC-12 §11 / permission-matrix §9f) ───────────────
--     Mã dotted RECRUIT.* chỉ ghi ở COMMENT — bảng permissions CHỈ có (action, resource_type, is_sensitive).
--     ⚠️ 7 cặp resource 'candidate' = is_sensitive TRUE (PII ứng viên — REC-DEC-003).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('access',     'recruit',     false),  -- RECRUIT.ACCESS                 cổng nav menu Tuyển dụng
  ('view',       'job-opening', false),  -- RECRUIT.JOB.VIEW               xem vị trí + đếm ứng viên
  ('create',     'job-opening', false),  -- RECRUIT.JOB.CREATE
  ('update',     'job-opening', false),  -- RECRUIT.JOB.UPDATE             sửa · gán recruiter · đổi FSM
  ('view',       'candidate',   true),   -- RECRUIT.CANDIDATE.VIEW         email/phone DẠNG CHE (§18)
  ('create',     'candidate',   true),   -- RECRUIT.CANDIDATE.CREATE       + check-duplicate + upload CV
  ('update',     'candidate',   true),   -- RECRUIT.CANDIDATE.UPDATE       giữ cặp này ⇒ thấy PII KHÔNG che
  ('move-stage', 'candidate',   true),   -- RECRUIT.CANDIDATE.MOVE-STAGE   chuyển stage kèm lý do
  ('comment',    'candidate',   true),   -- RECRUIT.CANDIDATE.COMMENT      ghi chú nội bộ
  ('export',     'candidate',   true),   -- RECRUIT.CANDIDATE.EXPORT       đòi CẢ export + view (§18)
  ('convert',    'candidate',   true),   -- RECRUIT.CANDIDATE.CONVERT      ứng viên → nhân viên
  ('view',       'interview',   false),  -- RECRUIT.INTERVIEW.VIEW         @Own = EXISTS participant
  ('manage',     'interview',   false),  -- RECRUIT.INTERVIEW.MANAGE       xếp/sửa/kết thúc/huỷ lượt
  ('feedback',   'interview',   false),  -- RECRUIT.INTERVIEW.FEEDBACK     @Own cho MỌI role
  ('view',       'offer',       false),  -- RECRUIT.OFFER.VIEW             KHÔNG lương
  ('manage',     'offer',       false)   -- RECRUIT.OFFER.MANAGE           + THẤY lương (mask ở service)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────── (4) Grant per-(role, pair) ma trận §9f = 42 hàng (mirror 0550 bước 4) ───────────────
DO $$
DECLARE
  recruit_grants CONSTANT text[][] := ARRAY[
    -- manager (3): cổng nav + lượt phỏng vấn MÌNH ĐƯỢC XẾP + feedback của mình
    ['manager',       'access',     'recruit',     'Own'],
    ['manager',       'view',       'interview',   'Own'],
    ['manager',       'feedback',   'interview',   'Own'],
    -- hr (7): đọc toàn công ty 4 mặt + convert + feedback của mình. KHÔNG cặp GHI nào khác.
    ['hr',            'access',     'recruit',     'Own'],
    ['hr',            'view',       'job-opening', 'Company'],
    ['hr',            'view',       'candidate',   'Company'],
    ['hr',            'view',       'interview',   'Company'],
    ['hr',            'view',       'offer',       'Company'],
    ['hr',            'convert',    'candidate',   'Company'],
    ['hr',            'feedback',   'interview',   'Own'],
    -- company-admin (16): access @Own · feedback @Own · 14 cặp còn lại @Company
    ['company-admin', 'access',     'recruit',     'Own'],
    ['company-admin', 'feedback',   'interview',   'Own'],
    ['company-admin', 'view',       'job-opening', 'Company'],
    ['company-admin', 'create',     'job-opening', 'Company'],
    ['company-admin', 'update',     'job-opening', 'Company'],
    ['company-admin', 'view',       'candidate',   'Company'],
    ['company-admin', 'create',     'candidate',   'Company'],
    ['company-admin', 'update',     'candidate',   'Company'],
    ['company-admin', 'move-stage', 'candidate',   'Company'],
    ['company-admin', 'comment',    'candidate',   'Company'],
    ['company-admin', 'export',     'candidate',   'Company'],
    ['company-admin', 'convert',    'candidate',   'Company'],
    ['company-admin', 'view',       'interview',   'Company'],
    ['company-admin', 'manage',     'interview',   'Company'],
    ['company-admin', 'view',       'offer',       'Company'],
    ['company-admin', 'manage',     'offer',       'Company'],
    -- recruiter (16): như company-admin
    ['recruiter',     'access',     'recruit',     'Own'],
    ['recruiter',     'feedback',   'interview',   'Own'],
    ['recruiter',     'view',       'job-opening', 'Company'],
    ['recruiter',     'create',     'job-opening', 'Company'],
    ['recruiter',     'update',     'job-opening', 'Company'],
    ['recruiter',     'view',       'candidate',   'Company'],
    ['recruiter',     'create',     'candidate',   'Company'],
    ['recruiter',     'update',     'candidate',   'Company'],
    ['recruiter',     'move-stage', 'candidate',   'Company'],
    ['recruiter',     'comment',    'candidate',   'Company'],
    ['recruiter',     'export',     'candidate',   'Company'],
    ['recruiter',     'convert',    'candidate',   'Company'],
    ['recruiter',     'view',       'interview',   'Company'],
    ['recruiter',     'manage',     'interview',   'Company'],
    ['recruiter',     'view',       'offer',       'Company'],
    ['recruiter',     'manage',     'offer',       'Company']
  ];
  g          text[];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_rescoped int := 0;
  v_del      int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY recruit_grants LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0560] role he thong % khong ton tai — seed 0005/0444/(2) phai chay truoc', g[1];
    END IF;

    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0560] permission (%:%) khong co trong catalog — buoc (3) phai chay truoc', g[2], g[3];
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

  RAISE NOTICE '[0560] RECRUIT grants: % INSERT moi, % re-scope (4 role x ma tran §9f = 42 hang; employee 0)',
    v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ─────────────── (5) CHECK audit_logs.object_type += 4 giá trị — CLONE NGUYÊN KHỐI 0545/0550 (neo 2 tầng) ───────────
DO $$
DECLARE
  v_oid     oid;
  v_con     text;
  v_def     text;
  v_raw     text;
  v_matched boolean := false;
  v_cnt     int;
  v_cur     text[];
  v_new     text[] := ARRAY['job_opening', 'candidate', 'interview', 'offer'];
  v_add     text[];
  v_union   text[];
  v_after   text[];
  v_missing text[];
  v_extra   text[];
BEGIN
  -- ── (0) Fail fast thay vì xếp hàng sau lock ──
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── (1) Resolve CHECK: ưu tiên TÊN CHÍNH XÁC; fallback LIKE nhưng fail-closed khi số match ≠ 1 ──
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname = 'audit_logs_object_type_chk';

  IF v_oid IS NULL THEN
    SELECT count(*) INTO v_cnt
      FROM pg_constraint
     WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
       AND conname LIKE '%object_type%';

    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '[0560] khong xac dinh duoc CHECK object_type tren audit_logs (so match = %) — DUNG fail-closed', v_cnt;
    END IF;

    SELECT oid, conname INTO v_oid, v_con
      FROM pg_constraint
     WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
       AND conname LIKE '%object_type%';
  END IF;

  v_def := pg_get_constraintdef(v_oid);

  -- ── (2) Parse 2 tầng, CẢ HAI NEO vào `object_type = ANY (…)` ──
  v_raw := substring(v_def FROM 'object_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*''(\{[^}]*\})''');
  IF v_raw IS NOT NULL THEN
    v_cur := v_raw::text[];
    v_matched := true;
  ELSE
    v_raw := substring(v_def FROM 'object_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*(ARRAY\[[^]]*\])');
    IF v_raw IS NOT NULL THEN
      SELECT array_agg(m[1]) INTO v_cur
        FROM regexp_matches(v_raw, '''([^'']+)''', 'g') AS m;
      v_matched := v_cur IS NOT NULL;
    END IF;
  END IF;

  IF NOT v_matched OR v_cur IS NULL OR array_length(v_cur, 1) IS NULL THEN
    RAISE EXCEPTION '[0560] khong parse duoc allow-list cua object_type = ANY(...) cho % : % — DUNG fail-closed', v_con, v_def;
  END IF;

  -- ── (3) Chỉ thêm phần còn THIẾU (idempotent) ──
  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) IS NULL THEN
    RAISE NOTICE '[0560] 4 gia tri recruit da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  -- ── (4) Union + assert SUPERSET trước khi swap (bất biến #2) ──
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  IF NOT (v_union @> v_cur) THEN
    RAISE EXCEPTION '[0560] union danh mat gia tri cu — DUNG (bat bien #2 append-only)';
  END IF;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );

  -- ── (5) VERIFY NO-LOSS fail-LOUD: đọc lại def THẬT (neo `object_type = ANY`) ──
  SELECT substring(pg_get_constraintdef(oid) FROM 'object_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*''(\{[^}]*\})''')::text[]
    INTO v_after
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c' AND conname = v_con;

  SELECT array_agg(t) INTO v_missing
    FROM unnest(v_cur || v_new) AS t
   WHERE v_after IS NULL OR NOT (v_after @> ARRAY[t]);

  IF v_missing IS NOT NULL AND array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION '[0560] verify NO-LOSS that bai — CHECK thieu: %', array_to_string(v_missing, ', ');
  END IF;

  -- ── (5b) VERIFY NO-GAIN: CHECK mới KHÔNG PHÌNH ngoài (cũ ∪ mới) ──
  SELECT array_agg(t) INTO v_extra
    FROM unnest(COALESCE(v_after, ARRAY[]::text[])) AS t
   WHERE NOT ((v_cur || v_new) @> ARRAY[t]);

  IF v_extra IS NOT NULL AND array_length(v_extra, 1) > 0 THEN
    RAISE EXCEPTION '[0560] verify NO-GAIN that bai — CHECK phinh them: %', array_to_string(v_extra, ', ');
  END IF;

  RAISE NOTICE '[0560] da them % vao CHECK object_type cua audit_logs (tong % gia tri)',
    array_to_string(v_add, ', '), array_length(v_after, 1);
END;
$$;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (6) VERIFY fail-LOUD (mirror 0550 bước 6): mọi câu đếm role NEO company_id IS NULL AND deleted_at IS NULL.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_n  int;
  v    text;
  rw   record;
BEGIN
  -- (a) đúng 16 cặp trong catalog, và ĐÚNG 7 cặp candidate là is_sensitive=true, 9 cặp còn lại false
  SELECT count(*) INTO v_n FROM permissions
   WHERE (action, resource_type) IN (
     ('access','recruit'),
     ('view','job-opening'), ('create','job-opening'), ('update','job-opening'),
     ('view','candidate'), ('create','candidate'), ('update','candidate'), ('move-stage','candidate'),
     ('comment','candidate'), ('export','candidate'), ('convert','candidate'),
     ('view','interview'), ('manage','interview'), ('feedback','interview'),
     ('view','offer'), ('manage','offer'));
  IF v_n <> 16 THEN
    RAISE EXCEPTION '[0560] verify: catalog co % cap RECRUIT, ky vong 16 — buoc (3) truot', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM permissions
   WHERE resource_type = 'candidate' AND is_sensitive = true;
  IF v_n <> 7 THEN
    RAISE EXCEPTION '[0560] verify: % cap candidate is_sensitive=true, ky vong 7 (REC-DEC-003)', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM permissions
   WHERE resource_type IN ('recruit', 'job-opening', 'interview', 'offer') AND is_sensitive = true;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0560] verify: % cap RECRUIT ngoai `candidate` bi danh dau sensitive, ky vong 0', v_n;
  END IF;

  -- (b1) tổng 42 grant ALLOW của 5 role hệ thống trên 5 resource RECRUIT (over/under đều đỏ)
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name IN ('employee', 'manager', 'hr', 'company-admin', 'recruiter')
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW'
     AND p.resource_type IN ('recruit', 'job-opening', 'candidate', 'interview', 'offer');
  IF v_n <> 42 THEN
    RAISE EXCEPTION '[0560] verify: % grant RECRUIT cho 5 role he thong, ky vong 42 — over/under-grant (drift?)', v_n;
  END IF;

  -- (b2) employee: 0 grant RECRUIT (ma trận §9f — nhân viên KHÔNG thấy module tuyển dụng)
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name = 'employee' AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW'
     AND p.resource_type IN ('recruit', 'job-opening', 'candidate', 'interview', 'offer');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0560] verify: employee CO % grant RECRUIT — vo ma tran §9f (ky vong 0)', v_n;
  END IF;

  -- (b3) manager: đúng 3 hàng, và KHÔNG cặp candidate/offer/job-opening nào
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name = 'manager' AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW'
     AND p.resource_type IN ('recruit', 'job-opening', 'candidate', 'interview', 'offer');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '[0560] verify: manager co % grant RECRUIT, ky vong 3', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name = 'manager' AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW'
     AND p.resource_type IN ('job-opening', 'candidate', 'offer');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0560] verify: manager CO % cap job-opening/candidate/offer — vo §9f', v_n;
  END IF;

  -- (b4) hr: đúng 7 hàng, và 0 cặp GHI (chỉ access/view/convert/feedback)
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name = 'hr' AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW'
     AND p.resource_type IN ('recruit', 'job-opening', 'candidate', 'interview', 'offer');
  IF v_n <> 7 THEN
    RAISE EXCEPTION '[0560] verify: hr co % grant RECRUIT, ky vong 7', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name = 'hr' AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW'
     AND p.resource_type IN ('recruit', 'job-opening', 'candidate', 'interview', 'offer')
     AND p.action NOT IN ('access', 'view', 'convert', 'feedback');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0560] verify: hr CO % cap GHI RECRUIT (create/update/move-stage/comment/export/manage) — vo §9f', v_n;
  END IF;

  -- (b5) company-admin VÀ recruiter: đúng 16 hàng; access + feedback @Own; 14 cặp còn lại @Company
  FOREACH v IN ARRAY ARRAY['company-admin', 'recruiter'] LOOP
    SELECT count(*) INTO v_n
      FROM role_permissions rp
      JOIN roles r2      ON r2.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r2.name = v AND r2.company_id IS NULL AND r2.deleted_at IS NULL
       AND rp.effect = 'ALLOW'
       AND p.resource_type IN ('recruit', 'job-opening', 'candidate', 'interview', 'offer');
    IF v_n <> 16 THEN
      RAISE EXCEPTION '[0560] verify: % co % grant RECRUIT, ky vong 16', v, v_n;
    END IF;

    SELECT count(*) INTO v_n
      FROM role_permissions rp
      JOIN roles r2      ON r2.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r2.name = v AND r2.company_id IS NULL AND r2.deleted_at IS NULL
       AND rp.effect = 'ALLOW' AND rp.data_scope = 'Company'
       AND p.resource_type IN ('recruit', 'job-opening', 'candidate', 'interview', 'offer')
       AND NOT (p.action = 'access' OR (p.action = 'feedback' AND p.resource_type = 'interview'));
    IF v_n <> 14 THEN
      RAISE EXCEPTION '[0560] verify: % co % cap @Company (ngoai access/feedback), ky vong 14', v, v_n;
    END IF;
  END LOOP;

  -- (b6) SCOPE từng hàng ĐÍCH DANH — census phủ **4 hình dạng wildcard** của engine
  --      (action IN (act,'*') AND resource_type IN (res,'*') — HAI VẾ ĐỘC LẬP). Đếm exact-shape một mình
  --      MÙ trước hàng '*:*' / '*:candidate' / 'view:*': nếu ai đó seed wildcard, số dưới nhảy lên > 1 ⇒ ĐỎ.
  FOR rw IN SELECT * FROM (VALUES
      ('manager',       'access',     'recruit',     'Own'),
      ('manager',       'view',       'interview',   'Own'),
      ('manager',       'feedback',   'interview',   'Own'),
      ('hr',            'access',     'recruit',     'Own'),
      ('hr',            'view',       'job-opening', 'Company'),
      ('hr',            'view',       'candidate',   'Company'),
      ('hr',            'view',       'interview',   'Company'),
      ('hr',            'view',       'offer',       'Company'),
      ('hr',            'convert',    'candidate',   'Company'),
      ('hr',            'feedback',   'interview',   'Own'),
      ('company-admin', 'access',     'recruit',     'Own'),
      ('company-admin', 'feedback',   'interview',   'Own'),
      ('company-admin', 'move-stage', 'candidate',   'Company'),
      ('company-admin', 'export',     'candidate',   'Company'),
      ('company-admin', 'manage',     'offer',       'Company'),
      ('recruiter',     'access',     'recruit',     'Own'),
      ('recruiter',     'feedback',   'interview',   'Own'),
      ('recruiter',     'move-stage', 'candidate',   'Company'),
      ('recruiter',     'export',     'candidate',   'Company'),
      ('recruiter',     'manage',     'offer',       'Company')
    ) AS v(role, act, res, scope)
  LOOP
    SELECT count(*) INTO v_n
      FROM role_permissions rp
      JOIN roles r2      ON r2.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r2.name = rw.role AND r2.company_id IS NULL AND r2.deleted_at IS NULL
       AND rp.effect = 'ALLOW' AND rp.data_scope = rw.scope
       AND p.action IN (rw.act, '*') AND p.resource_type IN (rw.res, '*');
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0560] verify: % %:% @% = % hang (census 4 hinh dang wildcard), ky vong dung 1',
        rw.role, rw.act, rw.res, rw.scope, v_n;
    END IF;
  END LOOP;

  -- (b7) 0 hàng wildcard được cấp cho 5 role hệ thống — nếu có, mọi census exact-shape ở trên thành mù
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name IN ('employee', 'manager', 'hr', 'company-admin', 'recruiter')
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW'
     AND (p.action = '*' OR p.resource_type = '*');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0560] verify: % grant WILDCARD cho role he thong — census RECRUIT khong con dang tin', v_n;
  END IF;

  -- (c) role recruiter đúng 3 thuộc tính (ON CONFLICT DO NOTHING không sửa hàng sẵn có sai)
  SELECT count(*) INTO v_n
    FROM roles
   WHERE name = 'recruiter' AND company_id IS NULL AND deleted_at IS NULL
     AND id = '00000000-0000-0000-0000-000000000014'
     AND is_system = true AND requires_two_factor = false;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0560] verify: role recruiter (id …0014, is_system, requires_two_factor=false) = % hang, ky vong 1', v_n;
  END IF;

  -- (d) CHECK audit chứa cả 4 giá trị — regex biên [,{'] v [',}] từng giá trị (0506:265)
  FOREACH v IN ARRAY ARRAY['job_opening', 'candidate', 'interview', 'offer'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
         AND conname LIKE '%object_type%'
         AND pg_get_constraintdef(oid) ~ ('[,{'']' || v || '['',}]')
    ) THEN
      RAISE EXCEPTION '[0560] verify: CHECK audit_logs.object_type CHUA chua ''%'' — buoc (5) truot', v;
    END IF;
  END LOOP;

  -- (e) module RECRUIT TỒN TẠI (D1). CỐ Ý **KHÔNG** ép is_active = false — guard forward-compatible
  --     (memory noti-check-baseline-guard-must-be-forward-compatible; tiền lệ vá 0550:(e) khi 0556 bật ASSET).
  --     Hợp đồng "RECRUIT inactive cho tới khi có màn" canh ở pin EXTENSION_INACTIVE_MODULES của
  --     migration-smoke.int-spec.ts — nơi S12-RECRUIT-FE-1 gỡ được CÙNG commit với UPDATE bật cờ.
  IF NOT EXISTS (
    SELECT 1 FROM modules WHERE module_code = 'RECRUIT' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION '[0560] verify: modules.RECRUIT phai ton tai (ky vong 1 hang tu mig 0435)';
  END IF;

  -- (f) super-admin KHÔNG được enumerate ở tầng migration
  SELECT count(*) INTO v_n FROM roles WHERE name = 'super-admin' AND company_id IS NULL AND deleted_at IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0560] verify: super-admin xuat hien trong roles he thong (% hang) — phai la runtime company-scoped', v_n;
  END IF;

  -- (g) recruiter KHÔNG được lọt vào enumerate canonical: 4 role canonical vẫn đúng 4 (pin auth-seed-canonical-roles)
  SELECT count(*) INTO v_n FROM roles
   WHERE name IN ('employee', 'manager', 'hr', 'company-admin')
     AND company_id IS NULL AND deleted_at IS NULL;
  IF v_n <> 4 THEN
    RAISE EXCEPTION '[0560] verify: % role canonical he thong, ky vong 4 — chuoi seed lech', v_n;
  END IF;

  RAISE NOTICE '[0560] verify PASS: 16 cap RECRUIT (7 sensitive) + 42 grant §9f + role recruiter + audit CHECK 4 gia tri + module RECRUIT ton tai';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM role_permissions rp USING permissions p
--   WHERE rp.permission_id = p.id
--     AND p.resource_type IN ('recruit', 'job-opening', 'candidate', 'interview', 'offer');
-- DELETE FROM permissions WHERE resource_type IN ('recruit', 'job-opening', 'candidate', 'interview', 'offer');
-- DELETE FROM roles WHERE id = '00000000-0000-0000-0000-000000000014' AND company_id IS NULL;
-- -- CHECK audit_logs.object_type: KHÔNG có down (append-only #2 — gỡ giá trị làm vỡ hàng audit đã ghi).
