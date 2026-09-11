-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0571 — S15-PAYROLL-DB-1 · bước B-1: seed dữ liệu TOÀN CỤC của PAYROLL v2
-- Nguồn: SPEC-11 §11.3 (17 cặp + ghi chú 7 ma trận 31 grant) · §12.1 ghi chú 4 (10 object_type)
--         · permission-matrix §9g.2 · DB-13 §15.3 bước B. Khuôn: 0565 (khối 4a/5/6/7).
--
-- ── PHẠM VI: CHỈ dữ liệu TOÀN CỤC ───────────────────────────────────────────────────────────────
--   (a) 17 cặp `permissions` — bảng permissions KHÔNG có company_id, là catalog toàn cục;
--   (b) 31 hàng `role_permissions` gắn role HỆ THỐNG (company_id IS NULL);
--   (c) CHECK `audit_logs.object_type` — DDL.
--
--   🔴 Seed company-scoped (`salary_components` · `payroll_statutory_rates` · `payroll_templates`
--   + `payroll_template_components`) KHÔNG nằm ở đây: ba bảng đó company_id NOT NULL, và mig 0445:12
--   + master-data-seeder.types.ts:8 CẤM seed company-scoped ở migrate-time (DB sạch có 0 company ⇒
--   seed 0 hàng ⇒ khối verify "4 nút engine / 3 pit_deductible" thành XANH RỖNG, đúng lớp lỗi
--   empty-success-is-the-fail-open-shape). Chúng sống ở `PayrollMasterDataSeeder` (runtime,
--   per-company, qua MasterDataSeedRunner). DB-13 §15.3 bước B đã đính chính.
--
--   ⚠️ HỆ QUẢ PHẢI BIẾT: MasterDataSeedRunner.runOne() bọc try/catch TOÀN PHẦN ⇒ seeder ném chỉ
--   thành batch Failed + log, KHÔNG chặn boot. Cổng CỨNG cho "catalog không đủ" vì vậy nằm ở đường
--   TÍNH/ĐỌC: 422 ERR-022 (thiếu tỉ lệ hiệu lực) · 422 ERR-018 (thiếu nút engine), CẤM trả 0 —
--   nợ đã ghi vào done_when của S15-PAYROLL-BE-2 và BE-3.
--
-- ⛔ KHÔNG seed 8 cặp quyền track C ở đây? — CÓ seed. 17 cặp của §11.3 gồm cả track C
--    (payroll-advance · payment-batch · payroll-budget); bảng của chúng ra đời ở DB-2 nhưng CẶP QUYỀN
--    là catalog toàn cục, seed một lượt rẻ hơn chạm bảng permissions hai lần.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) Catalog 17 cặp quyền v2 — TẤT CẢ is_sensitive = TRUE ───────────────
-- SPEC-11 §11.3 ghi chú 1: kể cả `view:statutory-rate`. Tỉ lệ luật định là hằng pháp luật công khai,
-- NHƯNG nó CHỞ SỐ TIỀN (trần đóng, ngưỡng 7 bậc thuế, mức giảm trừ). Luật của module là "số tiền
-- không đi qua cặp không nhạy cảm"; phân biệt "tiền công khai" với "tiền của công ty" là lập luận
-- phải làm lại ở MỖI lượt review, còn fail-closed thì không.
-- ⇒ tổng sau v2: 34 cặp / 30 sensitive / 4 không sensitive (đúng 4 cặp cũ của §11.1).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('view',     'payroll-employee', true),  -- PAYROLL.EMPLOYEE.VIEW     BH/công đoàn/TK ngân hàng (4 số cuối) + NPT + chiếu HR bó hẹp
  ('manage',   'payroll-employee', true),  -- PAYROLL.EMPLOYEE.MANAGE   ghi hai bảng đó
  ('view',     'salary-component', true),  -- PAYROLL.COMPONENT.VIEW    catalog thành phần + CÔNG THỨC
  ('manage',   'salary-component', true),  -- PAYROLL.COMPONENT.MANAGE  sửa công thức = sửa TIỀN CẢ CÔNG TY
  ('view',     'payroll-template', true),  -- PAYROLL.TEMPLATE.VIEW     mẫu + công thức ghi đè
  ('manage',   'payroll-template', true),  -- PAYROLL.TEMPLATE.MANAGE   tạo/sửa mẫu · đặt thành phần · xem trước
  ('view',     'statutory-rate',   true),  -- PAYROLL.STATUTORY.VIEW    bảng tỉ lệ luật định (CHỞ TIỀN — ghi chú 1)
  ('manage',   'statutory-rate',   true),  -- PAYROLL.STATUTORY.MANAGE  KHÔNG gán payroll-officer (ghi chú 3)
  ('view',     'payroll-advance',  true),  -- PAYROLL.ADVANCE.VIEW      tạm ứng của mọi người
  ('manage',   'payroll-advance',  true),  -- PAYROLL.ADVANCE.MANAGE    tạo · sửa khi Pending · xoá mềm
  ('approve',  'payroll-advance',  true),  -- PAYROLL.ADVANCE.APPROVE   duyệt/từ chối (tự duyệt chặn ở service)
  ('view-own', 'payroll-advance',  true),  -- PAYROLL.ADVANCE.VIEW-OWN  «Tạm ứng của tôi» — dạng SẠCH (ghi chú 6)
  ('view',     'payment-batch',    true),  -- PAYROLL.BATCH.VIEW        đợt chi trả + dòng chi
  ('manage',   'payment-batch',    true),  -- PAYROLL.BATCH.MANAGE      lập đợt · sửa dòng · HOÀN TẤT (⇒ kỳ Paid khi PHỦ ĐỦ)
  ('view',     'payroll-budget',   true),  -- PAYROLL.BUDGET.VIEW       ngân sách + thực hiện
  ('manage',   'payroll-budget',   true),  -- PAYROLL.BUDGET.MANAGE     KHÔNG gán payroll-officer (ghi chú 3)
  ('view',     'payroll-report',   true)   -- PAYROLL.REPORT.VIEW       Tổng quan module + 7 báo cáo
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────── (2) ÉP is_sensitive — ON CONFLICT DO NOTHING KHÔNG ghi lại cờ ───────────────
-- Nếu một cặp nào đó đã tồn tại từ trước (không kỳ vọng, nhưng không đo được trước lúc chạy) thì (1)
-- là NO-OP với nó và cờ giữ giá trị CŨ. Cặp lương để is_sensitive=false = ăn theo wildcard *:*
-- (§9g.1 #1) ⇒ ép tường minh, khuôn 0565 khối (4b).
UPDATE permissions SET is_sensitive = true
 WHERE (action, resource_type) IN (
        ('view','payroll-employee'), ('manage','payroll-employee'),
        ('view','salary-component'), ('manage','salary-component'),
        ('view','payroll-template'), ('manage','payroll-template'),
        ('view','statutory-rate'),   ('manage','statutory-rate'),
        ('view','payroll-advance'),  ('manage','payroll-advance'),
        ('approve','payroll-advance'), ('view-own','payroll-advance'),
        ('view','payment-batch'),    ('manage','payment-batch'),
        ('view','payroll-budget'),   ('manage','payroll-budget'),
        ('view','payroll-report'))
   AND is_sensitive IS DISTINCT FROM true;
--> statement-breakpoint

-- ─────────────── (3) Grant per-(role, pair) — ma trận §11.3 ghi chú 7 = 31 hàng MỚI ───────────────
-- Phép cộng: employee 1 + manager 0 + hr 0 + hr-manager 0 + payroll-officer 14 + company-admin 16 = 31.
-- Cộng 32 hàng của v1 ⇒ tổng 63 (verify ở khối (4)).
DO $$
DECLARE
  payroll_v2_grants CONSTANT text[][] := ARRAY[
    -- manager · hr · hr-manager: 0 hàng (DECISIONS-01 Phương án B — quyền lương KHÔNG mặc định cho HR)
    -- employee: 1 (chỉ đường Own)
    ['employee',        'view-own', 'payroll-advance',  'Own'],
    -- payroll-officer: 14 = 17 − manage:statutory-rate − manage:payroll-budget − view-own:payroll-advance.
    --   Hai cặp bị trừ KHÔNG phải four-eyes, lý do khác nhau (§11.3 ghi chú 3): đổi tỉ lệ luật định là
    --   đổi tiền của MỌI kỳ tương lai cho MỌI người (quyết định cấp công ty); ngân sách là cam kết tài
    --   chính của BOD. Officer ĐỌC được cả hai (cần để tính và đối chiếu), chỉ không ghi.
    ['payroll-officer', 'view',     'payroll-employee', 'Company'],
    ['payroll-officer', 'manage',   'payroll-employee', 'Company'],
    ['payroll-officer', 'view',     'salary-component', 'Company'],
    ['payroll-officer', 'manage',   'salary-component', 'Company'],
    ['payroll-officer', 'view',     'payroll-template', 'Company'],
    ['payroll-officer', 'manage',   'payroll-template', 'Company'],
    ['payroll-officer', 'view',     'statutory-rate',   'Company'],
    ['payroll-officer', 'view',     'payroll-advance',  'Company'],
    ['payroll-officer', 'manage',   'payroll-advance',  'Company'],
    ['payroll-officer', 'approve',  'payroll-advance',  'Company'],
    ['payroll-officer', 'view',     'payment-batch',    'Company'],
    ['payroll-officer', 'manage',   'payment-batch',    'Company'],
    ['payroll-officer', 'view',     'payroll-budget',   'Company'],
    ['payroll-officer', 'view',     'payroll-report',   'Company'],
    -- company-admin: 16 = 17 − view-own:payroll-advance (cặp Own của nhân viên, không thuộc quản trị)
    ['company-admin',   'view',     'payroll-employee', 'Company'],
    ['company-admin',   'manage',   'payroll-employee', 'Company'],
    ['company-admin',   'view',     'salary-component', 'Company'],
    ['company-admin',   'manage',   'salary-component', 'Company'],
    ['company-admin',   'view',     'payroll-template', 'Company'],
    ['company-admin',   'manage',   'payroll-template', 'Company'],
    ['company-admin',   'view',     'statutory-rate',   'Company'],
    ['company-admin',   'manage',   'statutory-rate',   'Company'],
    ['company-admin',   'view',     'payroll-advance',  'Company'],
    ['company-admin',   'manage',   'payroll-advance',  'Company'],
    ['company-admin',   'approve',  'payroll-advance',  'Company'],
    ['company-admin',   'view',     'payment-batch',    'Company'],
    ['company-admin',   'manage',   'payment-batch',    'Company'],
    ['company-admin',   'view',     'payroll-budget',   'Company'],
    ['company-admin',   'manage',   'payroll-budget',   'Company'],
    ['company-admin',   'view',     'payroll-report',   'Company']
  ];
  g          text[];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_rescoped int := 0;
  v_del      int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY payroll_v2_grants LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0571] role he thong % khong ton tai — seed 0005/0444/0565 phai chay truoc', g[1];
    END IF;

    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0571] permission (%:%) khong co trong catalog — buoc (1) phai chay truoc', g[2], g[3];
    END IF;

    -- UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ đổi scope = DELETE bộ scope SAI + INSERT.
    DELETE FROM role_permissions
     WHERE role_id = v_role_id AND permission_id = v_perm_id
       AND effect = 'ALLOW' AND data_scope <> g[4];
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', g[4])
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0571] PAYROLL v2 grants: % INSERT moi, % re-scope (ky vong 31 hang moi)', v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ═══════════════ (4) VERIFY FAIL-LOUD — seed quyền v2 ═══════════════
DO $$
DECLARE
  -- 🔴 "PAYROLL" định nghĩa bằng LITERAL resource_type, KHÔNG bằng LIKE 'payroll%'. Lọc LIKE sẽ BỎ SÓT
  --    salary-profile · bonus-penalty · payslip · salary-component · statutory-rate · payment-batch
  --    ⇒ số ra khác 34 ⇒ áp lực "sửa hằng cho qua". Tiền lệ đúng: s13-payroll-db1-invariants:587.
  v_resources CONSTANT text[] := ARRAY[
    -- 5 của v1 (0565)
    'payroll', 'payroll-period', 'salary-profile', 'bonus-penalty', 'payslip',
    -- 8 mới của v2
    'payroll-employee', 'salary-component', 'payroll-template', 'statutory-rate',
    'payroll-advance', 'payment-batch', 'payroll-budget', 'payroll-report'];
  -- Bốn tài nguyên có cặp manage/view tách đôi và vế manage CHỞ TIỀN trong payload (§11.3 ghi chú 8).
  v_manage_view CONSTANT text[] := ARRAY[
    'payroll-advance', 'payment-batch', 'payroll-budget', 'salary-component'];
  v_ids  uuid[];
  v_n    integer;
  v_bad  text;
  r      text;
BEGIN
  SELECT array_agg(id) INTO v_ids FROM permissions WHERE resource_type = ANY (v_resources);

  -- (4.1) Catalog: 34 cặp / 30 sensitive / 4 không sensitive.
  SELECT count(*) INTO v_n FROM permissions WHERE resource_type = ANY (v_resources);
  IF v_n <> 34 THEN
    RAISE EXCEPTION '[0571] verify: catalog PAYROLL co % cap, ky vong dung 34 (17 v1 + 17 v2)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM permissions WHERE resource_type = ANY (v_resources) AND is_sensitive;
  IF v_n <> 30 THEN
    SELECT string_agg(format('%s:%s=%s', action, resource_type, is_sensitive), ' ; ') INTO v_bad
      FROM permissions WHERE resource_type = ANY (v_resources) AND NOT is_sensitive;
    RAISE EXCEPTION '[0571] verify: co % cap PAYROLL sensitive, ky vong dung 30. Cap KHONG sensitive: %', v_n, v_bad;
  END IF;
  -- Bốn cặp không-sensitive phải ĐÚNG BẰNG 4 cặp cũ của §11.1 (canonical-seed-pin-regression).
  SELECT string_agg(format('%s:%s', action, resource_type), ' ; ') INTO v_bad
    FROM permissions
   WHERE resource_type = ANY (v_resources) AND NOT is_sensitive
     AND (action, resource_type) NOT IN (
          ('access','payroll'), ('view','payroll-period'),
          ('manage','payroll-period'), ('acknowledge-own-payslip','payslip'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0571] verify: cap PAYROLL khong-sensitive NGOAI danh sach 4 cua §11.1: %', v_bad;
  END IF;

  -- (4.2) Tổng grant PAYROLL = 63 (32 v1 + 31 v2).
  SELECT count(*) INTO v_n
    FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    JOIN roles ro ON ro.id = rp.role_id
   WHERE p.resource_type = ANY (v_resources) AND ro.company_id IS NULL AND ro.deleted_at IS NULL;
  IF v_n <> 63 THEN
    SELECT string_agg(format('%s -> %s:%s@%s', ro.name, p.action, p.resource_type, rp.data_scope), ' ; ')
      INTO v_bad
      FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
      JOIN roles ro ON ro.id = rp.role_id
     WHERE p.resource_type = ANY (v_resources) AND ro.company_id IS NULL AND ro.deleted_at IS NULL;
    RAISE EXCEPTION '[0571] verify: co % hang grant PAYROLL, ky vong dung 63. Hien trang: %', v_n, v_bad;
  END IF;

  -- (4.3) hr / hr-manager / manager = 0 cặp PAYROLL trên CẢ HAI bảng (DECISIONS-01 Phương án B).
  FOREACH r IN ARRAY ARRAY['hr', 'hr-manager', 'manager'] LOOP
    SELECT count(*) INTO v_n
      FROM role_permissions rp JOIN roles ro ON ro.id = rp.role_id
     WHERE ro.name = r AND rp.permission_id = ANY (v_ids);
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0571] verify: role % con % cap PAYROLL o role_permissions', r, v_n;
    END IF;
  END LOOP;

  -- (4.4) payroll-officer KHÔNG giữ manage:statutory-rate và manage:payroll-budget (§11.3 ghi chú 3).
  SELECT string_agg(format('%s:%s', p.action, p.resource_type), ' ; ') INTO v_bad
    FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    JOIN roles ro ON ro.id = rp.role_id
   WHERE ro.name = 'payroll-officer' AND ro.company_id IS NULL
     AND (p.action, p.resource_type) IN (('manage','statutory-rate'), ('manage','payroll-budget'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0571] verify: payroll-officer GIU cap bi cam: %', v_bad;
  END IF;

  -- (4.5) 🔴 MỌI role giữ manage:X đều phải giữ view:X cho BỐN tài nguyên (§11.3 ghi chú 8).
  --       Không phải vì tiện dụng: role có `manage` mà không `view` KHÔNG CÓ đường hợp lệ nào đọc lại
  --       số nó vừa ghi, và đó chính là áp lực làm WO sau nhét số tiền vào envelope GHI "cho đỡ phải
  --       gọi hai lần". Đóng đường đó ở tầng dữ liệu rẻ hơn đóng ở tầng ý chí.
  FOREACH r IN ARRAY v_manage_view LOOP
    SELECT string_agg(ro.name, ' ; ') INTO v_bad
      FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
      JOIN roles ro ON ro.id = rp.role_id
     WHERE ro.deleted_at IS NULL AND p.action = 'manage' AND p.resource_type = r
       AND NOT EXISTS (
         SELECT 1 FROM role_permissions rp2 JOIN permissions p2 ON p2.id = rp2.permission_id
          WHERE rp2.role_id = rp.role_id AND p2.action = 'view' AND p2.resource_type = r);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION '[0571] verify: role % giu manage:% ma THIEU view:% — khong co duong doc lai so vua ghi',
        v_bad, r, r;
    END IF;
  END LOOP;

  -- (4.6) manage:payroll-template ⇒ view:salary-component (mẫu tham chiếu mã thành phần; không đọc
  --       được catalog thì editor mẫu là ô trống).
  SELECT string_agg(ro.name, ' ; ') INTO v_bad
    FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    JOIN roles ro ON ro.id = rp.role_id
   WHERE ro.deleted_at IS NULL AND p.action = 'manage' AND p.resource_type = 'payroll-template'
     AND NOT EXISTS (
       SELECT 1 FROM role_permissions rp2 JOIN permissions p2 ON p2.id = rp2.permission_id
        WHERE rp2.role_id = rp.role_id AND p2.action = 'view' AND p2.resource_type = 'salary-component');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0571] verify: role % giu manage:payroll-template ma THIEU view:salary-component', v_bad;
  END IF;

  -- (4.7) approve:payroll-advance ⇒ view:payroll-advance (chống DUYỆT MÙ — lớp lỗi §11.1 đã chặn cho
  --       approve:payroll-period).
  SELECT string_agg(ro.name, ' ; ') INTO v_bad
    FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    JOIN roles ro ON ro.id = rp.role_id
   WHERE ro.deleted_at IS NULL AND p.action = 'approve' AND p.resource_type = 'payroll-advance'
     AND NOT EXISTS (
       SELECT 1 FROM role_permissions rp2 JOIN permissions p2 ON p2.id = rp2.permission_id
        WHERE rp2.role_id = rp.role_id AND p2.action = 'view' AND p2.resource_type = 'payroll-advance');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0571] verify: role % giu approve:payroll-advance ma THIEU view — DUYET MU', v_bad;
  END IF;

  -- (4.8) Census 4 hình dạng wildcard (permission-grant-census-must-cover-four-wildcard-shapes).
  --  ⚠️ QUÉT MỌI ROLE, loại `super-admin` theo TÊN — KHÔNG lọc company_id IS NULL: role TUỲ BIẾN của
  --     tenant có company_id NOT NULL nên câu census lọc theo scope sẽ MÙ với đúng nhóm nguy hiểm.
  SELECT string_agg(format('%s -> %s:%s', ro.name, p.action, p.resource_type), ' ; ') INTO v_bad
    FROM role_permissions rp
    JOIN roles ro      ON ro.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE ro.deleted_at IS NULL AND ro.name <> 'super-admin'
     AND (p.action = '*' OR p.resource_type = '*');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0571] verify: grant wildcard = duong ngam vao cap sensitive PAYROLL v2: %', v_bad;
  END IF;

  -- (4.9) object_permissions = 0 hàng trỏ cặp PAYROLL — hình dạng bypass MẠNH NHẤT (object grant vốn
  --       là exact ⇒ nó CHÍNH LÀ grant tường minh mà cổng sensitive đòi).
  SELECT string_agg(format('%s/%s -> %s:%s', op.subject_type, op.subject_id, p.action, p.resource_type), ' ; ')
    INTO v_bad
    FROM object_permissions op JOIN permissions p ON p.id = op.permission_id
   WHERE op.permission_id = ANY (v_ids);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0571] verify: co object_permissions tro cap PAYROLL (bypass cong sensitive): %', v_bad;
  END IF;

  RAISE NOTICE '[0571] verify OK: 34 cap (30 sensitive), 63 grant, hr/hr-manager/manager = 0, '
               '0 wildcard, manage=>view du 4 tai nguyen';
END;
$$;
--> statement-breakpoint

-- ─────────────── (5) CHECK audit_logs.object_type — UNION-ADD 10 giá trị ───────────────
-- CLONE NGUYÊN KHỐI 0565 bước (7) / 0545: neo 2 tầng, fail-closed, NO-LOSS/NO-GAIN
-- (audit-check-union-parse-anchor-trap). `AUDIT_OBJECT_TYPES` (db/schema/audit.ts) đồng bộ CÙNG COMMIT.
--
-- ⚠️ BẤT ĐỐI XỨNG CỐ Ý giữa hai không gian tên: resource_type của quyền là `statutory-rate` /
--    `payment-batch`, nhưng object_type là `payroll_statutory_rate` / `payroll_payment_batch`. Đúng chỗ
--    trôi tên ⇒ ghi object_type ngoài bản đồ = CHECK violation = 500 TRÊN ĐƯỜNG ĐỌC. Chép literal,
--    ĐỪNG suy từ tên cặp quyền.
-- ⚠️ `payroll_employee` và `payroll_report` KHÔNG ứng với bảng nào (chiếu HR bó hẹp · báo cáo là phép
--    đọc số liệu, không phải một hàng). Thiếu chúng ⇒ 6/18 đường audit-đọc của SPEC-11 §18.1 B trả 500.
-- ⚠️ CÓ CHỦ ĐÍCH: cấp cả 3 giá trị track C (`payroll_advance` · `payroll_payment_batch` ·
--    `payroll_budget`) ngay ở DB-1 dù bảng thuộc DB-2 — MỘT lượt UNION-ADD, tránh chạm parse-anchor
--    lần thứ hai. Đây KHÔNG phải cấp thừa; reviewer sau đừng gỡ.
-- ⚠️ `payroll_payment_lines` · `payroll_template_components` · `salary_profile_items` KHÔNG có
--    object_type riêng — vết của chúng đi kèm đối tượng CHA.
DO $$
DECLARE
  v_oid     oid;
  v_con     text;
  v_def     text;
  v_raw     text;
  v_matched boolean := false;
  v_cnt     int;
  v_cur     text[];
  v_new     text[] := ARRAY[
    'payroll_employee', 'payroll_employee_setting', 'payroll_dependent', 'salary_component',
    'payroll_template', 'payroll_statutory_rate', 'payroll_advance', 'payroll_payment_batch',
    'payroll_budget', 'payroll_report'];
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
      RAISE EXCEPTION '[0571] khong xac dinh duoc CHECK object_type tren audit_logs (so match = %) — DUNG fail-closed', v_cnt;
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
    RAISE EXCEPTION '[0571] khong parse duoc allow-list cua object_type = ANY(...) cho % : % — DUNG fail-closed', v_con, v_def;
  END IF;

  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) IS NULL THEN
    RAISE NOTICE '[0571] 10 gia tri object_type v2 DA co trong CHECK — idempotent skip, KHONG ALTER rong';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  IF NOT (v_union @> v_cur) THEN
    RAISE EXCEPTION '[0571] union danh mat gia tri cu — DUNG (bat bien #2 append-only)';
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
    RAISE EXCEPTION '[0571] verify NO-LOSS that bai — CHECK thieu: %', array_to_string(v_missing, ', ');
  END IF;

  SELECT array_agg(t) INTO v_extra
    FROM unnest(COALESCE(v_after, ARRAY[]::text[])) AS t
   WHERE NOT ((v_cur || v_new) @> ARRAY[t]);
  IF v_extra IS NOT NULL AND array_length(v_extra, 1) > 0 THEN
    RAISE EXCEPTION '[0571] verify NO-GAIN that bai — CHECK phinh them: %', array_to_string(v_extra, ', ');
  END IF;

  RAISE NOTICE '[0571] audit_logs.object_type += % (union % gia tri, ky vong 14 cho PAYROLL)',
               array_to_string(v_add, ', '), array_length(v_union, 1);
END;
$$;
