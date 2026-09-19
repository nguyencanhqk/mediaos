-- Migration 0578: S16-SOCIAL-DB-1 (🔴 RED, zone=red, crown) — SEED 14 cặp quyền `feed-*` + 43 grant
--   per-(role, pair) theo SPEC-16 §11.1 + permission-matrix §9h + DB-17 §9.2.
--   THUẦN DATA — khuôn 0544/0560/0565. KHÔNG db:generate. KHÔNG đụng audit (tách sang 0579).
--
-- BỐI CẢNH (seed qua migrator owner-bypass — mirror 0506/0527/0544):
--   migrator chạy DATABASE_DIRECT_URL = role owner mediaos (rolbypassrls) ⇒ INSERT permissions (global)
--   + role_permissions (system role company_id NULL) chạy TRỰC TIẾP. RLS chỉ chặn app role runtime.
--
-- MA TRẬN (SPEC-16 §11.1 — tổng 43 = employee 7 · manager 8 · hr 14 · company-admin 14):
--   view:feed · create:feed-post · -comment · -poll · -idea · -kudos · -group  → CẢ 4 role, Company (28)
--   manage:feed-news · -post · -group · -kudos · -report · approve:feed-idea   → hr + company-admin (12)
--   view:feed-report                → manager **Department** · hr Company · company-admin Company (3)
--   `super-admin` KHÔNG enumerate (nhận qua SuperAdminBootstrapService — KHÔNG phải role canonical).
--   `payroll-officer`/`recruiter`/`asset-manager`/`office-admin` nhận 0 hàng ở wave này.
--   is_sensitive = false cho CẢ 14 cặp: SOCIAL không chi phối credential/tiền/PII — bật cờ sẽ bắt FE
--   gate bằng useCanExact và làm ẩn chính màn hình của người được cấp.
--
-- ⚠️ TIỀN TỐ `feed-` LÀ BẮT BUỘC — KHÔNG `social-*` (DB-17 R7):
--   `social-post`/`social-account` là 3 cặp của app vệ tinh fbpost (0544). Lưới THẬT duy nhất chống
--   hồi quy là khối (2) dưới đây — chụp BỘ HÀNG (role, action, resource, scope, effect) TRƯỚC vòng
--   lặp grant, so lại NGAY SAU, hai chiều. Đếm trần KHÔNG đủ: đổi scope giữ nguyên số lượng.
--   ⚠️ "Verify của 0544 sẽ bắt" là ẢO, sai theo HAI chiều (plan §8 hàng 2):
--     (i) 0544:141,166 lọc `resource_type IN ('social-post','social-account')` — danh sách ĐÚNG-BẰNG,
--         đặt tên `social-feed` nó cũng không thấy;
--     (ii) 0544 luôn chạy TRƯỚC 0578 trong mọi lần migrate ⇒ về thứ tự nó KHÔNG THỂ bắt hồi quy của ta.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§9):
--   #2 role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ đổi scope = DELETE
--      đúng bộ (role_id,permission_id,'ALLOW') scope SAI (per-pair, KHÔNG blanket/CROSS JOIN —
--      blanket-grant-migration-role-drift) + INSERT ON CONFLICT DO NOTHING.
--      permissions seed ON CONFLICT(action,resource_type) DO NOTHING.
--   • Idempotent: chạy lại KHÔNG nhân đôi, KHÔNG đổi count (khác 0577 — 0577 chạy lại PHẢI RAISE).
--   • resource_type dùng GẠCH-NỐI ('feed-post') — KHÁC audit object_type dùng gạch-dưới ('feed_post',
--     migration 0579). Hai danh mục khác nhau, đừng đồng nhất.
--
-- BAND 0578 (lane S16-SOCIAL-DB-1). Journal: idx 245, when 1717587367000 (> 0577 idx 244 / 1717587366000).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) Catalog 14 cặp. ON CONFLICT DO NOTHING (hot-file: append, không rewrite) ──
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('view',    'feed',         false),  -- SOCIAL.FEED.VIEW — đọc bảng tin
  ('create',  'feed-post',    false),  -- SOCIAL.POST.CREATE
  ('create',  'feed-comment', false),  -- SOCIAL.COMMENT.CREATE
  ('create',  'feed-poll',    false),  -- SOCIAL.POLL.CREATE
  ('create',  'feed-idea',    false),  -- SOCIAL.IDEA.CREATE
  ('create',  'feed-kudos',   false),  -- SOCIAL.KUDOS.CREATE
  ('create',  'feed-group',   false),  -- SOCIAL.GROUP.CREATE
  ('manage',  'feed-news',    false),  -- SOCIAL.NEWS.MANAGE — đăng/ghim/yêu cầu xác nhận đọc
  ('manage',  'feed-post',    false),  -- SOCIAL.POST.MANAGE — ẩn/xoá bài người khác
  ('manage',  'feed-group',   false),  -- SOCIAL.GROUP.MANAGE
  ('manage',  'feed-kudos',   false),  -- SOCIAL.KUDOS.MANAGE — catalog huy hiệu
  ('manage',  'feed-report',  false),  -- SOCIAL.REPORT.MANAGE — xử lý báo cáo
  ('approve', 'feed-idea',    false),  -- SOCIAL.IDEA.APPROVE
  ('view',    'feed-report',  false)   -- SOCIAL.REPORT.VIEW
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────── (2) Grant per-(role,pair) — resolve role THEO THUỘC TÍNH, không hard-code id ──
DO $$
DECLARE
  feed_grants CONSTANT text[][] := ARRAY[
    -- ── nhóm ĐẠI TRÀ: đọc + tự tạo nội dung của mình (7 cặp × 4 role = 28) ──
    ['employee',      'view',   'feed',         'Company'],
    ['manager',       'view',   'feed',         'Company'],
    ['hr',            'view',   'feed',         'Company'],
    ['company-admin', 'view',   'feed',         'Company'],
    ['employee',      'create', 'feed-post',    'Company'],
    ['manager',       'create', 'feed-post',    'Company'],
    ['hr',            'create', 'feed-post',    'Company'],
    ['company-admin', 'create', 'feed-post',    'Company'],
    ['employee',      'create', 'feed-comment', 'Company'],
    ['manager',       'create', 'feed-comment', 'Company'],
    ['hr',            'create', 'feed-comment', 'Company'],
    ['company-admin', 'create', 'feed-comment', 'Company'],
    ['employee',      'create', 'feed-poll',    'Company'],
    ['manager',       'create', 'feed-poll',    'Company'],
    ['hr',            'create', 'feed-poll',    'Company'],
    ['company-admin', 'create', 'feed-poll',    'Company'],
    ['employee',      'create', 'feed-idea',    'Company'],
    ['manager',       'create', 'feed-idea',    'Company'],
    ['hr',            'create', 'feed-idea',    'Company'],
    ['company-admin', 'create', 'feed-idea',    'Company'],
    ['employee',      'create', 'feed-kudos',   'Company'],
    ['manager',       'create', 'feed-kudos',   'Company'],
    ['hr',            'create', 'feed-kudos',   'Company'],
    ['company-admin', 'create', 'feed-kudos',   'Company'],
    ['employee',      'create', 'feed-group',   'Company'],
    ['manager',       'create', 'feed-group',   'Company'],
    ['hr',            'create', 'feed-group',   'Company'],
    ['company-admin', 'create', 'feed-group',   'Company'],
    -- ── nhóm QUẢN TRỊ NỘI DUNG: hr + company-admin (6 cặp × 2 = 12) ──
    ['hr',            'manage',  'feed-news',   'Company'],
    ['company-admin', 'manage',  'feed-news',   'Company'],
    ['hr',            'manage',  'feed-post',   'Company'],
    ['company-admin', 'manage',  'feed-post',   'Company'],
    ['hr',            'manage',  'feed-group',  'Company'],
    ['company-admin', 'manage',  'feed-group',  'Company'],
    ['hr',            'manage',  'feed-kudos',  'Company'],
    ['company-admin', 'manage',  'feed-kudos',  'Company'],
    ['hr',            'manage',  'feed-report', 'Company'],
    ['company-admin', 'manage',  'feed-report', 'Company'],
    ['hr',            'approve', 'feed-idea',   'Company'],
    ['company-admin', 'approve', 'feed-idea',   'Company'],
    -- ── XEM báo cáo: manager chỉ trong phòng ban mình (3 hàng) ──
    --   Department cho manager là scope THI HÀNH ĐƯỢC ở SOCIAL (khác fbpost — 0544 ghi chú): bài/bình
    --   luận có org_unit của tác giả, service lọc theo đó. KHÔNG cấp `manage` cho manager: xử lý báo
    --   cáo là quyết định kỷ luật nội dung, thuộc hr/company-admin.
    ['manager',       'view',   'feed-report',  'Department'],
    ['hr',            'view',   'feed-report',  'Company'],
    ['company-admin', 'view',   'feed-report',  'Company']
  ];
  g          text[];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_rescoped int := 0;
  v_del      int;
  -- Lưới THẬT chống chạm quyền `social-*` của fbpost: chụp BỘ HÀNG trước, so lại sau, trong CÙNG
  -- khối. CỐ Ý KHÔNG dùng bảng tạm: một `CREATE TEMP TABLE` bắt buộc kéo theo `DROP TABLE`, và
  -- `scripts/check-migration-no-drop.sh` quét VĂN BẢN nên không phân biệt được bảng tạm với bảng
  -- thật ⇒ file này sẽ đòi cờ `DESTRUCTIVE-APPROVED` cho một lệnh KHÔNG phá huỷ gì. Biến cục bộ
  -- đạt đúng mục đích mà không đẻ DDL, và còn chạy đúng cả khi replay từng câu lệnh (autocommit).
  v_social_before text[];
  v_social_after  text[];
BEGIN
  SELECT array_agg(format('%s|%s:%s|%s|%s', ro.name, p.action, p.resource_type, rp.data_scope, rp.effect)
                   ORDER BY ro.name, p.action, p.resource_type)
    INTO v_social_before
    FROM role_permissions rp
    JOIN roles ro      ON ro.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.resource_type IN ('social-post', 'social-account');

  -- ⚠️ NEO CHỐNG XANH-RỖNG: nếu `social-*` rỗng thì `array_agg` trả NULL ở CẢ HAI vế và
  --    `NULL IS DISTINCT FROM NULL = false` ⇒ lưới PASS mà không kiểm gì
  --    (`empty-success-is-the-fail-open-shape`). `0544` seed đúng 3 hàng VÔ ĐIỀU KIỆN và có band
  --    NHỎ HƠN nên luôn chạy trước trong chuỗi migrate đầy đủ — vậy đáy dương là 3. Chạy file này
  --    trên DB rút gọn (thiếu 0544) sẽ ĐỎ ồn ào thay vì im lặng đúng lúc cần lưới nhất.
  IF COALESCE(array_length(v_social_before, 1), 0) <> 3 THEN
    RAISE EXCEPTION '[0578] tien-kiem: `social-*` cua fbpost phai co dung 3 hang TRUOC khi seed feed (dem duoc %) — 0544 chua chay?',
      COALESCE(array_length(v_social_before, 1), 0);
  END IF;

  FOREACH g SLICE 1 IN ARRAY feed_grants LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0578] role canonical % khong ton tai — seed 0005/0444 phai chay truoc', g[1];
    END IF;

    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0578] permission (%:%) khong co trong catalog — buoc (1) phai chay truoc', g[2], g[3];
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

  -- LƯỚI `social-*`: so BỘ HÀNG (role, action, resource, scope, effect) đúng-bằng. Đếm trần KHÔNG đủ —
  -- đổi scope giữ nguyên số lượng. Mảng đã ORDER BY nên so thẳng là so hai chiều.
  SELECT array_agg(format('%s|%s:%s|%s|%s', ro.name, p.action, p.resource_type, rp.data_scope, rp.effect)
                   ORDER BY ro.name, p.action, p.resource_type)
    INTO v_social_after
    FROM role_permissions rp
    JOIN roles ro      ON ro.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.resource_type IN ('social-post', 'social-account');

  IF v_social_after IS DISTINCT FROM v_social_before THEN
    RAISE EXCEPTION '[0578] grant `social-*` cua fbpost BI CHAM — truoc: % | sau: %',
      COALESCE(array_to_string(v_social_before, ' ; '), '<NULL>'),
      COALESCE(array_to_string(v_social_after,  ' ; '), '<NULL>');
  END IF;

  RAISE NOTICE '[0578] feed grants: % INSERT moi, % re-scope (ky vong tong 43 hang); social-* KHONG doi (% hang)',
    v_seeded, v_rescoped, COALESCE(array_length(v_social_before, 1), 0);
END;
$$;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (3) VERIFY fail-LOUD (RAISE EXCEPTION — khuôn 0544/0565). Idempotent: chạy lại PASS, count không đổi.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_res   CONSTANT text[] := ARRAY['feed', 'feed-post', 'feed-comment', 'feed-poll', 'feed-idea',
                                   'feed-kudos', 'feed-group', 'feed-news', 'feed-report'];
  v_n     int;
  v_bad   text;
  r       record;
BEGIN
  -- (a) ĐÚNG 14 cặp trong catalog
  SELECT count(*) INTO v_n
    FROM permissions
   WHERE resource_type = 'feed' OR resource_type LIKE 'feed-%';
  IF v_n <> 14 THEN
    RAISE EXCEPTION '[0578] verify: ky vong 14 cap feed trong catalog, co % — buoc (1) truot', v_n;
  END IF;

  -- (b) 0 cặp is_sensitive — bật cờ sẽ bắt FE gate bằng useCanExact và ẩn màn của chính người được cấp
  SELECT count(*) INTO v_n
    FROM permissions
   WHERE (resource_type = 'feed' OR resource_type LIKE 'feed-%') AND is_sensitive = true;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0578] verify: co % cap feed bat is_sensitive — ky vong 0 (SPEC-16 §11.1)', v_n;
  END IF;

  -- (c) TỔNG 43 grant ALLOW trên MỌI role (không lọc theo 4 role canonical — nếu quyền feed lọt sang
  --     role khác thì phải ĐỎ, không phải bị bộ lọc giấu đi), TRỪ `super-admin`.
  --  ⚠️ `super-admin` PHẢI loại THEO TÊN: `SuperAdminBootstrapService` grant TOÀN BỘ catalog per-pair
  --     (data_scope='System') ở MỖI LẦN BOOT ⇒ sau boot kế tiếp nó tự nhận đủ 14 cặp feed và tổng thành
  --     57. Không loại ⇒ verify này RAISE oan mỗi khi 0578 chạy lại trên DB đã bootstrap (và ca
  --     idempotency của int-spec đỏ theo). Loại bằng TÊN, KHÔNG bằng `company_id IS NULL`: role TUỲ BIẾN
  --     của tenant có company_id NOT NULL nên lọc theo scope sẽ MÙ với đúng nhóm nguy hiểm.
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN roles ro      ON ro.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE ro.deleted_at IS NULL AND ro.name <> 'super-admin' AND rp.effect = 'ALLOW'
     AND (p.resource_type = 'feed' OR p.resource_type LIKE 'feed-%');
  IF v_n <> 43 THEN
    RAISE EXCEPTION '[0578] verify: % grant feed tren toan bo role, ky vong 43 — over/under-grant', v_n;
  END IF;

  -- (d) BREAKDOWN 7/8/14/14 — tổng đúng mà chia sai là hồi quy im lặng
  FOR r IN SELECT * FROM (VALUES
      ('employee', 7), ('manager', 8), ('hr', 14), ('company-admin', 14)
    ) AS v(role_name, n)
  LOOP
    SELECT count(*) INTO v_n
      FROM role_permissions rp
      JOIN roles ro      ON ro.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE ro.name = r.role_name AND ro.company_id IS NULL AND ro.deleted_at IS NULL
       AND rp.effect = 'ALLOW'
       AND (p.resource_type = 'feed' OR p.resource_type LIKE 'feed-%');
    IF v_n <> r.n THEN
      RAISE EXCEPTION '[0578] verify: role % co % grant feed, ky vong % (SPEC-16 §11.1)', r.role_name, v_n, r.n;
    END IF;
  END LOOP;

  -- (e) manager có ĐÚNG 1 hàng Department (`view:feed-report`), 7 hàng còn lại Company;
  --     mọi role khác 0 hàng Department. Scope sai = rò báo cáo toàn công ty cho quản lý phòng.
  --     `super-admin` loại theo TÊN như (c) — grant của nó là data_scope='System', sẽ hiện thành vi phạm.
  SELECT string_agg(format('%s -> %s:%s [%s]', ro.name, p.action, p.resource_type, rp.data_scope), ' ; ')
    INTO v_bad
    FROM role_permissions rp
    JOIN roles ro      ON ro.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE ro.deleted_at IS NULL AND ro.name <> 'super-admin' AND rp.effect = 'ALLOW'
     AND (p.resource_type = 'feed' OR p.resource_type LIKE 'feed-%')
     AND rp.data_scope <> 'Company'
     AND NOT (ro.name = 'manager' AND p.action = 'view' AND p.resource_type = 'feed-report'
              AND rp.data_scope = 'Department');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0578] verify: grant feed co scope ngoai khuon (chi manager view:feed-report = Department): %', v_bad;
  END IF;
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN roles ro      ON ro.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE ro.name = 'manager' AND ro.company_id IS NULL AND ro.deleted_at IS NULL
     AND rp.effect = 'ALLOW' AND rp.data_scope = 'Department'
     AND p.action = 'view' AND p.resource_type = 'feed-report';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0578] verify: manager view:feed-report scope=Department dem duoc % — ky vong 1', v_n;
  END IF;

  -- (f) 4 role hệ thống khác nhận 0 hàng ở wave này (least privilege — cấp thêm bằng migration SAU)
  SELECT string_agg(format('%s -> %s:%s', ro.name, p.action, p.resource_type), ' ; ') INTO v_bad
    FROM role_permissions rp
    JOIN roles ro      ON ro.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE ro.name IN ('payroll-officer', 'recruiter', 'asset-manager', 'office-admin')
     AND ro.deleted_at IS NULL AND rp.effect = 'ALLOW'
     AND (p.resource_type = 'feed' OR p.resource_type LIKE 'feed-%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0578] verify: role he thong ngoai 4 role canonical nhan grant feed: %', v_bad;
  END IF;

  -- (g) CENSUS 4 HÌNH DẠNG WILDCARD (permission-grant-census-must-cover-four-wildcard-shapes).
  --  ⚠️ QUÉT MỌI ROLE, loại `super-admin` theo TÊN — KHÔNG lọc company_id IS NULL: role TUỲ BIẾN của
  --     tenant có company_id NOT NULL nên câu census lọc theo scope sẽ MÙ với đúng nhóm nguy hiểm.
  --   hình dạng 1 `*:*` · 2 `<verb>:*` · 3 `*:<resource feed>` — cả ba đều phải 0 dòng;
  --   hình dạng 4 (cặp tường minh) là đường HỢP LỆ duy nhất, đã đếm đúng-bằng ở (c)/(d).
  SELECT string_agg(format('%s -> %s:%s', ro.name, p.action, p.resource_type), ' ; ') INTO v_bad
    FROM role_permissions rp
    JOIN roles ro      ON ro.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE ro.deleted_at IS NULL AND ro.name <> 'super-admin'
     AND (
       (p.action = '*' AND p.resource_type = '*')                             -- 1: toàn quyền
       OR (p.action = '*' AND p.resource_type = ANY (v_res))                  -- 3: mọi verb trên tài nguyên feed
       OR (p.resource_type = '*' AND p.action IN ('view', 'create', 'manage', 'approve'))  -- 2: verb trên mọi tài nguyên
     );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0578] verify: grant WILDCARD = duong ngam vao quyen SOCIAL: %', v_bad;
  END IF;

  -- (i) object_permissions = 0 hàng trỏ cặp feed — hình dạng bypass MẠNH NHẤT (object grant vốn là
  --     exact ⇒ nó CHÍNH LÀ grant tường minh mà mọi cổng quyền đòi).
  SELECT string_agg(format('%s/%s -> %s:%s', op.subject_type, op.subject_id, p.action, p.resource_type), ' ; ')
    INTO v_bad
    FROM object_permissions op JOIN permissions p ON p.id = op.permission_id
   WHERE p.resource_type = 'feed' OR p.resource_type LIKE 'feed-%';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0578] verify: co object_permissions tro cap feed (bypass cong quyen): %', v_bad;
  END IF;

  RAISE NOTICE '[0578] verify PASS: 14 cap (0 sensitive) · 43 grant (7/8/14/14) · manager view:feed-report = Department · 0 wildcard · 0 object_permissions';
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM role_permissions rp USING permissions p
--   WHERE rp.permission_id = p.id AND (p.resource_type = 'feed' OR p.resource_type LIKE 'feed-%');
-- DELETE FROM permissions WHERE resource_type = 'feed' OR resource_type LIKE 'feed-%';
