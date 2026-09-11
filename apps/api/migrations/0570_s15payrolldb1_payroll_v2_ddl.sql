-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0570 — S15-PAYROLL-DB-1 · bước A: DDL PAYROLL v2 (track A + B)
-- Nguồn: DB-13 §12.1 · §12.2 · §12.2.a · §12.4 · §13.1–§13.7 · §15.3 bước A · §15.4
-- Plan + biên bản cổng: docs/plans/S15-PAYROLL-DB-1.md · docs/plans/S15-PAYROLL-DB-1-review.md
--
-- NỘI DUNG: ALTER 2 bảng (salary_profiles §12.1 · payroll_period_lines §12.4) + TẠO 7 bảng mới
--           + CREATE EXTENSION btree_gist + backfill EXPAND allowances → salary_profile_items.
--
-- ⛔ KHÔNG CHẠM `payroll_periods`. template_id / paid_by / paid_at / nới status_check 8 giá trị /
--    UPDATE 'Paid'→'Published' / published_pair_check / paid_pair_check là CHUỖI 4 BƯỚC NGUYÊN TỬ
--    của S15-PAYROLL-DB-2 (DB-13 §12.3). Tách ra = 23514 giữa lane migration.
--
-- ── SỐ ĐO bước 0 (11/09/2026) ──────────────────────────────────────────────────────────────────
--   • _journal.json max(idx) = 236 / tag 0569_s14recruitfilegrant1_candidate_file_perm ⇒ file này idx 237.
--   • PROD: v1 CHƯA lên PROD (S14-PROD-PAYROLLGRANT-1 còn treo) ⇒ kỳ vọng 0 hàng salary_profiles.
--     Lane/dev DB CÓ hàng. Backfill ở khối (6) chạy đúng với CẢ HAI.
--   • Số đo dán vào PR lấy từ RAISE NOTICE của khối (6) — xem ghi chú "LITERAL vs PER-PROFILE" ở đó.
--   • Bàn giao DB-2: `SELECT count(*) FROM payroll_periods WHERE status = 'Paid';` — ĐO khi chạy,
--     ghi vào PR. Bước (3) của §12.3 cần số này để verify sau di trú.
--
-- ── VÌ SAO SEED KHÔNG NẰM Ở ĐÂY ────────────────────────────────────────────────────────────────
--   `salary_components` · `payroll_statutory_rates` · `payroll_templates` đều company-scoped
--   (company_id NOT NULL). Mig 0445:12 + master-data-seeder.types.ts:8 CẤM seed company-scoped ở
--   migrate-time: DB sạch có 0 company ⇒ migration seed 0 hàng ⇒ khối verify "4 nút engine" thành
--   XANH RỖNG. Seed sống ở PayrollMasterDataSeeder (runtime, per-company). 0571 chỉ seed dữ liệu
--   TOÀN CỤC (quyền + CHECK audit). DB-13 §15.3 bước B đã đính chính.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) GUARD tiền đề — fail-loud TRƯỚC mọi DDL ───────────────
DO $$
DECLARE
  v_n   integer;
  v_bad text;
BEGIN
  -- (1a) hai bảng bị ALTER phải tồn tại (band 0091 / 0564).
  FOREACH v_bad IN ARRAY ARRAY['salary_profiles', 'payroll_period_lines'] LOOP
    IF to_regclass(v_bad) IS NULL THEN
      RAISE EXCEPTION '[0570] DUNG: bang % khong ton tai — mig 0091/0564 phai chay truoc', v_bad;
    END IF;
  END LOOP;

  -- (1b) ĐÍCH của composite tenant-FK phải có UNIQUE (company_id, id) TRƯỚC khi bị trỏ tới.
  --      payroll_templates + salary_components tự tạo ở khối (5) nên không guard ở đây.
  FOREACH v_bad IN ARRAY ARRAY['users', 'org_units', 'salary_profiles'] LOOP
    SELECT count(*) INTO v_n
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN LATERAL unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
     WHERE t.relname = v_bad AND c.contype = 'u' AND array_length(c.conkey, 1) = 2
       AND a.attname IN ('company_id', 'id')
     GROUP BY c.oid
     HAVING count(*) = 2
     LIMIT 1;
    IF COALESCE(v_n, 0) <> 2 THEN
      RAISE EXCEPTION '[0570] DUNG: % thieu UNIQUE (company_id, id) — composite tenant-FK khong tao duoc', v_bad;
    END IF;
  END LOOP;

  -- (1c) 5 cột §12.1 CHƯA tồn tại — có rồi nghĩa là migration đã chạy nửa vời, DỪNG cho người xem.
  SELECT string_agg(column_name, ', ') INTO v_bad
    FROM information_schema.columns
   WHERE table_name = 'salary_profiles'
     AND column_name IN ('salary_type', 'pit_payer', 'insurance_salary', 'probation_salary', 'pay_ratio_pct');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0570] DUNG: salary_profiles DA CO cot v2 (%) — migration da chay nua voi', v_bad;
  END IF;

  -- (1d) `allowances` phải là MẢNG ở mọi hàng. jsonb_array_length() NÉM với object/scalar và thông
  --      điệp của nó không chỉ ra hàng nào — bắt sớm, thông điệp riêng (DB-13 §12.2).
  SELECT string_agg(format('%s(%s)', id, jsonb_typeof(allowances)), ', ') INTO v_bad
    FROM salary_profiles
   WHERE jsonb_typeof(allowances) IS DISTINCT FROM 'array';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0570] DUNG: salary_profiles.allowances khong phai mang o cac hang: %', v_bad;
  END IF;
END $$;
--> statement-breakpoint

-- ─────────────── (2) EXTENSION — TRƯỚC mọi EXCLUDE (DB-13 §15.4) ───────────────
-- `EXCLUDE` của payroll_dependents trộn toán tử `=` (uuid/text) với `&&` (range) ⇒ KHÔNG tạo được
-- nếu thiếu btree_gist. Verify ở khối (7).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- ════════════════ (3) ALTER salary_profiles — 5 cột (DB-13 §12.1 · PAY-DEC-015/016) ════════════════
-- ⚠️ TÊN `salary_type` ĐÃ TỒN TẠI Ở BẢNG KHÁC, KHÁC NGHĨA: employee_profiles.salary_type (CHECK
--    `emp_salary_type_check` ∈ monthly/hourly/project). Vì vậy CHECK ở đây BẮT BUỘC mang tiền tố bảng.
ALTER TABLE salary_profiles ADD COLUMN salary_type      text          NOT NULL DEFAULT 'GROSS';
--> statement-breakpoint
ALTER TABLE salary_profiles ADD COLUMN pit_payer        text          NOT NULL DEFAULT 'EMPLOYEE';
--> statement-breakpoint
-- ⚠️ insurance_salary để NULL. TUYỆT ĐỐI KHÔNG backfill = base_salary: hai đại lượng trùng nhau HÔM NAY
--    nhưng là hai khái niệm. Backfill biến "chưa khai" thành "đã khai bằng lương", và lần sau đổi
--    base_salary thì căn cứ đóng BH KHÔNG đổi theo ⇒ sai âm thầm vào số nộp bảo hiểm. Quy tắc
--    "NULL ⇒ dùng base_salary" sống ở SERVICE, MỘT chỗ (DB-13 §12.1).
ALTER TABLE salary_profiles ADD COLUMN insurance_salary numeric(18,2);
--> statement-breakpoint
ALTER TABLE salary_profiles ADD COLUMN probation_salary numeric(18,2);
--> statement-breakpoint
-- ⚠️ pay_ratio_pct áp lên LƯƠNG, KHÔNG áp lên căn cứ đóng BH (SPEC-11 §13.7 B). DB không ép được điều
--    đó — ca test ở S15-PAYROLL-BE-3 là chốt duy nhất.
ALTER TABLE salary_profiles ADD COLUMN pay_ratio_pct    numeric(5,2)  NOT NULL DEFAULT 100.00;
--> statement-breakpoint
ALTER TABLE salary_profiles
  ADD CONSTRAINT salary_profiles_salary_type_check      CHECK (salary_type IN ('GROSS','NET')),
  ADD CONSTRAINT salary_profiles_pit_payer_check        CHECK (pit_payer IN ('EMPLOYEE','COMPANY')),
  ADD CONSTRAINT salary_profiles_insurance_salary_check CHECK (insurance_salary IS NULL OR insurance_salary > 0),
  ADD CONSTRAINT salary_profiles_probation_salary_check CHECK (probation_salary IS NULL OR probation_salary > 0),
  ADD CONSTRAINT salary_profiles_pay_ratio_check        CHECK (pay_ratio_pct > 0 AND pay_ratio_pct <= 100);
--> statement-breakpoint

-- ════════════════ (4) ALTER payroll_period_lines — 3 cột (DB-13 §12.4 · PAY-DEC-012) ════════════════
-- ⚠️ component_values_json CÓ DEFAULT '{}', khác payslips.input_snapshot_json (KHÔNG default). Có chủ
--    đích: dòng v1 hợp lệ KHÔNG có giá trị thành phần nào nên {} là trạng thái ĐÚNG của chúng.
--    ⇒ KHÔNG thêm CHECK <> '{}': ràng buộc "dòng tính bằng mẫu phải có component values" phụ thuộc
--    template_id của KỲ (bảng khác) nên CHECK không biểu diễn được. Ép ở service + ca test.
ALTER TABLE payroll_period_lines ADD COLUMN component_values_json jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE payroll_period_lines ADD COLUMN template_fingerprint  text;
--> statement-breakpoint
ALTER TABLE payroll_period_lines ADD COLUMN gross_up_iterations   integer;
--> statement-breakpoint
ALTER TABLE payroll_period_lines
  ADD CONSTRAINT payroll_period_lines_grossup_check CHECK (
    gross_up_iterations IS NULL OR (gross_up_iterations >= 0 AND gross_up_iterations <= 30)),
  ADD CONSTRAINT payroll_period_lines_fingerprint_check CHECK (
    template_fingerprint IS NULL OR template_fingerprint ~ '^[0-9a-f]{64}$');
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (5) BẢY BẢNG MỚI (DB-13 §13.1–§13.7)
--
-- THỨ TỰ per-bảng BẮT BUỘC (khuôn 0564 khối 9):
--   CREATE TABLE (kèm UNIQUE (company_id,id)) → ENABLE RLS → FORCE RLS → POLICY → composite FK
--   → index → GRANT.   RLS + FORCE + policy đứng TRƯỚC mọi INSERT (BẤT BIẾN #1).
-- THỨ TỰ 7 bảng: payroll_template_components ĐỨNG CUỐI (nó trỏ payroll_templates + salary_components).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (5a) salary_profile_items (DB-13 §13.1) ───────────────
-- component_code là TEXT, KHÔNG FK cứng sang salary_components.code — có chủ đích: hồ sơ lương là bản
-- ghi versioned ĐÓNG BĂNG theo effective_date; FK cứng biến thao tác catalog thành thao tác đụng dữ
-- liệu lịch sử. Service kiểm mã khi GHI ⇒ 422 ERR-018.
CREATE TABLE salary_profile_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL DEFAULT (NULLIF(current_setting('app.current_company_id', true), ''))::uuid
                      REFERENCES companies (id) ON DELETE CASCADE,
  salary_profile_id uuid NOT NULL,
  component_code    text NOT NULL,
  amount            numeric(18,2) NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  deleted_at        timestamptz,
  deleted_by        uuid,
  CONSTRAINT salary_profile_items_amount_check CHECK (amount >= 0),
  CONSTRAINT salary_profile_items_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE salary_profile_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE salary_profile_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON salary_profile_items;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON salary_profile_items
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE salary_profile_items
  ADD CONSTRAINT salary_profile_items_salary_profile_id_company_fk FOREIGN KEY (company_id, salary_profile_id)
    REFERENCES salary_profiles (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT salary_profile_items_created_by_company_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT salary_profile_items_updated_by_company_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT salary_profile_items_deleted_by_company_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
CREATE UNIQUE INDEX salary_profile_items_profile_component_uq
  ON salary_profile_items (company_id, salary_profile_id, component_code) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX salary_profile_items_company_profile_idx
  ON salary_profile_items (company_id, salary_profile_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON salary_profile_items TO mediaos_app;
--> statement-breakpoint

-- ─────────────── (5b) payroll_employee_settings (DB-13 §13.2 · PAY-DEC-017) ───────────────
-- bank_account_number là PII hạng tax_code, KHÔNG phải secret hạng bất biến #3: lưu plaintext + mask ở
-- server (vắng khoá) + audit lượt xem. KHÔNG envelope-encryption/KMS (SPEC-11 §3.12) — ghi ở đây để
-- lượt sau không "nâng cấp" lệch với employee_profiles.tax_code.
-- Đo 11/09/2026: `grep -i bank apps/api/src/db/schema/` = 0 hit ⇒ cột ngân hàng BẮT BUỘC ở bảng này.
CREATE TABLE payroll_employee_settings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL DEFAULT (NULLIF(current_setting('app.current_company_id', true), ''))::uuid
                           REFERENCES companies (id) ON DELETE CASCADE,
  user_id                uuid NOT NULL,
  joins_social_insurance boolean NOT NULL DEFAULT false,
  social_insurance_no    text,
  joins_union            boolean NOT NULL DEFAULT false,
  bank_account_number    text,
  bank_name              text,
  bank_branch            text,
  account_holder         text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid,
  deleted_at             timestamptz,
  deleted_by             uuid,
  -- CỐ Ý LỎNG với bank_branch (nhiều ngân hàng không cần chi nhánh). Nhưng SỐ TÀI KHOẢN KHÔNG CÓ TÊN
  -- CHỦ TÀI KHOẢN là một dòng UNC KHÔNG GỬI ĐƯỢC ⇒ cặp number + holder + bank_name là ràng buộc THẬT.
  CONSTRAINT payroll_employee_settings_bank_pair_check CHECK (
    bank_account_number IS NULL OR (bank_name IS NOT NULL AND account_holder IS NOT NULL)),
  CONSTRAINT payroll_employee_settings_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE payroll_employee_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_employee_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON payroll_employee_settings;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payroll_employee_settings
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE payroll_employee_settings
  ADD CONSTRAINT payroll_employee_settings_user_id_company_fk FOREIGN KEY (company_id, user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_employee_settings_created_by_company_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT payroll_employee_settings_updated_by_company_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT payroll_employee_settings_deleted_by_company_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
CREATE UNIQUE INDEX payroll_employee_settings_user_uq
  ON payroll_employee_settings (company_id, user_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON payroll_employee_settings TO mediaos_app;
--> statement-breakpoint

-- ─────────────── (5c) payroll_dependents (DB-13 §13.3) ───────────────
CREATE TABLE payroll_dependents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL DEFAULT (NULLIF(current_setting('app.current_company_id', true), ''))::uuid
                       REFERENCES companies (id) ON DELETE CASCADE,
  user_id            uuid NOT NULL,
  full_name          text NOT NULL,
  relationship       text NOT NULL,
  dependent_tax_code text,
  date_of_birth      date,
  effective_from     date NOT NULL,
  effective_to       date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid,
  deleted_at         timestamptz,
  deleted_by         uuid,
  CONSTRAINT payroll_dependents_relationship_check CHECK (
    relationship IN ('Child','Spouse','Parent','Other')),
  CONSTRAINT payroll_dependents_period_check CHECK (
    effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT payroll_dependents_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE payroll_dependents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_dependents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON payroll_dependents;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payroll_dependents
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE payroll_dependents
  ADD CONSTRAINT payroll_dependents_user_id_company_fk FOREIGN KEY (company_id, user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_dependents_created_by_company_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT payroll_dependents_updated_by_company_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT payroll_dependents_deleted_by_company_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
-- 🔴 Khoá chống trùng dùng full_name (NOT NULL), KHÔNG dùng dependent_tax_code: MST NPT là cột NULLABLE
--    (nhiều NPT là trẻ em chưa có MST), mà EXCLUDE trên cột NULL KHÔNG LOẠI ĐƯỢC GÌ — hai hàng NULL
--    không "bằng" nhau nên ràng buộc thành RỖNG và ERR-032 thành mã chết
--    (nullable-escape-clause-makes-check-vacuous). Trùng tên thật (hai con cùng tên) là ca hiếm, xử lý
--    bằng thông điệp lỗi hướng dẫn thêm hậu tố — CÓ CHỦ ĐÍCH, không phải bỏ sót.
-- ⚠️ Dạng `daterange(from, to, '[]')` với to = NULL là UNBOUNDED — cùng ngữ nghĩa với
--    COALESCE(to, 'infinity'::date) mà DB-13 §13.3 viết, nhưng tránh hẳn câu hỏi date 'infinity' + 1
--    của hàm canonical daterange. DB-13 §13.3 đã đính chính theo dạng này.
-- ⚠️ EXCLUDE ném 23P01 (exclusion_violation), KHÔNG phải 23505 ⇒ service bóc 23P01 từ error.cause →
--    409 PAYROLL-ERR-032. Map thiếu = 500 ở vùng đỏ (drizzle-wraps-pg-error-code-in-cause).
ALTER TABLE payroll_dependents
  ADD CONSTRAINT payroll_dependents_no_overlap_excl EXCLUDE USING gist (
    company_id WITH =,
    user_id    WITH =,
    full_name  WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX payroll_dependents_company_user_idx
  ON payroll_dependents (company_id, user_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON payroll_dependents TO mediaos_app;
--> statement-breakpoint

-- ─────────────── (5d) salary_components (DB-13 §13.4) ───────────────
CREATE TABLE salary_components (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL DEFAULT (NULLIF(current_setting('app.current_company_id', true), ''))::uuid
                   REFERENCES companies (id) ON DELETE CASCADE,
  code           text NOT NULL,
  name           text NOT NULL,
  kind           text NOT NULL,
  value_type     text NOT NULL,
  formula        text,
  fixed_amount   numeric(18,2),
  pit_deductible boolean NOT NULL DEFAULT false,
  is_system      boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  deleted_at     timestamptz,
  deleted_by     uuid,
  -- 🔴 Chốt DB cho luật "không gian tên dùng chung" (SPEC-11 §8.2 C1 · §13.6 D). Không có nó, một
  --    thành phần tên SYS_GROSS CHE biến hệ thống trong mọi công thức — không CHECK nào khác bắt.
  --    Lưu ý escape `\_`: dấu gạch dưới là ký tự ĐẠI DIỆN của LIKE.
  CONSTRAINT salary_components_code_shape_check CHECK (
    code ~ '^[A-Z][A-Z0-9_]{0,31}$'
    AND code NOT LIKE 'SYS\_%' AND code NOT LIKE 'TL\_%' AND code NOT LIKE 'GT\_%'),
  CONSTRAINT salary_components_kind_check CHECK (
    kind IN ('earning','deduction','statutory_employee','statutory_employer','tax','tax_exempt','aggregate')),
  CONSTRAINT salary_components_value_type_check CHECK (
    value_type IN ('formula','fixed','profile_item','engine')),
  CONSTRAINT salary_components_value_pair_check CHECK (
       (value_type = 'formula'      AND formula IS NOT NULL AND fixed_amount IS NULL)
    OR (value_type = 'fixed'        AND fixed_amount IS NOT NULL AND formula IS NULL)
    OR (value_type = 'profile_item' AND formula IS NULL AND fixed_amount IS NULL)
    OR (value_type = 'engine'       AND formula IS NULL AND fixed_amount IS NULL AND is_system)),
  CONSTRAINT salary_components_formula_len_check CHECK (
    formula IS NULL OR length(formula) <= 500),
  -- 🔴 Hàng hệ thống KHÔNG xoá mềm được — chốt cuối Ở DB, không chỉ ở service. Một lượt xoá mềm lọt
  --    qua (bug/script/repository gọi thẳng) ⇒ hàng rơi khỏi salary_components_company_code_uq
  --    (partial WHERE deleted_at IS NULL) ⇒ người dùng TẠO LẠI `TONG_KHAU_TRU` với công thức tuỳ ý và
  --    CHE nút engine. code_shape_check KHÔNG đỡ được: 4 mã đó không mang tiền tố SYS_/TL_/GT_.
  CONSTRAINT salary_components_system_not_deletable CHECK (
    is_system = false OR deleted_at IS NULL),
  -- 🔴 `engine` chỉ dành cho 4 nút aggregate, và MỌI aggregate đều phải là `engine` — ÉP HAI CHIỀU.
  --    Khai 4 nút là value_type='fixed', fixed_amount=0 là BẪY FAIL-OPEN IM LẶNG: mọi switch
  --    (value_type) viết đúng-theo-DB rơi vào nhánh `fixed` và trả 0 ⇒ TONG_THU_NHAP=0 ⇒ net=0, hoặc
  --    TONG_KHAU_TRU=0 ⇒ net=gross — TRONG KHI MỌI BẤT BIẾN SQL VẪN XANH
  --    (empty-success-is-the-fail-open-shape). Giá trị enum thứ tư thì TRÌNH BIÊN DỊCH ép xử lý.
  CONSTRAINT salary_components_engine_kind_check CHECK (
    (value_type = 'engine') = (kind = 'aggregate')),
  CONSTRAINT salary_components_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE salary_components ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE salary_components FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON salary_components;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON salary_components
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE salary_components
  ADD CONSTRAINT salary_components_created_by_company_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT salary_components_updated_by_company_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT salary_components_deleted_by_company_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
CREATE UNIQUE INDEX salary_components_company_code_uq
  ON salary_components (company_id, code) WHERE deleted_at IS NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON salary_components TO mediaos_app;
--> statement-breakpoint

-- ─────────────── (5e) payroll_statutory_rates (DB-13 §13.7 · PAY-DEC-014) ───────────────
-- ⚠️ Trần lưu THÀNH TIỀN, KHÔNG lưu hệ số: "20×" và mức nền đổi ĐỘC LẬP nhau qua từng đợt sửa luật;
--    lưu tích số là đúng thứ hệ thống ÁP, còn base_wage/min_region_wage lưu kèm CHỈ để giải thích con
--    số đó đến từ đâu. Service KHÔNG nhân lại — ca test ghim (SPEC-11 §13.7 B).
-- ⚠️ CHECK chỉ ép HÌNH DẠNG pit_brackets (mảng, 7 phần tử), KHÔNG ép tính LIÊN TỤC (không hở/chồng,
--    upTo tăng dần, bậc cuối null) — cần hàm PL/pgSQL trong CHECK, không immutable ⇒ kiểm ở SERVICE
--    lúc LƯU và lúc TÍNH ⇒ 422 ERR-022 (S15-PAYROLL-BE-2/BE-3).
CREATE TABLE payroll_statutory_rates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL DEFAULT (NULLIF(current_setting('app.current_company_id', true), ''))::uuid
                        REFERENCES companies (id) ON DELETE CASCADE,
  effective_from      date NOT NULL,
  si_employee_pct     numeric(5,2)  NOT NULL,
  hi_employee_pct     numeric(5,2)  NOT NULL,
  ui_employee_pct     numeric(5,2)  NOT NULL,
  si_employer_pct     numeric(5,2)  NOT NULL,
  hi_employer_pct     numeric(5,2)  NOT NULL,
  ui_employer_pct     numeric(5,2)  NOT NULL,
  union_employer_pct  numeric(5,2)  NOT NULL,
  union_employee_pct  numeric(5,2)  NOT NULL,
  si_cap              numeric(18,2) NOT NULL,
  hi_cap              numeric(18,2) NOT NULL,
  ui_cap              numeric(18,2) NOT NULL,
  base_wage           numeric(18,2) NOT NULL,
  min_region_wage     numeric(18,2) NOT NULL,
  personal_deduction  numeric(18,2) NOT NULL,
  dependent_deduction numeric(18,2) NOT NULL,
  pit_brackets        jsonb NOT NULL,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,
  deleted_at          timestamptz,
  deleted_by          uuid,
  CONSTRAINT payroll_statutory_rates_pct_range_check CHECK (
        si_employee_pct BETWEEN 0 AND 100 AND hi_employee_pct BETWEEN 0 AND 100
    AND ui_employee_pct BETWEEN 0 AND 100 AND si_employer_pct BETWEEN 0 AND 100
    AND hi_employer_pct BETWEEN 0 AND 100 AND ui_employer_pct BETWEEN 0 AND 100
    AND union_employer_pct BETWEEN 0 AND 100 AND union_employee_pct BETWEEN 0 AND 100),
  CONSTRAINT payroll_statutory_rates_amount_check CHECK (
        si_cap > 0 AND hi_cap > 0 AND ui_cap > 0 AND base_wage > 0 AND min_region_wage > 0
    AND personal_deduction >= 0 AND dependent_deduction >= 0),
  CONSTRAINT payroll_statutory_rates_brackets_check CHECK (
    jsonb_typeof(pit_brackets) = 'array' AND jsonb_array_length(pit_brackets) = 7),
  CONSTRAINT payroll_statutory_rates_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE payroll_statutory_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_statutory_rates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON payroll_statutory_rates;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payroll_statutory_rates
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE payroll_statutory_rates
  ADD CONSTRAINT payroll_statutory_rates_created_by_company_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT payroll_statutory_rates_updated_by_company_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT payroll_statutory_rates_deleted_by_company_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
CREATE UNIQUE INDEX payroll_statutory_rates_company_effective_uq
  ON payroll_statutory_rates (company_id, effective_from) WHERE deleted_at IS NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON payroll_statutory_rates TO mediaos_app;
--> statement-breakpoint

-- ─────────────── (5f) payroll_templates (DB-13 §13.5 · PAY-DEC-013) ───────────────
CREATE TABLE payroll_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL DEFAULT (NULLIF(current_setting('app.current_company_id', true), ''))::uuid
                REFERENCES companies (id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  scope       text NOT NULL DEFAULT 'company',
  org_unit_id uuid,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid,
  CONSTRAINT payroll_templates_scope_check CHECK (scope IN ('company','org_unit')),
  CONSTRAINT payroll_templates_scope_pair_check CHECK ((scope = 'org_unit') = (org_unit_id IS NOT NULL)),
  CONSTRAINT payroll_templates_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE payroll_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON payroll_templates;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payroll_templates
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE payroll_templates
  ADD CONSTRAINT payroll_templates_org_unit_id_company_fk FOREIGN KEY (company_id, org_unit_id)
    REFERENCES org_units (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_templates_created_by_company_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT payroll_templates_updated_by_company_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT payroll_templates_deleted_by_company_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
CREATE UNIQUE INDEX payroll_templates_company_code_uq
  ON payroll_templates (company_id, code) WHERE deleted_at IS NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON payroll_templates TO mediaos_app;
--> statement-breakpoint

-- ─────────────── (5g) payroll_template_components (DB-13 §13.6) — ĐỨNG CUỐI ───────────────
-- 🔴 BẢNG PAYROLL DUY NHẤT CÓ GRANT DELETE — NGOẠI LỆ CÓ CHỦ ĐÍCH, phá quy tắc §4.3 "không bảng
--    PAYROLL nào có DELETE". Phải nói thẳng ở đây vì ratchet GRANT sẽ thấy một DELETE mới.
--    Lý do: PUT /payroll/templates/:id/components (API-053) ĐẶT LẠI toàn bộ danh sách trong MỘT
--    transaction; làm bằng soft delete thì unique partial phải mang deleted_at, và mỗi lần sắp xếp
--    lại cột sẽ tích luỹ hàng chết VÔ HẠN trên một bảng CẤU HÌNH THUẦN (0 dữ liệu tiền, 0 giá trị
--    lịch sử — lịch sử nằm ở component_values_json + template_fingerprint của dòng lương đã tính).
--    Vết đầy đủ của mọi lần sửa nằm ở audit_logs (object_type='payroll_template', payload kèm diff).
--    Hệ quả: KHÔNG cột soft-delete; KHÔNG vào RetentionService.PROTECTED_TABLES;
--    s15-payroll-db1-invariants.int-spec.ts khai nó trong DELETE_ALLOWED và assert HAI CHIỀU.
CREATE TABLE payroll_template_components (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL DEFAULT (NULLIF(current_setting('app.current_company_id', true), ''))::uuid
                     REFERENCES companies (id) ON DELETE CASCADE,
  template_id      uuid NOT NULL,
  component_id     uuid NOT NULL,
  column_label     text,
  formula_override text,
  is_visible       boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid,
  CONSTRAINT payroll_template_components_formula_len_check CHECK (
    formula_override IS NULL OR length(formula_override) <= 500),
  CONSTRAINT payroll_template_components_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE payroll_template_components ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_template_components FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON payroll_template_components;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payroll_template_components
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE payroll_template_components
  ADD CONSTRAINT payroll_template_components_template_id_company_fk FOREIGN KEY (company_id, template_id)
    REFERENCES payroll_templates (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_template_components_component_id_company_fk FOREIGN KEY (company_id, component_id)
    REFERENCES salary_components (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_template_components_created_by_company_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT payroll_template_components_updated_by_company_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by);
--> statement-breakpoint
CREATE UNIQUE INDEX payroll_template_components_tpl_component_uq
  ON payroll_template_components (company_id, template_id, component_id);
--> statement-breakpoint
CREATE INDEX payroll_template_components_company_tpl_idx
  ON payroll_template_components (company_id, template_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_template_components TO mediaos_app;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (6) BACKFILL EXPAND: salary_profiles.allowances → salary_profile_items (DB-13 §12.2 · §12.2.a)
--
-- EXPAND-CONTRACT: bước này TẠO + BACKFILL và **GIỮ NGUYÊN cột allowances** (đọc được, còn ghi được);
-- service ghi CẢ HAI cho tới khi CONTRACT (WO RIÊNG, chỉ sau khi đo 0 đường đọc còn lại).
--
-- Chạy SAU khối (5): RLS + FORCE + policy đã bật TRƯỚC hàng đầu tiên (BẤT BIẾN #1). Migration chạy qua
-- DATABASE_DIRECT_URL = role `mediaos` (SUPERUSER/BYPASSRLS) nên INSERT không bị chính policy vừa bật
-- chặn; nếu môi trường nào không phải vậy thì verify ở (7) sẽ ĐỎ chứ không im lặng bỏ hàng.
--
-- MÃ: component_code = 'PC_' || lpad(ordinality,3,'0') — tất định, THEO TỪNG HỒ SƠ, KHÔNG đụng không
-- gian tên catalog (DB-13 §12.2.a). Ordinal theo hồ sơ ⇒ thoả unique kể cả khi hai phụ cấp TRÙNG TÊN
-- (lối `component_code := name` thì trùng tên = 23505). `PC_` không nằm trong tiền tố cấm SYS_/TL_/GT_.
-- Tên gốc vào `note` ⇒ không mất thông tin người đọc.
-- ⚠️ Chỉ backfill hồ sơ CHƯA xoá mềm: hồ sơ đã xoá mềm không có đường đọc nào, và dữ liệu vẫn còn
--    nguyên trong cột `allowances` (expand chưa contract) nên KHÔNG mất gì.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- (6a) FAIL-LOUD hình dạng — bỏ qua im lặng = MẤT MỘT KHOẢN PHỤ CẤP CỦA MỘT NGƯỜI, không ai biết.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('profile=%s idx=%s elem=%s', sp.id, e.ord, e.elem::text), '; ')
    INTO v_bad
    FROM salary_profiles sp
    CROSS JOIN LATERAL jsonb_array_elements(sp.allowances) WITH ORDINALITY AS e(elem, ord)
   WHERE sp.deleted_at IS NULL
     AND (jsonb_typeof(e.elem) IS DISTINCT FROM 'object'
          OR e.elem ->> 'name' IS NULL
          OR e.elem ->> 'amount' IS NULL
          OR e.elem ->> 'amount' !~ '^-?[0-9]+(\.[0-9]+)?$');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '[0570] backfill DUNG: salary_profiles.allowances co phan tu SAI KHUON (thieu name/amount hoac amount khong parse duoc): %',
      v_bad;
  END IF;
END $$;
--> statement-breakpoint

-- (6b) FAIL-LOUD dấu — tách khỏi (6a) vì SQL KHÔNG hứa short-circuit của OR: cast ở (6a) có thể nổ
--      trước khi vế regex chạy. Tới đây mọi amount đã parse được nên cast an toàn.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('profile=%s idx=%s amount=%s', sp.id, e.ord, e.elem ->> 'amount'), '; ')
    INTO v_bad
    FROM salary_profiles sp
    CROSS JOIN LATERAL jsonb_array_elements(sp.allowances) WITH ORDINALITY AS e(elem, ord)
   WHERE sp.deleted_at IS NULL
     AND (e.elem ->> 'amount')::numeric < 0;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '[0570] backfill DUNG: allowances co amount AM (vi pham salary_profile_items_amount_check): %', v_bad;
  END IF;
END $$;
--> statement-breakpoint

-- (6c) EXPAND.
INSERT INTO salary_profile_items
  (company_id, salary_profile_id, component_code, amount, is_active, note, created_at, created_by)
SELECT sp.company_id,
       sp.id,
       'PC_' || lpad(e.ord::text, 3, '0'),
       (e.elem ->> 'amount')::numeric(18,2),
       true,
       e.elem ->> 'name',
       sp.created_at,
       sp.created_by
  FROM salary_profiles sp
  CROSS JOIN LATERAL jsonb_array_elements(sp.allowances) WITH ORDINALITY AS e(elem, ord)
 WHERE sp.deleted_at IS NULL;
--> statement-breakpoint

-- (6d) VERIFY backfill — PER-PROFILE, không phải tổng.
--
-- ⚠️ VÌ SAO KHÔNG ÉP LITERAL ĐÃ ĐO: plan-review B4a đúng ở chỗ "so hai vế TÍNH SỐNG là tautology trên
--    DB sạch (0 = 0)". Nhưng ép một literal cứng thì MỌI lane DB có dữ liệu khác số đo sẽ ĐỎ OAN — số
--    hàng lane là ngẫu nhiên theo fixture, không phải thuộc tính của bản vá. Thay bằng phép so MẠNH
--    HƠN: đẳng thức TỪNG HỒ SƠ. Nó bắt cả lỗi bỏ sót lẫn lỗi BÙ TRỪ (hồ sơ A thiếu 1, hồ sơ B thừa 1
--    — tổng vẫn khớp) mà phép so tổng không thấy. Tổng vẫn được RAISE NOTICE để dán vào PR (bằng
--    chứng của DoD), và lượt nghiệm thu trên lane CÓ dữ liệu v1 mới là chỗ cổng này thật sự chứng minh.
DO $$
DECLARE
  v_bad     text;
  v_src     bigint;
  v_dst     bigint;
  v_profile bigint;
BEGIN
  SELECT string_agg(format('profile=%s src=%s dst=%s', x.id, x.src, x.dst), '; ')
    INTO v_bad
    FROM (
      SELECT sp.id,
             jsonb_array_length(sp.allowances) AS src,
             (SELECT count(*) FROM salary_profile_items i
               WHERE i.company_id = sp.company_id AND i.salary_profile_id = sp.id
                 AND i.deleted_at IS NULL) AS dst
        FROM salary_profiles sp
       WHERE sp.deleted_at IS NULL
    ) x
   WHERE x.src <> x.dst;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0570] verify backfill: LECH so dong theo tung ho so: %', v_bad;
  END IF;

  SELECT count(*), COALESCE(sum(jsonb_array_length(allowances)), 0)
    INTO v_profile, v_src FROM salary_profiles WHERE deleted_at IS NULL;
  SELECT count(*) INTO v_dst FROM salary_profile_items;
  RAISE NOTICE '[0570] backfill DO DUOC: salary_profiles(active)=% allowance_items=% salary_profile_items=% — DAN SO NAY VAO PR',
    v_profile, v_src, v_dst;
END $$;
--> statement-breakpoint

-- ════════════════════════════════ (7) VERIFY FAIL-LOUD (khuôn 0549/0559/0564) ════════════════════
-- ⚠️ Khối này chạy bằng role migration (SUPERUSER/BYPASSRLS) ⇒ nó chứng minh policy TỒN TẠI, KHÔNG
--    chứng minh policy ĐÚNG. Chứng minh cô lập tenant thật nằm ở s15-payroll-db1-invariants.int-spec
--    (chạy bằng mediaos_app). Đừng đọc "VERIFY xanh" thành "bất biến #1 đã chứng minh".
DO $$
DECLARE
  v_new_tables CONSTANT text[] := ARRAY[
    'salary_profile_items', 'payroll_employee_settings', 'payroll_dependents',
    'salary_components', 'payroll_statutory_rates', 'payroll_templates',
    'payroll_template_components'];
  -- NGOẠI LỆ CÓ CHỦ ĐÍCH — xem khối (5g).
  v_delete_ok  CONSTANT text[] := ARRAY['payroll_template_components'];
  v_worker_ban CONSTANT text[] := ARRAY['salary_profile_items', 'payroll_employee_settings', 'payroll_dependents'];
  -- Đối chứng DƯƠNG: 0564 CỐ Ý GIỮ worker SELECT trên ba bảng này (thu hồi quá tay phải ĐỎ).
  v_worker_keep CONSTANT text[] := ARRAY['payroll_periods', 'bonus_penalties', 'payslip_acknowledgements'];
  t     text;
  v_n   integer;
  v_bad text;
BEGIN
  -- (7.1) RLS ENABLE + FORCE + policy tenant_isolation trên CẢ BẢY.
  FOREACH t IN ARRAY v_new_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '[0570] verify: % thieu RLS ENABLE hoac FORCE', t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation';
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0570] verify: % thieu policy tenant_isolation (dem duoc %)', t, v_n;
    END IF;
  END LOOP;

  -- (7.2) GRANT DELETE: 6/7 bảng phải 0; payroll_template_components PHẢI CÓ (assert HAI CHIỀU —
  --       thiếu vế thứ hai thì ai đó thu hồi DELETE và API-053 vỡ trong im lặng).
  FOREACH t IN ARRAY v_new_tables LOOP
    SELECT count(*) INTO v_n
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.relname = t AND a.privilege_type = 'DELETE' AND a.grantee = 'mediaos_app'::regrole;
    IF t = ANY (v_delete_ok) THEN
      IF v_n = 0 THEN
        RAISE EXCEPTION '[0570] verify: % MAT GRANT DELETE — API-053 (dat lai danh sach thanh phan) se vo', t;
      END IF;
    ELSIF v_n <> 0 THEN
      RAISE EXCEPTION '[0570] verify: % co GRANT DELETE cho app role — cam hard-delete du lieu luong', t;
    END IF;
  END LOOP;

  -- (7.3) mediaos_worker: 0 quyền trên CẢ BẢY bảng mới (fail-closed — quyền đọc lương không được trôi
  --       qua từng WO). Ba bảng PII của v_worker_ban là trọng tâm, nhưng ép cả 7 cho nhất quán.
  FOREACH t IN ARRAY v_new_tables LOOP
    SELECT count(*) INTO v_n
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.relname = t AND a.grantee = 'mediaos_worker'::regrole;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0570] verify: mediaos_worker co % quyen tren % — phai 0 (DB-13 §13.2 · P7)', v_n, t;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM unnest(v_worker_ban) x WHERE x <> ALL (v_new_tables)) <> 0 THEN
    RAISE EXCEPTION '[0570] verify: danh sach v_worker_ban lech khoi v_new_tables — sua mot cho, quen cho kia';
  END IF;

  -- (7.4) ĐỐI CHỨNG DƯƠNG: worker KHÔNG MẤT SELECT ở nơi 0564 cố ý giữ (thu hồi quá tay phải ĐỎ).
  FOREACH t IN ARRAY v_worker_keep LOOP
    SELECT count(*) INTO v_n
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.relname = t AND a.privilege_type = 'SELECT' AND a.grantee = 'mediaos_worker'::regrole;
    IF v_n = 0 THEN
      RAISE EXCEPTION '[0570] verify: mediaos_worker MAT SELECT tren % — thu hoi QUA TAY', t;
    END IF;
  END LOOP;

  -- (7.5) Tập quyền của mediaos_app so bằng aclexplode (không dùng has_table_privilege cấp bảng).
  SELECT string_agg(format('%s=[%s]', t2.relname, t2.privs), '; ') INTO v_bad
    FROM (
      SELECT c.relname, string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) AS privs
        FROM pg_class c, aclexplode(c.relacl) a
       WHERE c.relname = ANY (v_new_tables) AND a.grantee = 'mediaos_app'::regrole
       GROUP BY c.relname
    ) t2
   WHERE t2.privs <> CASE WHEN t2.relname = ANY (v_delete_ok)
                          THEN 'DELETE,INSERT,SELECT,UPDATE' ELSE 'INSERT,SELECT,UPDATE' END;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0570] verify: tap quyen mediaos_app LECH tren: %', v_bad;
  END IF;

  -- (7.5b) 0 GRANT CẤP CỘT trên cả 7 bảng. Khối (7.5) chỉ đọc pg_class.relacl; một column-GRANT đứng
  --        ngoài tầm nhìn đó và làm mọi kết luận "tập quyền khớp" thành SAI (khuôn 0564 khối 2a —
  --        revoke-table-grant-wipes-column-grants).
  SELECT string_agg(format('%s.%s=%s', t2.relname, a2.attname, x.privilege_type), '; ') INTO v_bad
    FROM pg_attribute a2
    JOIN pg_class t2 ON t2.oid = a2.attrelid
    CROSS JOIN LATERAL aclexplode(a2.attacl) x
   WHERE t2.relname = ANY (v_new_tables) AND a2.attnum > 0 AND NOT a2.attisdropped;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0570] verify: co GRANT CAP COT tren bang moi (khong ai cap o migration nay): %', v_bad;
  END IF;

  -- (7.6) company_id NOT NULL + UNIQUE (company_id, id) trên cả 7 — nullable thì composite FK chỉ bịt
  --       MỘT NỬA và xtenant-fk-ratchet (lớp P <= 24) sẽ ĐỎ.
  FOREACH t IN ARRAY v_new_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = t AND column_name = 'company_id' AND is_nullable = 'NO') THEN
      RAISE EXCEPTION '[0570] verify: %.company_id KHONG phai NOT NULL', t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_constraint
     WHERE conname = t || '_company_id_id_uq' AND contype = 'u';
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0570] verify: % thieu UNIQUE (company_id, id) (dem duoc %)', t, v_n;
    END IF;
  END LOOP;

  -- (7.7) Composite tenant-FK: đếm ĐÚNG BẰNG danh sách khai ở khối (5).
  --       4+4+4+3+3+4+4 = 26 FK >= 2 cột trên 7 bảng mới.
  SELECT count(*) INTO v_n
    FROM pg_constraint c JOIN pg_class t2 ON t2.oid = c.conrelid
   WHERE t2.relname = ANY (v_new_tables) AND c.contype = 'f' AND array_length(c.conkey, 1) >= 2;
  IF v_n <> 26 THEN
    RAISE EXCEPTION '[0570] verify: co % composite FK tren 7 bang moi, ky vong dung 26', v_n;
  END IF;
  -- 0 FK MỘT CỘT ngoài company_id → companies (composite THUẦN — điều kiện để census FK không cộng thêm).
  SELECT string_agg(format('%s.%s', t2.relname, c.conname), '; ') INTO v_bad
    FROM pg_constraint c
    JOIN pg_class t2 ON t2.oid = c.conrelid
    JOIN pg_class rt ON rt.oid = c.confrelid
   WHERE t2.relname = ANY (v_new_tables) AND c.contype = 'f'
     AND array_length(c.conkey, 1) = 1 AND rt.relname <> 'companies';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0570] verify: con FK MOT COT toi bang khac companies: %', v_bad;
  END IF;

  -- (7.8) btree_gist + EXCLUDE của payroll_dependents.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RAISE EXCEPTION '[0570] verify: thieu extension btree_gist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'payroll_dependents_no_overlap_excl' AND contype = 'x') THEN
    RAISE EXCEPTION '[0570] verify: thieu EXCLUDE payroll_dependents_no_overlap_excl (ERR-032 se thanh ma chet)';
  END IF;

  -- (7.9) 8 cột ALTER tồn tại + 7 CHECK mới tồn tại ĐÚNG TÊN.
  SELECT string_agg(x.col, ', ') INTO v_bad
    FROM unnest(ARRAY['salary_type','pit_payer','insurance_salary','probation_salary','pay_ratio_pct']) AS x(col)
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'salary_profiles' AND column_name = x.col);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0570] verify: salary_profiles thieu cot v2: %', v_bad;
  END IF;
  SELECT string_agg(x.col, ', ') INTO v_bad
    FROM unnest(ARRAY['component_values_json','template_fingerprint','gross_up_iterations']) AS x(col)
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'payroll_period_lines' AND column_name = x.col);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0570] verify: payroll_period_lines thieu cot v2: %', v_bad;
  END IF;
  SELECT string_agg(x.cn, ', ') INTO v_bad
    FROM unnest(ARRAY[
      'salary_profiles_salary_type_check','salary_profiles_pit_payer_check',
      'salary_profiles_insurance_salary_check','salary_profiles_probation_salary_check',
      'salary_profiles_pay_ratio_check','payroll_period_lines_grossup_check',
      'payroll_period_lines_fingerprint_check','salary_components_code_shape_check',
      'salary_components_value_pair_check','salary_components_system_not_deletable',
      'salary_components_engine_kind_check','payroll_templates_scope_pair_check',
      'payroll_employee_settings_bank_pair_check','payroll_statutory_rates_brackets_check']) AS x(cn)
   WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = x.cn AND contype = 'c');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0570] verify: thieu CHECK: %', v_bad;
  END IF;

  -- (7.10) EXPAND chưa CONTRACT: cột allowances PHẢI CÒN. Mất cột = ai đó đã contract sớm.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'salary_profiles' AND column_name = 'allowances') THEN
    RAISE EXCEPTION '[0570] verify: salary_profiles.allowances DA BIEN MAT — CONTRACT la WO RIENG, khong phai buoc nay';
  END IF;

  RAISE NOTICE '[0570] VERIFY XANH: 7 bang moi + 8 cot ALTER + backfill per-profile khop.';
END $$;
