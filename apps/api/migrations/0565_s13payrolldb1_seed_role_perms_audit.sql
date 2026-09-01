-- Migration 0565: S13-PAYROLL-DB-1 (🔴 RED, zone=red, crown) — SEED nghiệp vụ PAYROLL (DB-13 §10 bước B,
--   mirror 0560): verify module + role hệ thống `payroll-officer` + **THU HỒI 16 cặp quyền lương di sản trên
--   BA bảng** + seed 17 cặp §9g (13 sensitive) + 32 grant per-(role,pair) + UNION-ADD audit object_type.
--   THUẦN DATA/DDL-CHECK VIẾT TAY — **KHÔNG chạy `db:generate`**.
--
-- BỐI CẢNH (seed qua migrator owner-bypass — mirror 0506:6-11 / 0560): migrator chạy DATABASE_DIRECT_URL =
--   role owner (rolbypassrls) ⇒ INSERT roles/permissions (global) + role_permissions chạy TRỰC TIẾP.
--
-- BƯỚC 0 — ĐO THẬT 2026-09-01 (plan §0.7/§0.8), KHÔNG suy từ migration cũ
--   (grant-in-old-migration-is-not-current-state):
--   • **19 cặp** họ lương tồn tại, đúng số SPEC-11 §11.2. Hai cặp domain HR `('view-salary','employee')` /
--     `('update-salary','employee')` (mig 0019 — masking hồ sơ nhân sự SPEC-03) **KHÔNG ĐỤNG TỚI**.
--   • `object_permissions` = **0 hàng** cho cả 19 cặp ⇒ cascade `0005:154` là NO-OP thực tế; vẫn DELETE tường
--     minh + verify, kẻo lần chạy sau trên DB khác có hàng và cascade âm thầm.
--   • ❗ Người giữ grant RỘNG HƠN tài liệu: ngoài `company-admin`(13) / `hr-manager`(12) / `employee`(2) còn
--     **BA role TUỲ BIẾN của tenant**: `QUẢN LÝ CẤP CAO`(19) · `SA`(19) · `SEO`(2). Luật "xoá MỌI hàng
--     role_permissions trỏ 16 cặp GỠ" đã phủ, nhưng verify "đúng 32 hàng" chỉ đạt nếu **cũng** xoá grant của
--     chúng trên **3 cặp GIỮ** ⇒ khối (3c) xoá SẠCH grant của cả 19 cặp trước khi seed lại.
--     ⇒ Sau migration này 3 role tuỳ biến giữ **0 cặp PAYROLL** — CÓ CHỦ ĐÍCH (PAY-DEC-006: quyền lương là
--     khối độc lập; PAYROLL có 0 route nên không ai đang dùng; cấp lại được lúc chạy qua `permission-admin`).
--   • ❗ `('view-own-payslip','payslip')` của `employee` đang là **@Company**, không phải @Own như §9g ghi ⇒
--     vòng grant DELETE-wrong-scope tự sửa; số re-scope in ra RAISE NOTICE.
--   • `modules.PAYROLL` tồn tại từ `0435` (Extension, is_active=false, sort 8) ⇒ chỉ VERIFY, KHÔNG bật.
--   • CHECK `audit_logs.object_type` **ĐÃ đủ cả 4** giá trị payroll (`0090`/`0093`/`0099`) ⇒ khối (6) là
--     **NO-OP CÓ CHỦ ĐÍCH**, tự idempotent-skip + RAISE NOTICE. GIỮ NGUYÊN khối — xoá nó là mất cổng cho DB
--     chưa có đủ 4 giá trị. KHÔNG viết ALTER rỗng.
--
-- QUYẾT ĐỊNH CHỐT (plan §1 P8/P9/P12 · SPEC-11 §11 · permission-matrix §9g):
--   D1 modules.PAYROLL guard FORWARD-COMPATIBLE: chỉ RAISE khi hàng KHÔNG tồn tại, **KHÔNG assert is_active**
--      — S13-PAYROLL-FE-1 sẽ bật cờ; ca replay file này phải sống sót sau đó
--      (module-enable-guard-blocks-next-wo, bài học 0550/0554/0560). Pin migration-smoke
--      EXTENSION_INACTIVE_MODULES ĐÃ có 'PAYROLL' — không sửa ở đây.
--   D2 role `payroll-officer` (PAY-DEC-009): company_id NULL, is_system=true, **requires_two_factor=TRUE
--      TƯỜNG MINH** (khác tiền lệ asset-manager/office-admin/recruiter = false — lương là crown, owner chấp
--      nhận khi duyệt nguyên gói 31/08/2026), id cố định …0015 (…0014 = recruiter). **KHÔNG canonical** —
--      không vào DashCanonicalRole / NOTI_CANONICAL_ROLES / pin auth-seed-canonical-roles.
--   D3 17 cặp SPEC-11 §11.1: **13 sensitive**, 4 false (`access:payroll` cổng nav · `view:payroll-period`
--      không chở tiền · `manage:payroll-period` cấu hình kỳ · `acknowledge-own-payslip` không chở tiền).
--      Chốt cùng seed, KHÔNG flip sau (canonical-seed-pin-regression). 13 cặp sensitive ⇒ WO BE-1 PHẢI khai
--      allowlist capability BACKEND trước khi FE render (capability-allowlist-hides-admin-screens).
--   D4 THU HỒI **TRƯỚC**, seed **SAU** — một số cặp cũ/mới trùng resource_type. Ba bảng, đúng thứ tự
--      object_permissions → role_permissions → permissions.
--   D5 Ba cặp họ `payslip` GIỮ NGUYÊN TÊN di sản (kiểu action-carries-resource): `view-own-payslip` đang có
--      grant sống cho employee từ 0180 mà PAY-DEC-006 yêu cầu giữ. Đổi tên phá grant đó.
--   D6 `('approve','payroll-period')` **KHÔNG gán payroll-officer** — four-eyes là ràng buộc QUYỀN, không chỉ
--      kiểm tra runtime (PAY-DEC-007). Service kiểm thêm submitted_by ≠ approved_by (PAYROLL-ERR-005); DB có
--      CHECK payroll_periods_four_eyes_check làm chốt cuối — ba tầng.
--   D7 HAI NAMESPACE CỐ Ý KHÁC NHAU: audit object_type dùng snake (`payroll_period`, `salary_profile`,
--      `bonus_penalty`) theo họ giá trị có sẵn trong CHECK; resource cặp quyền dùng dash (`payroll-period`,
--      `salary-profile`, `bonus-penalty`) theo quy ước engine. Census/grep phải quét CẢ HAI.
--
-- BẤT BIẾN / HOT-FILE: role_permissions UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ đổi scope
--   = DELETE đúng bộ scope SAI (per-pair, KHÔNG blanket) + INSERT ON CONFLICT DO NOTHING. Mọi câu đếm role NEO
--   `company_id IS NULL AND deleted_at IS NULL` (0506:215). super-admin KHÔNG enumerate (SuperAdminBootstrap
--   giải wildcard *:* runtime, nhưng cổng sensitive đòi cặp exact).
--
-- BAND 0565 (lane S13-PAYROLL-DB-1). Journal: idx 232, when 1717587354000 (> 0564 idx 231 / 1717587353000).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) modules.PAYROLL: verify TỒN TẠI, forward-compatible (mirror 0560 bước 1) ───────────────
DO $$
DECLARE v_n int;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  SELECT count(*) INTO v_n FROM modules WHERE module_code = 'PAYROLL' AND deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0565] modules.PAYROLL khong ton tai (ky vong 1 hang tu mig 0435, dem duoc %)', v_n;
  END IF;
  RAISE NOTICE '[0565] modules.PAYROLL ton tai (0565 KHONG bat co; S13-PAYROLL-FE-1 moi bat)';
END;
$$;
--> statement-breakpoint

-- ─────────────── (2) Role hệ thống payroll-officer (tiền lệ 0560 recruiter …0014) ───────────────
-- Id cố định …0015 phải CHƯA thuộc role nào khác — ON CONFLICT DO NOTHING sẽ nuốt va chạm id trong im lặng
-- và bước (4) grant nhầm role (khuôn 0560 MED-3).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM roles WHERE id = '00000000-0000-0000-0000-000000000015' AND name <> 'payroll-officer'
  ) THEN
    RAISE EXCEPTION '[0565] id …0015 DA thuoc role khac (khong phai payroll-officer) — chon id co dinh moi';
  END IF;
END;
$$;
--> statement-breakpoint
INSERT INTO roles (id, company_id, name, description, is_system, requires_two_factor) VALUES
  ('00000000-0000-0000-0000-000000000015', NULL, 'payroll-officer',
   'Payroll Officer: chuyên viên tiền lương — hồ sơ lương, thưởng/phạt, tính & phát hành bảng lương. '
   'KHÔNG có quyền duyệt bảng lương (four-eyes, PAY-DEC-007). Bắt buộc 2FA (SPEC-01 §10.6 · SPEC-11).',
   true, true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ═══════════════ (3) THU HỒI quyền lương DI SẢN — BA bảng, TRƯỚC khi seed (§9g.1 · PAY-DEC-006) ═══════════════
-- (3a) ĐO + ghi vết hiện trạng trước khi xoá (kể cả hàng object_permissions sẽ cascade theo permissions).
-- (3b) 16 cặp GỠ: object_permissions → role_permissions → permissions.
-- (3c) 3 cặp GIỮ: xoá SẠCH grant hiện có ở CẢ HAI bảng (gồm role tuỳ biến — §0.7) để (4) seed lại đúng 32.
--      ⚠️ Với `view-payslip` (giữ ngữ nghĩa object-permission override), thu hồi chỉ ở role_permissions là để
--      lại ĐƯỜNG ĐỌC PHIẾU LƯƠNG SỐNG trong khi verify «hr-manager = 0 cặp» vẫn XANH.
DO $$
DECLARE
  legacy_removed CONSTANT text[][] := ARRAY[
    ['create',                  'payslip'],
    ['read',                    'payslip'],
    ['update',                  'payslip'],        -- mâu thuẫn thẳng bất biến #2 (phiếu append-only)
    ['delete',                  'payslip'],
    ['view-salary',             'payslip'],
    ['read-payslip',            'payslip'],
    ['resolve-payslip-dispute', 'payslip'],        -- khiếu nại ngoài v1 → PARK-PAYROLL-001
    ['view-salary-profile',     'salary_profile'],
    ['manage-salary-profile',   'salary_profile'],
    ['manage-payroll-period',   'payroll_period'],
    ['run-payroll',             'payroll_period'],
    ['approve-payroll-period',  'payroll_period'], -- ⚠️ is_sensitive=false ⇒ ăn theo wildcard *:* — lỗ đã vá
    ['publish-payroll-period',  'payroll_period'], -- ⚠️ nt
    ['manage-bonus-penalty',    'bonus_penalty'],
    ['approve-bonus-penalty',   'bonus_penalty'],
    ['view-bonus-penalty',      'bonus_penalty']
  ];
  kept CONSTANT text[][] := ARRAY[
    ['view-payslip',            'payslip'],
    ['view-own-payslip',        'payslip'],
    ['acknowledge-own-payslip', 'payslip']
  ];
  g        text[];
  v_ids    uuid[];
  v_del    int;
  v_op     int := 0;
  v_rp     int := 0;
  v_perm   int := 0;
  v_keptrp int := 0;
  v_keptop int := 0;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── (3a) Gom id của 16 cặp GỠ đang thật sự tồn tại trên DB NÀY (không suy từ file migration cũ) ──
  v_ids := ARRAY[]::uuid[];
  FOREACH g SLICE 1 IN ARRAY legacy_removed LOOP
    v_ids := v_ids || ARRAY(SELECT id FROM permissions WHERE action = g[1] AND resource_type = g[2]);
  END LOOP;

  RAISE NOTICE '[0565] thu hoi: tim thay %/16 cap di san can GO', COALESCE(array_length(v_ids, 1), 0);

  -- ── (3b) 16 cặp GỠ — xoá tường minh THEO THỨ TỰ, không dựa cascade ──
  -- object_permissions.permission_id là ON DELETE CASCADE (0005:154): xoá permissions sẽ cascade ÂM THẦM.
  -- Xoá tường minh trước để ĐẾM được, kẻo mất vết một lớp quyền mà không ai biết.
  DELETE FROM object_permissions WHERE permission_id = ANY (v_ids);
  GET DIAGNOSTICS v_op = ROW_COUNT;

  DELETE FROM role_permissions WHERE permission_id = ANY (v_ids);
  GET DIAGNOSTICS v_rp = ROW_COUNT;

  DELETE FROM permissions WHERE id = ANY (v_ids);
  GET DIAGNOSTICS v_perm = ROW_COUNT;

  -- ── (3c) 3 cặp GIỮ — xoá SẠCH grant ở CẢ HAI bảng, giữ nguyên hàng `permissions` ──
  FOREACH g SLICE 1 IN ARRAY kept LOOP
    DELETE FROM object_permissions
     WHERE permission_id IN (SELECT id FROM permissions WHERE action = g[1] AND resource_type = g[2]);
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_keptop := v_keptop + v_del;

    DELETE FROM role_permissions
     WHERE permission_id IN (SELECT id FROM permissions WHERE action = g[1] AND resource_type = g[2]);
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_keptrp := v_keptrp + v_del;
  END LOOP;

  RAISE NOTICE '[0565] thu hoi XONG: 16 cap GO -> % object_permissions, % role_permissions, % permissions; '
               '3 cap GIU -> % object_permissions, % role_permissions (seed lai o buoc 4)',
               v_op, v_rp, v_perm, v_keptop, v_keptrp;
END;
$$;
--> statement-breakpoint

-- ─────────────── (4a) Catalog 17 cặp quyền PAYROLL (SPEC-11 §11.1 / permission-matrix §9g) ───────────────
--   Mã dotted PAYROLL.* chỉ ghi ở COMMENT — bảng permissions CHỈ có (action, resource_type, is_sensitive).
--   13 cặp is_sensitive TRUE. Cặp ĐỌC tiền (`view-line`) TÁCH khỏi cặp GHI (`calculate`): gộp thì (a) không
--   cấp được quyền đọc mà không cấp quyền ghi, (b) người chỉ có `approve` sẽ DUYỆT MÙ, (c) ai thấy widget
--   DASH đều ghi được lương.
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('access',                  'payroll',        false), -- PAYROLL.ACCESS            cổng nav menu Tiền lương
  ('view',                    'payroll-period', false), -- PAYROLL.PERIOD.VIEW       danh sách/chi tiết kỳ — KHÔNG số tiền
  ('manage',                  'payroll-period', false), -- PAYROLL.PERIOD.MANAGE     tạo kỳ · cấu hình · gắn kỳ công · khoá kỳ
  ('view-line',               'payroll-period', true),  -- PAYROLL.PERIOD.VIEW-LINE  ĐỌC dòng bảng lương (CÓ TIỀN) + summary + vế đọc export
  ('calculate',               'payroll-period', true),  -- PAYROLL.PERIOD.CALCULATE  gom · tính · điều chỉnh dòng · gửi duyệt (GHI)
  ('approve',                 'payroll-period', true),  -- PAYROLL.PERIOD.APPROVE    duyệt/từ chối — KHÔNG gán payroll-officer (four-eyes)
  ('publish',                 'payroll-period', true),  -- PAYROLL.PERIOD.PUBLISH    sinh phiếu + phát hành
  ('reopen',                  'payroll-period', true),  -- PAYROLL.PERIOD.REOPEN     mở lại kỳ (lý do bắt buộc + audit)
  ('view',                    'salary-profile', true),  -- PAYROLL.SALARY.VIEW       hồ sơ lương + lịch sử + danh bạ chọn người
  ('manage',                  'salary-profile', true),  -- PAYROLL.SALARY.MANAGE     tạo phiên bản · sửa · xoá mềm
  ('view',                    'bonus-penalty',  true),  -- PAYROLL.BONUS.VIEW        xem thưởng/phạt/khấu trừ
  ('manage',                  'bonus-penalty',  true),  -- PAYROLL.BONUS.MANAGE      tạo · sửa khi Pending · xoá mềm
  ('approve',                 'bonus-penalty',  true),  -- PAYROLL.BONUS.APPROVE     duyệt/từ chối (tự duyệt chặn ở service)
  ('export',                  'payroll',        true),  -- PAYROLL.EXPORT            export XLSX (audit bắt buộc)
  ('view-payslip',            'payslip',        true),  -- PAYROLL.PAYSLIP.VIEW      phiếu lương NGƯỜI KHÁC   (di sản 0097 — GIỮ)
  ('view-own-payslip',        'payslip',        true),  -- PAYROLL.PAYSLIP.VIEW-OWN  phiếu lương CỦA MÌNH     (di sản 0180 — GIỮ)
  ('acknowledge-own-payslip', 'payslip',        false)  -- PAYROLL.PAYSLIP.ACK-OWN   xác nhận phiếu của mình  (di sản 0132 — GIỮ)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────── (4b) Ép is_sensitive cho 3 cặp GIỮ — ON CONFLICT DO NOTHING KHÔNG ghi lại cờ ───────────────
-- Ba cặp di sản đã tồn tại ⇒ (4a) là NO-OP với chúng và cờ is_sensitive giữ nguyên giá trị CŨ. Đo 2026-09-01:
-- cả ba ĐANG ĐÚNG (view-payslip=t · view-own-payslip=t · acknowledge-own-payslip=f), nhưng dựa vào phép đo một
-- lần là để ngỏ đúng lớp lỗ §9g.1 #1 (cặp lương để is_sensitive=false ⇒ ăn theo wildcard *:*). Ép tường minh.
UPDATE permissions SET is_sensitive = true
 WHERE (action, resource_type) IN (('view-payslip', 'payslip'), ('view-own-payslip', 'payslip'))
   AND is_sensitive IS DISTINCT FROM true;
--> statement-breakpoint
UPDATE permissions SET is_sensitive = false
 WHERE (action, resource_type) = ('acknowledge-own-payslip', 'payslip')
   AND is_sensitive IS DISTINCT FROM false;
--> statement-breakpoint

-- ─────────────── (5) Grant per-(role, pair) ma trận §9g = 32 hàng (mirror 0560 bước 4) ───────────────
DO $$
DECLARE
  payroll_grants CONSTANT text[][] := ARRAY[
    -- manager · hr · hr-manager: 0 hàng (DECISIONS-01 Phương án B — quyền lương KHÔNG mặc định cho HR)
    -- employee: 3 (chỉ đường Own)
    ['employee',        'access',                  'payroll',        'Own'],
    ['employee',        'view-own-payslip',        'payslip',        'Own'],
    ['employee',        'acknowledge-own-payslip', 'payslip',        'Own'],
    -- payroll-officer: 14 = access@Own + 13 cặp @Company. KHÔNG có ('approve','payroll-period') — four-eyes.
    ['payroll-officer', 'access',                  'payroll',        'Own'],
    ['payroll-officer', 'view',                    'payroll-period', 'Company'],
    ['payroll-officer', 'manage',                  'payroll-period', 'Company'],
    ['payroll-officer', 'view-line',               'payroll-period', 'Company'],
    ['payroll-officer', 'calculate',               'payroll-period', 'Company'],
    ['payroll-officer', 'publish',                 'payroll-period', 'Company'],
    ['payroll-officer', 'reopen',                  'payroll-period', 'Company'],
    ['payroll-officer', 'view',                    'salary-profile', 'Company'],
    ['payroll-officer', 'manage',                  'salary-profile', 'Company'],
    ['payroll-officer', 'view',                    'bonus-penalty',  'Company'],
    ['payroll-officer', 'manage',                  'bonus-penalty',  'Company'],
    ['payroll-officer', 'approve',                 'bonus-penalty',  'Company'],
    ['payroll-officer', 'export',                  'payroll',        'Company'],
    ['payroll-officer', 'view-payslip',            'payslip',        'Company'],
    -- company-admin: 15 = access@Own + 14 cặp @Company (= 13 của officer + approve:payroll-period)
    ['company-admin',   'access',                  'payroll',        'Own'],
    ['company-admin',   'view',                    'payroll-period', 'Company'],
    ['company-admin',   'manage',                  'payroll-period', 'Company'],
    ['company-admin',   'view-line',               'payroll-period', 'Company'],
    ['company-admin',   'calculate',               'payroll-period', 'Company'],
    ['company-admin',   'approve',                 'payroll-period', 'Company'],
    ['company-admin',   'publish',                 'payroll-period', 'Company'],
    ['company-admin',   'reopen',                  'payroll-period', 'Company'],
    ['company-admin',   'view',                    'salary-profile', 'Company'],
    ['company-admin',   'manage',                  'salary-profile', 'Company'],
    ['company-admin',   'view',                    'bonus-penalty',  'Company'],
    ['company-admin',   'manage',                  'bonus-penalty',  'Company'],
    ['company-admin',   'approve',                 'bonus-penalty',  'Company'],
    ['company-admin',   'export',                  'payroll',        'Company'],
    ['company-admin',   'view-payslip',            'payslip',        'Company']
  ];
  g          text[];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_rescoped int := 0;
  v_del      int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY payroll_grants LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0565] role he thong % khong ton tai — seed 0005/0444/(2) phai chay truoc', g[1];
    END IF;

    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0565] permission (%:%) khong co trong catalog — buoc (4a) phai chay truoc', g[2], g[3];
    END IF;

    -- UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ đổi scope = DELETE bộ scope SAI + INSERT.
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

  RAISE NOTICE '[0565] PAYROLL grants: % INSERT moi, % re-scope (3 role x ma tran §9g = 32 hang)',
               v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ═══════════════ (6) VERIFY FAIL-LOUD — seed quyền (SPEC-11 §11.1 · §9g) ═══════════════
DO $$
DECLARE
  payroll_pairs CONSTANT text[][] := ARRAY[
    ['access', 'payroll'], ['export', 'payroll'],
    ['view', 'payroll-period'], ['manage', 'payroll-period'], ['view-line', 'payroll-period'],
    ['calculate', 'payroll-period'], ['approve', 'payroll-period'], ['publish', 'payroll-period'],
    ['reopen', 'payroll-period'],
    ['view', 'salary-profile'], ['manage', 'salary-profile'],
    ['view', 'bonus-penalty'], ['manage', 'bonus-penalty'], ['approve', 'bonus-penalty'],
    ['view-payslip', 'payslip'], ['view-own-payslip', 'payslip'], ['acknowledge-own-payslip', 'payslip']
  ];
  sensitive_pairs CONSTANT text[][] := ARRAY[
    ['view-line', 'payroll-period'], ['calculate', 'payroll-period'], ['approve', 'payroll-period'],
    ['publish', 'payroll-period'], ['reopen', 'payroll-period'],
    ['view', 'salary-profile'], ['manage', 'salary-profile'],
    ['view', 'bonus-penalty'], ['manage', 'bonus-penalty'], ['approve', 'bonus-penalty'],
    ['export', 'payroll'], ['view-payslip', 'payslip'], ['view-own-payslip', 'payslip']
  ];
  legacy_removed CONSTANT text[][] := ARRAY[
    ['create', 'payslip'], ['read', 'payslip'], ['update', 'payslip'], ['delete', 'payslip'],
    ['view-salary', 'payslip'], ['read-payslip', 'payslip'], ['resolve-payslip-dispute', 'payslip'],
    ['view-salary-profile', 'salary_profile'], ['manage-salary-profile', 'salary_profile'],
    ['manage-payroll-period', 'payroll_period'], ['run-payroll', 'payroll_period'],
    ['approve-payroll-period', 'payroll_period'], ['publish-payroll-period', 'payroll_period'],
    ['manage-bonus-penalty', 'bonus_penalty'], ['approve-bonus-penalty', 'bonus_penalty'],
    ['view-bonus-penalty', 'bonus_penalty']
  ];
  g       text[];
  v_ids   uuid[] := ARRAY[]::uuid[];
  v_n     int;
  v_bad   text;
BEGIN
  -- (6.1) 17 cặp tồn tại đúng bằng
  FOREACH g SLICE 1 IN ARRAY payroll_pairs LOOP
    IF NOT EXISTS (SELECT 1 FROM permissions WHERE action = g[1] AND resource_type = g[2]) THEN
      RAISE EXCEPTION '[0565] verify: thieu cap quyen (%:%) trong catalog', g[1], g[2];
    END IF;
    v_ids := v_ids || ARRAY(SELECT id FROM permissions WHERE action = g[1] AND resource_type = g[2]);
  END LOOP;
  IF array_length(v_ids, 1) <> 17 THEN
    RAISE EXCEPTION '[0565] verify: catalog PAYROLL co % cap, ky vong dung 17', array_length(v_ids, 1);
  END IF;

  -- (6.2) is_sensitive: tập true ĐÚNG BẰNG 13 cặp §11.1 (không thừa, không thiếu). Cặp lương để false là
  --       đường ăn theo wildcard *:* — đúng lỗ §9g.1 #1.
  SELECT string_agg(format('%s:%s', p.action, p.resource_type), ', ') INTO v_bad
    FROM permissions p
   WHERE p.id = ANY (v_ids) AND p.is_sensitive
     AND (p.action, p.resource_type) NOT IN (
       ('view-line','payroll-period'), ('calculate','payroll-period'), ('approve','payroll-period'),
       ('publish','payroll-period'), ('reopen','payroll-period'),
       ('view','salary-profile'), ('manage','salary-profile'),
       ('view','bonus-penalty'), ('manage','bonus-penalty'), ('approve','bonus-penalty'),
       ('export','payroll'), ('view-payslip','payslip'), ('view-own-payslip','payslip'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0565] verify: cap PAYROLL sensitive NGOAI danh sach 13: %', v_bad;
  END IF;

  FOREACH g SLICE 1 IN ARRAY sensitive_pairs LOOP
    IF NOT EXISTS (SELECT 1 FROM permissions
                    WHERE action = g[1] AND resource_type = g[2] AND is_sensitive) THEN
      RAISE EXCEPTION '[0565] verify: cap (%:%) PHAI is_sensitive=true — de false la an theo wildcard *:*',
                      g[1], g[2];
    END IF;
  END LOOP;

  SELECT count(*) INTO v_n FROM permissions WHERE id = ANY (v_ids) AND is_sensitive;
  IF v_n <> 13 THEN
    RAISE EXCEPTION '[0565] verify: co % cap PAYROLL sensitive, ky vong dung 13', v_n;
  END IF;

  -- (6.3) 16 cặp GỠ = 0 hàng ở CẢ BA bảng
  FOREACH g SLICE 1 IN ARRAY legacy_removed LOOP
    IF EXISTS (SELECT 1 FROM permissions WHERE action = g[1] AND resource_type = g[2]) THEN
      RAISE EXCEPTION '[0565] verify: cap di san (%:%) VAN CON trong permissions', g[1], g[2];
    END IF;
  END LOOP;
  -- role_permissions/object_permissions có FK tới permissions ⇒ hàng permissions biến mất thì hàng trỏ nó
  -- không thể còn; assert lại qua đường mồ côi cho chắc (fail-closed).
  SELECT count(*) INTO v_n FROM role_permissions rp
   WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.id = rp.permission_id);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0565] verify: co % hang role_permissions mo coi', v_n;
  END IF;

  -- (6.4) TỔNG grant PAYROLL = đúng 32 hàng (gồm cả role tuỳ biến của tenant — §0.7)
  SELECT count(*) INTO v_n FROM role_permissions WHERE permission_id = ANY (v_ids);
  IF v_n <> 32 THEN
    SELECT string_agg(format('%s -> %s:%s@%s', r.name, p.action, p.resource_type, rp.data_scope), ' ; ')
      INTO v_bad
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.permission_id = ANY (v_ids);
    RAISE EXCEPTION '[0565] verify: co % hang grant PAYROLL, ky vong dung 32. Hien trang: %', v_n, v_bad;
  END IF;

  -- (6.5) hr-manager (…0009) = 0 cặp PAYROLL trên CẢ BA bảng (PAY-DEC-006 / Phương án B).
  --       Cặp ('view-salary','employee') domain HR (0019) KHÔNG nằm trong v_ids ⇒ không bị đụng.
  SELECT count(*) INTO v_n FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
   WHERE r.name = 'hr-manager' AND r.company_id IS NULL AND rp.permission_id = ANY (v_ids);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0565] verify: hr-manager con % cap PAYROLL o role_permissions — PAY-DEC-006 doi 0', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM object_permissions op
   WHERE op.permission_id = ANY (v_ids)
     AND op.subject_type = 'Role'
     AND op.subject_id = (SELECT id FROM roles WHERE name = 'hr-manager' AND company_id IS NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0565] verify: hr-manager con % cap PAYROLL o object_permissions — duong doc phieu luong SONG', v_n;
  END IF;

  -- (6.5b) hr + manager = 0 cặp PAYROLL (DECISIONS-01 Phương án B)
  FOREACH g SLICE 1 IN ARRAY ARRAY[['hr'], ['manager']] LOOP
    SELECT count(*) INTO v_n FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
     WHERE r.name = g[1] AND r.company_id IS NULL AND rp.permission_id = ANY (v_ids);
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0565] verify: role % con % cap PAYROLL — quyen luong KHONG mac dinh cho HR', g[1], v_n;
    END IF;
  END LOOP;

  -- (6.6) BA điều kiện quan hệ cặp (SPEC-11 §11.1 ∪ permission-matrix §9g) — verify fail-loud tại thời điểm
  --       migration. `permission-admin` có thể gỡ view-line lúc runtime; rủi ro «duyệt mù» còn lại được chấp
  --       nhận tường minh, QA có ca đối chứng.
  --   (a) manage:bonus-penalty ⇒ view:salary-profile   (danh bạ nhân sự PAYROLL-API-034)
  --   (b) approve:payroll-period ⇒ view-line           (kẻo người duyệt DUYỆT MÙ)
  --   (c) calculate:payroll-period ⇒ view-line         (kẻo route GHI phải chở tiền — SPEC-11 §11.1)
  FOR v_bad IN
    SELECT r.name FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
     WHERE rp.permission_id = (SELECT id FROM permissions WHERE action='manage' AND resource_type='bonus-penalty')
       AND NOT EXISTS (
         SELECT 1 FROM role_permissions rp2
          WHERE rp2.role_id = rp.role_id
            AND rp2.permission_id = (SELECT id FROM permissions WHERE action='view' AND resource_type='salary-profile'))
  LOOP
    RAISE EXCEPTION '[0565] verify: role % giu manage:bonus-penalty ma THIEU view:salary-profile (picker 034)', v_bad;
  END LOOP;

  FOR v_bad IN
    SELECT r.name FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
     WHERE rp.permission_id IN (
             SELECT id FROM permissions
              WHERE resource_type='payroll-period' AND action IN ('approve','calculate'))
       AND NOT EXISTS (
         SELECT 1 FROM role_permissions rp2
          WHERE rp2.role_id = rp.role_id
            AND rp2.permission_id = (SELECT id FROM permissions WHERE action='view-line' AND resource_type='payroll-period'))
  LOOP
    RAISE EXCEPTION '[0565] verify: role % giu approve/calculate:payroll-period ma THIEU view-line — duyet mu', v_bad;
  END LOOP;

  -- (6.7) Census 4 hình dạng wildcard: KHÔNG role hệ thống nào giữ ('*','*')/('act','*')/('*','res').
  --       matches() là HAI vế độc lập ⇒ câu đo exact-only MÙ với wildcard
  --       (permission-grant-census-must-cover-four-wildcard-shapes).
  SELECT string_agg(format('%s -> %s:%s', r.name, p.action, p.resource_type), ' ; ') INTO v_bad
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.company_id IS NULL AND r.deleted_at IS NULL
     AND (p.action = '*' OR p.resource_type = '*');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0565] verify: grant wildcard cho role he thong = duong ngam vao cap sensitive PAYROLL: %', v_bad;
  END IF;

  -- (6.8) role payroll-officer đúng thuộc tính
  SELECT count(*) INTO v_n FROM roles
   WHERE id = '00000000-0000-0000-0000-000000000015' AND name = 'payroll-officer'
     AND company_id IS NULL AND is_system AND requires_two_factor AND deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0565] verify: role payroll-officer …0015 sai thuoc tinh (company_id NULL / is_system / 2FA)';
  END IF;

  RAISE NOTICE '[0565] verify OK: 17 cap (13 sensitive), 32 grant, hr/hr-manager/manager = 0 cap, '
               '0 wildcard, payroll-officer …0015 2FA';
END;
$$;
--> statement-breakpoint

-- ─────────────── (7) CHECK audit_logs.object_type — CLONE NGUYÊN KHỐI 0560 bước (5) / 0545 ───────────────
-- ĐO 2026-09-01: cả 4 giá trị payroll ĐÃ CÓ trong CHECK (từ band G12: 0090/0093/0099) ⇒ khối này sẽ
-- idempotent-skip + RAISE NOTICE, KHÔNG ALTER. GIỮ NGUYÊN — xoá là mất cổng cho DB chưa có đủ 4 giá trị.
-- Neo 2 tầng vào `object_type = ANY (…)`, fail-closed, NO-LOSS/NO-GAIN (audit-check-union-parse-anchor-trap).
DO $$
DECLARE
  v_oid     oid;
  v_con     text;
  v_def     text;
  v_raw     text;
  v_matched boolean := false;
  v_cnt     int;
  v_cur     text[];
  v_new     text[] := ARRAY['payroll_period', 'salary_profile', 'bonus_penalty', 'payslip'];
  v_add     text[];
  v_union   text[];
  v_after   text[];
  v_missing text[];
  v_extra   text[];
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

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
      RAISE EXCEPTION '[0565] khong xac dinh duoc CHECK object_type tren audit_logs (so match = %) — DUNG fail-closed', v_cnt;
    END IF;
    SELECT oid, conname INTO v_oid, v_con
      FROM pg_constraint
     WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
       AND conname LIKE '%object_type%';
  END IF;

  v_def := pg_get_constraintdef(v_oid);

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
    RAISE EXCEPTION '[0565] khong parse duoc allow-list cua object_type = ANY(...) cho % : % — DUNG fail-closed', v_con, v_def;
  END IF;

  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) IS NULL THEN
    RAISE NOTICE '[0565] payroll_period/salary_profile/bonus_penalty/payslip DA co trong CHECK '
                 '(band G12 0090/0093/0099) — idempotent skip, KHONG ALTER rong';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  IF NOT (v_union @> v_cur) THEN
    RAISE EXCEPTION '[0565] union danh mat gia tri cu — DUNG (bat bien #2 append-only)';
  END IF;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );

  SELECT substring(pg_get_constraintdef(oid) FROM 'object_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*''(\{[^}]*\})''')::text[]
    INTO v_after
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c' AND conname = v_con;

  SELECT array_agg(t) INTO v_missing
    FROM unnest(v_cur || v_new) AS t
   WHERE v_after IS NULL OR NOT (v_after @> ARRAY[t]);
  IF v_missing IS NOT NULL AND array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION '[0565] verify NO-LOSS that bai — CHECK thieu: %', array_to_string(v_missing, ', ');
  END IF;

  SELECT array_agg(t) INTO v_extra
    FROM unnest(COALESCE(v_after, ARRAY[]::text[])) AS t
   WHERE NOT ((v_cur || v_new) @> ARRAY[t]);
  IF v_extra IS NOT NULL AND array_length(v_extra, 1) > 0 THEN
    RAISE EXCEPTION '[0565] verify NO-GAIN that bai — CHECK phinh them: %', array_to_string(v_extra, ', ');
  END IF;

  RAISE NOTICE '[0565] audit_logs.object_type += % (union % gia tri)', array_to_string(v_add, ', '),
               array_length(v_union, 1);
END;
$$;
