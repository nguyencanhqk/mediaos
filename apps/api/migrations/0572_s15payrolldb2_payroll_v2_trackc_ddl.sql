-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0572 — S15-PAYROLL-DB-2 · bước C: ALTER payroll_periods (lượt 3) + 4 bảng track C + 3 trigger chốt cuối
-- Nguồn: DB-13 §12.3 · §14.1–§14.4 · §15.3 bước C · SPEC-11 §12.1 · §13.1 · §13.2
-- Plan + biên bản cổng: docs/plans/S15-PAYROLL-DB-2.md (§3.5.a = vá plan-review vòng 1)
--
-- ── SỐ ĐO bước 0 (14/09/2026) ──────────────────────────────────────────────────────────────────
--   • _journal.json head = idx 238 / 0571_s15payrolldb1_seed_perms_audit ⇒ file này idx 239.
--   • PROD: v1 chưa lên PROD (0570:15) ⇒ kỳ vọng 0 hàng Paid/Locked. Agent KHÔNG đo được PROD ⇒ khối (2)
--     tự đếm và verify khớp; RAISE NOTICE của (2) là số dán vào PR / RELEASE.
--   • DB dev `mediaos` = 0 hàng payroll_periods. Tập trigger non-internal trên payroll_periods = ∅
--     (0564 DROP payroll_period_status_guard).
--   • 8 cặp quyền track C + grant đã seed ở 0571 ⇒ file này KHÔNG seed quyền, chỉ GUARD (khối 1).
--
-- ── QUYẾT ĐỊNH OWNER (14/09/2026) ──────────────────────────────────────────────────────────────
--   O-1 lối A: kỳ v1 `Locked` được gán paid_by/paid_at := published_by/published_at (DB-13 §12.3 bỏ sót
--       `Locked` × paid_pair_check ⇒ 23514 trên mọi DB có kỳ đã khoá). DẤU HÀNG DI SẢN máy đọc được:
--       `paid_at = published_at AND paid_by = published_by` — BE-4/FE-3 dựa vào đó để không hiện kỳ di sản
--       «đã chi» cho người không có dòng chi.
--   O-2 deploy bình thường. ⚠️ CẤM rollback artifact BE về trước mốc này khi chưa có migration đảo: BE cũ
--       ghi 'Paid' không kèm paid_by ⇒ 500, và lọc {Paid,Locked} ⇒ /me/payslips `200 []`.
--
-- ⚠️ set_config('lock_timeout','5s',true) ở khối (2) sống tới HẾT transaction của migrator (phủ cả 0573).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) GUARD tiền đề — fail-loud TRƯỚC mọi DDL ───────────────
DO $$
DECLARE
  v_n   integer;
  v_bad text;
  t     text;
BEGIN
  -- (1a) Role migration phải vượt RLS — CHECK/ALTER cần quét TOÀN BẢNG, kể cả hàng mọi tenant.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION '[0572] DUNG: current_user=% khong SUPERUSER/BYPASSRLS — backfill se chi thay hang cua mot tenant', current_user;
  END IF;

  -- (1b) Bảng tồn tại + ĐÍCH của composite tenant-FK có UNIQUE (company_id, id) (khuôn 0570:44–58).
  FOREACH t IN ARRAY ARRAY['users', 'org_units', 'payroll_periods', 'payroll_templates', 'payslips'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION '[0572] DUNG: bang % khong ton tai', t;
    END IF;
    v_n := NULL;
    SELECT count(*) INTO v_n
      FROM pg_constraint c
      JOIN pg_class tb ON tb.oid = c.conrelid
      JOIN LATERAL unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = tb.oid AND a.attnum = k.attnum
     WHERE tb.relname = t AND c.contype = 'u' AND array_length(c.conkey, 1) = 2
       AND a.attname IN ('company_id', 'id')
     GROUP BY c.oid
     HAVING count(*) = 2
     LIMIT 1;
    IF COALESCE(v_n, 0) <> 2 THEN
      RAISE EXCEPTION '[0572] DUNG: % thieu UNIQUE (company_id, id) — composite tenant-FK khong tao duoc', t;
    END IF;
  END LOOP;

  -- (1c) Chống chạy nửa vời: 3 cột mới CHƯA có, status_check CHƯA có 'Published', 4 bảng CHƯA có.
  SELECT string_agg(column_name, ', ') INTO v_bad
    FROM information_schema.columns
   WHERE table_name = 'payroll_periods' AND column_name IN ('template_id', 'paid_by', 'paid_at');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0572] DUNG: payroll_periods DA CO cot v2 (%) — migration da chay nua voi', v_bad;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'payroll_periods_status_check'
                AND pg_get_constraintdef(oid) LIKE '%Published%') THEN
    RAISE EXCEPTION '[0572] DUNG: payroll_periods_status_check DA CO Published — migration da chay nua voi';
  END IF;
  FOREACH t IN ARRAY ARRAY['payroll_advances', 'payroll_payment_batches', 'payroll_payment_lines', 'payroll_budgets'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      RAISE EXCEPTION '[0572] DUNG: bang % DA TON TAI — migration da chay nua voi', t;
    END IF;
  END LOOP;

  -- (1d) Backfill UPDATE không được bắn trigger lạ (0564 đã DROP trigger FSM cũ).
  SELECT string_agg(tgname, ', ') INTO v_bad
    FROM pg_trigger WHERE tgrelid = 'payroll_periods'::regclass AND NOT tgisinternal;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0572] DUNG: payroll_periods co trigger ngoai du kien (%) — xet lai backfill truoc khi chay', v_bad;
  END IF;

  -- (1e) 8 cặp track C (0571) tồn tại + is_sensitive; grant trên role HỆ THỐNG = SET-EQUALITY 14 bộ.
  SELECT count(*) INTO v_n FROM permissions
   WHERE is_sensitive = true AND (action, resource_type) IN (
         ('view','payroll-advance'), ('manage','payroll-advance'), ('approve','payroll-advance'),
         ('view-own','payroll-advance'), ('view','payment-batch'), ('manage','payment-batch'),
         ('view','payroll-budget'), ('manage','payroll-budget'));
  IF v_n <> 8 THEN
    RAISE EXCEPTION '[0572] DUNG: chi co % / 8 cap quyen track C sensitive — 0571 chua chay?', v_n;
  END IF;
  WITH expected(role_name, action, resource_type) AS (VALUES
         ('employee',        'view-own', 'payroll-advance'),
         ('payroll-officer', 'view',     'payroll-advance'),
         ('payroll-officer', 'manage',   'payroll-advance'),
         ('payroll-officer', 'approve',  'payroll-advance'),
         ('payroll-officer', 'view',     'payment-batch'),
         ('payroll-officer', 'manage',   'payment-batch'),
         ('payroll-officer', 'view',     'payroll-budget'),
         ('company-admin',   'view',     'payroll-advance'),
         ('company-admin',   'manage',   'payroll-advance'),
         ('company-admin',   'approve',  'payroll-advance'),
         ('company-admin',   'view',     'payment-batch'),
         ('company-admin',   'manage',   'payment-batch'),
         ('company-admin',   'view',     'payroll-budget'),
         ('company-admin',   'manage',   'payroll-budget')),
       actual AS (
         SELECT DISTINCT r.name AS role_name, p.action, p.resource_type
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id AND r.company_id IS NULL AND r.deleted_at IS NULL
           JOIN permissions p ON p.id = rp.permission_id
          WHERE p.resource_type IN ('payroll-advance', 'payment-batch', 'payroll-budget')
            AND r.name IN ('employee', 'manager', 'hr', 'hr-manager', 'payroll-officer', 'company-admin'))
  SELECT string_agg(x.d, '; ') INTO v_bad FROM (
    SELECT 'THIEU ' || role_name || ':' || action || ':' || resource_type AS d
      FROM (SELECT * FROM expected EXCEPT SELECT * FROM actual) m
    UNION ALL
    SELECT 'THUA ' || role_name || ':' || action || ':' || resource_type
      FROM (SELECT * FROM actual EXCEPT SELECT * FROM expected) e) x;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0572] DUNG: grant track C tren role he thong lech ma tran SPEC-11 §11.3: %', v_bad;
  END IF;
END $$;
--> statement-breakpoint

-- ════════════════ (2) ALTER payroll_periods — MỘT khối, NGUYÊN TỬ (DB-13 §12.3 + plan §3.2/§3.3) ════════════════
-- Thứ tự BẮT BUỘC: thêm cột → nới status_check → di trú nghĩa 'Paid'→'Published' → gán vết kỳ Locked di sản
-- → RỒI MỚI siết 4 CHECK cặp. Đảo bất kỳ bước nào = 23514 trên DB có dữ liệu, xanh trên CI rỗng.
-- ⚠️ Đếm KHÔNG lọc deleted_at: CHECK soi MỌI hàng, kể cả hàng xoá mềm.
-- ⚠️ KHÔNG đụng updated_at/updated_by: đây là di trú NGHĨA, không phải thao tác của người dùng.
DO $$
DECLARE
  v_paid       integer;
  v_paid_del   integer;
  v_locked     integer;
  v_locked_del integer;
  v_n          integer;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- (2a) 3 cột mới, NULL. template_id KHÔNG NOT NULL: kỳ v1 không có mẫu; «phải có mẫu mới calculate» sống
  --      ở service (409 ERR-023 template-missing) — CHECK không biểu diễn được điều phụ thuộc hành động.
  ALTER TABLE payroll_periods ADD COLUMN template_id uuid;
  ALTER TABLE payroll_periods ADD COLUMN paid_by     uuid;
  ALTER TABLE payroll_periods ADD COLUMN paid_at     timestamptz;

  -- (2b) composite tenant-FK. paid_by mirror locked_by (0564:229): SET NULL (col).
  ALTER TABLE payroll_periods
    ADD CONSTRAINT payroll_periods_template_id_company_fk FOREIGN KEY (company_id, template_id)
      REFERENCES payroll_templates (company_id, id) ON DELETE NO ACTION,
    ADD CONSTRAINT payroll_periods_paid_by_company_fk FOREIGN KEY (company_id, paid_by)
      REFERENCES users (company_id, id) ON DELETE SET NULL (paid_by);

  -- (2c) ĐO trước di trú.
  SELECT count(*), count(*) FILTER (WHERE deleted_at IS NOT NULL)
    INTO v_paid, v_paid_del FROM payroll_periods WHERE status = 'Paid';
  SELECT count(*), count(*) FILTER (WHERE deleted_at IS NOT NULL)
    INTO v_locked, v_locked_del FROM payroll_periods WHERE status = 'Locked';
  SELECT count(*) INTO v_n FROM payroll_periods
   WHERE status = 'Locked' AND (published_by IS NULL OR published_at IS NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0572] DUNG: % ky Locked thieu published_by/at — loi A (O-1) khong ap duoc, owner phai chot lai', v_n;
  END IF;

  -- (2d) NỚI status_check lên 8 giá trị TRƯỚC khi có hàng nào mang 'Published'.
  ALTER TABLE payroll_periods DROP CONSTRAINT payroll_periods_status_check;
  ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_status_check
    CHECK (status IN ('Draft','CollectingData','Calculated','Reviewing','Approved','Published','Paid','Locked'));

  -- (2e) DI TRÚ NGHĨA: 'Paid' của v1 = «đã phát hành phiếu» = 'Published' của v2.
  UPDATE payroll_periods SET status = 'Published' WHERE status = 'Paid';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_paid THEN
    RAISE EXCEPTION '[0572] backfill Paid->Published cap nhat % hang, do truoc duoc %', v_n, v_paid;
  END IF;

  -- (2f) O-1 lối A: kỳ Locked di sản mang vết chi trả = vết phát hành (dấu hàng di sản, xem đầu file).
  UPDATE payroll_periods SET paid_by = published_by, paid_at = published_at
   WHERE status = 'Locked' AND paid_by IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_locked THEN
    RAISE EXCEPTION '[0572] gan vet paid cho ky Locked cap nhat % hang, do truoc duoc %', v_n, v_locked;
  END IF;

  -- (2g) RỒI MỚI siết 4 CHECK cặp. `Published` vào vế trái của submitted/approved/published (plan §3.2 —
  --      DB-13 §12.3 bỏ sót submitted_pair ⇒ kỳ Published thiếu submitted_* lọt DB). `Locked` nằm trong vế
  --      trái của MỌI CHECK cặp (nullable-escape-clause-makes-check-vacuous).
  ALTER TABLE payroll_periods DROP CONSTRAINT payroll_periods_submitted_pair_check;
  ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_submitted_pair_check
    CHECK (status NOT IN ('Reviewing','Approved','Published','Paid','Locked')
           OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL));
  ALTER TABLE payroll_periods DROP CONSTRAINT payroll_periods_approved_pair_check;
  ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_approved_pair_check
    CHECK (status NOT IN ('Approved','Published','Paid','Locked')
           OR (approved_by IS NOT NULL AND approved_at IS NOT NULL));
  ALTER TABLE payroll_periods DROP CONSTRAINT payroll_periods_published_pair_check;
  ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_published_pair_check
    CHECK (status NOT IN ('Published','Paid','Locked')
           OR (published_by IS NOT NULL AND published_at IS NOT NULL
               AND approved_by IS NOT NULL AND approved_at IS NOT NULL));
  ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_paid_pair_check
    CHECK (status NOT IN ('Paid','Locked') OR (paid_by IS NOT NULL AND paid_at IS NOT NULL));

  -- (2h) Hậu di trú.
  SELECT count(*) INTO v_n FROM payroll_periods WHERE status = 'Paid';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0572] hau di tru: con % ky Paid — v2 chi vao Paid qua hoan tat dot chi tra', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM payroll_periods
   WHERE status IN ('Paid', 'Locked') AND (paid_by IS NULL OR paid_at IS NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0572] hau di tru: % ky Paid/Locked thieu vet paid', v_n;
  END IF;

  RAISE NOTICE '[0572] DO DUOC: Paid->Published=% (xoa mem %) · Locked gan vet paid=% (xoa mem %) — DAN SO NAY VAO PR',
    v_paid, v_paid_del, v_locked, v_locked_del;
END $$;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (3) BỐN BẢNG MỚI (DB-13 §14.1–§14.4 + plan §3.6)
-- THỨ TỰ per-bảng (khuôn 0570 khối 5): CREATE TABLE (CHECK + UNIQUE (company_id,id)) → ENABLE RLS → FORCE RLS
--   → POLICY → composite FK → index → GRANT. RLS + FORCE + policy TRƯỚC mọi INSERT (BẤT BIẾN #1).
-- KHÔNG GRANT DELETE cho bảng nào (gỡ = xoá mềm). mediaos_worker 0 quyền (tiền per-người).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (3a) payroll_advances — tạm ứng (DB-13 §14.1) ───────────────
CREATE TABLE payroll_advances (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL DEFAULT (NULLIF(current_setting('app.current_company_id', true), ''))::uuid
                        REFERENCES companies (id) ON DELETE CASCADE,
  user_id             uuid NOT NULL,
  amount              numeric(18,2) NOT NULL,
  deduct_period_month text NOT NULL,
  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'Pending',
  decided_by          uuid,
  decided_at          timestamptz,
  decision_note       text,
  payroll_period_id   uuid,
  consumed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,
  deleted_at          timestamptz,
  deleted_by          uuid,
  CONSTRAINT payroll_advances_status_check CHECK (status IN ('Pending','Approved','Rejected','Deducted')),
  CONSTRAINT payroll_advances_amount_check CHECK (amount > 0),
  CONSTRAINT payroll_advances_month_check CHECK (deduct_period_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT payroll_advances_decided_pair_check CHECK (
    status = 'Pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT payroll_advances_reject_note_check CHECK (status <> 'Rejected' OR decision_note IS NOT NULL),
  -- Khoá chống khấu trừ hai lần (khuôn bonus_penalties) — hai chiều với trạng thái:
  CONSTRAINT payroll_advances_consumed_pair_check CHECK ((payroll_period_id IS NULL) = (consumed_at IS NULL)),
  CONSTRAINT payroll_advances_consume_status_check CHECK (payroll_period_id IS NULL OR status = 'Deducted'),
  -- plan §3.6: thiếu chiều này thì hàng `Deducted` không trỏ kỳ nào = khoản tạm ứng «đã trừ» vào hư không.
  CONSTRAINT payroll_advances_deducted_bound_check CHECK (status <> 'Deducted' OR payroll_period_id IS NOT NULL),
  -- plan §3.6: chốt cuối tự duyệt (race hai request). Vế `created_by IS NULL` là lối thoát khi user bị xoá CỨNG
  -- (FK SET NULL) — T3 `insert-shape` bắt buộc created_by lúc INSERT và khoá nó mãi mãi (R6).
  CONSTRAINT payroll_advances_four_eyes_check CHECK (
    decided_by IS NULL OR created_by IS NULL OR decided_by <> created_by),
  CONSTRAINT payroll_advances_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE payroll_advances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_advances FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON payroll_advances;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payroll_advances
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE payroll_advances
  ADD CONSTRAINT payroll_advances_user_id_company_fk FOREIGN KEY (company_id, user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_advances_payroll_period_id_company_fk FOREIGN KEY (company_id, payroll_period_id)
    REFERENCES payroll_periods (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_advances_decided_by_company_fk FOREIGN KEY (company_id, decided_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (decided_by),
  ADD CONSTRAINT payroll_advances_created_by_company_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT payroll_advances_updated_by_company_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT payroll_advances_deleted_by_company_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
CREATE INDEX payroll_advances_company_user_month_idx
  ON payroll_advances (company_id, user_id, deduct_period_month) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX payroll_advances_company_status_idx
  ON payroll_advances (company_id, status) WHERE deleted_at IS NULL;
--> statement-breakpoint
-- plan §3.6: «nhả consume của CHÍNH kỳ đó» (UPDATE … WHERE payroll_period_id = $1) dưới row-lock kỳ.
CREATE INDEX payroll_advances_company_period_idx
  ON payroll_advances (company_id, payroll_period_id) WHERE payroll_period_id IS NOT NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON payroll_advances TO mediaos_app;
--> statement-breakpoint

-- ─────────────── (3b) payroll_payment_batches — đợt chi trả (DB-13 §14.2) ───────────────
CREATE TABLE payroll_payment_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL DEFAULT (NULLIF(current_setting('app.current_company_id', true), ''))::uuid
                      REFERENCES companies (id) ON DELETE CASCADE,
  payroll_period_id uuid NOT NULL,
  code              text NOT NULL,
  method            text NOT NULL,
  status            text NOT NULL DEFAULT 'Draft',
  pay_date          date,
  completed_by      uuid,
  completed_at      timestamptz,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  deleted_at        timestamptz,
  deleted_by        uuid,
  CONSTRAINT payroll_payment_batches_method_check CHECK (method IN ('bank','cash')),
  CONSTRAINT payroll_payment_batches_status_check CHECK (status IN ('Draft','Ready','Completed')),
  CONSTRAINT payroll_payment_batches_completed_pair_check CHECK (
    status <> 'Completed' OR (completed_by IS NOT NULL AND completed_at IS NOT NULL)),
  CONSTRAINT payroll_payment_batches_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE payroll_payment_batches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_payment_batches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON payroll_payment_batches;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payroll_payment_batches
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE payroll_payment_batches
  ADD CONSTRAINT payroll_payment_batches_payroll_period_id_company_fk FOREIGN KEY (company_id, payroll_period_id)
    REFERENCES payroll_periods (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_payment_batches_completed_by_company_fk FOREIGN KEY (company_id, completed_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (completed_by),
  ADD CONSTRAINT payroll_payment_batches_created_by_company_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT payroll_payment_batches_updated_by_company_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT payroll_payment_batches_deleted_by_company_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
CREATE UNIQUE INDEX payroll_payment_batches_company_code_uq
  ON payroll_payment_batches (company_id, code) WHERE deleted_at IS NULL;
--> statement-breakpoint
-- ⚠️ NON-UNIQUE CÓ CHỦ ĐÍCH: một kỳ nhiều đợt (bank + cash, chia theo đơn vị). «Sửa» thành unique là giết
--    kỳ nhiều đợt; Paid của kỳ bám LUẬT PHỦ ở service (SPEC-11 §13.1). VERIFY (5.8) ghim chiều ngược.
CREATE INDEX payroll_payment_batches_company_period_idx
  ON payroll_payment_batches (company_id, payroll_period_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON payroll_payment_batches TO mediaos_app;
--> statement-breakpoint

-- ─────────────── (3c) payroll_payment_lines — dòng chi trả per nhân sự (DB-13 §14.3) ───────────────
-- KHÔNG lưu số tiền (đọc từ payslip_id). Số TK thì NGƯỢC LẠI — ĐÓNG BĂNG lúc lập đợt (UNC giải thích được
-- bằng số lúc gửi ngân hàng). Gỡ dòng lúc Draft = XOÁ MỀM ⇒ cả ba index partial WHERE deleted_at IS NULL.
CREATE TABLE payroll_payment_lines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL DEFAULT (NULLIF(current_setting('app.current_company_id', true), ''))::uuid
                            REFERENCES companies (id) ON DELETE CASCADE,
  batch_id                uuid NOT NULL,
  user_id                 uuid NOT NULL,
  payslip_id              uuid NOT NULL,
  bank_account_snapshot   text,
  bank_name_snapshot      text,
  account_holder_snapshot text,
  paid_at                 timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid,
  deleted_at              timestamptz,
  deleted_by              uuid,
  -- plan §3.6: mirror payroll_employee_settings_bank_pair_check — dòng UNC không tên chủ TK không gửi được.
  CONSTRAINT payroll_payment_lines_bank_pair_check CHECK (
    bank_account_snapshot IS NULL OR (bank_name_snapshot IS NOT NULL AND account_holder_snapshot IS NOT NULL)),
  CONSTRAINT payroll_payment_lines_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE payroll_payment_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_payment_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON payroll_payment_lines;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payroll_payment_lines
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE payroll_payment_lines
  ADD CONSTRAINT payroll_payment_lines_batch_id_company_fk FOREIGN KEY (company_id, batch_id)
    REFERENCES payroll_payment_batches (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_payment_lines_user_id_company_fk FOREIGN KEY (company_id, user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_payment_lines_payslip_id_company_fk FOREIGN KEY (company_id, payslip_id)
    REFERENCES payslips (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_payment_lines_created_by_company_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT payroll_payment_lines_updated_by_company_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT payroll_payment_lines_deleted_by_company_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
CREATE UNIQUE INDEX payroll_payment_lines_batch_user_uq
  ON payroll_payment_lines (company_id, batch_id, user_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX payroll_payment_lines_company_batch_idx
  ON payroll_payment_lines (company_id, batch_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
-- 🔴 CHỐT CUỐI CHỐNG TRẢ HAI LẦN: một phiếu nằm trong ĐÚNG MỘT dòng chi của TOÀN công ty. Service map 23505
--    theo TÊN này (KHÔNG phải batch_user_uq — hai đợt khác nhau không vi phạm batch_user_uq) ⇒ 409 ERR-027.
CREATE UNIQUE INDEX payroll_payment_lines_payslip_uq
  ON payroll_payment_lines (company_id, payslip_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON payroll_payment_lines TO mediaos_app;
--> statement-breakpoint

-- ─────────────── (3d) payroll_budgets — ngân sách lương năm × đơn vị (DB-13 §14.4) ───────────────
CREATE TABLE payroll_budgets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL DEFAULT (NULLIF(current_setting('app.current_company_id', true), ''))::uuid
                   REFERENCES companies (id) ON DELETE CASCADE,
  fiscal_year    integer NOT NULL,
  org_unit_id    uuid,
  planned_amount numeric(18,2) NOT NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  deleted_at     timestamptz,
  deleted_by     uuid,
  CONSTRAINT payroll_budgets_year_check CHECK (fiscal_year BETWEEN 2000 AND 2100),
  CONSTRAINT payroll_budgets_amount_check CHECK (planned_amount >= 0),
  CONSTRAINT payroll_budgets_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE payroll_budgets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_budgets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON payroll_budgets;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payroll_budgets
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE payroll_budgets
  ADD CONSTRAINT payroll_budgets_org_unit_id_company_fk FOREIGN KEY (company_id, org_unit_id)
    REFERENCES org_units (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_budgets_created_by_company_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT payroll_budgets_updated_by_company_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT payroll_budgets_deleted_by_company_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
-- ⚠️ org_unit_id NULLABLE ⇒ unique thường KHÔNG chặn hai hàng «toàn công ty» (NULL <> NULL). COALESCE về
--    sentinel toàn-0; thiếu nó thì ERR-029 thành mã chết.
CREATE UNIQUE INDEX payroll_budgets_year_unit_uq
  ON payroll_budgets (company_id, fiscal_year, COALESCE(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE deleted_at IS NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON payroll_budgets TO mediaos_app;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (4) BA TRIGGER CHỐT CUỐI (plan §3.5 + §3.5.a — vá plan-review B1/B2/M1/M2/M3)
-- Mọi trigger: ERRCODE check_violation; message = '<trigger>:<tag>: <chi tiết>' với tag thuộc danh sách ĐÓNG
-- (SPEC-11 §12.1 map theo TAG). Lookup luôn lọc company_id + IF NOT FOUND ⇒ RAISE (fail-closed); cột nullable
-- so bằng IS DISTINCT FROM. Trigger HẸP — không đóng băng cả bảng (frozen-table-triggers-break-db-init).
-- KHÔNG ép đồ thị FSM đầy đủ (việc của service) — chỉ ép bất biến cần OLD/NEW mà CHECK không diễn đạt được.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (4a) T1 payroll_payment_batch_freeze ───────────────
-- B1: payroll_period_id BẤT BIẾN ở MỌI trạng thái — đổi kỳ của một đợt Draft đã có dòng phiếu kỳ P1 sang P2
--     làm luật PHỦ tính dòng P1 cho P2 (kỳ P2 bị ghi Paid sai), và T2 không bắn vì câu UPDATE ở bảng đợt.
-- Completed là TERMINAL: khoá status + vết hoàn tất + xoá mềm. Thiếu khoá status thì `SET status='Draft'` gỡ
-- băng toàn bộ T2 trong một câu (check-cannot-enforce-fsm-transitions). `note` vẫn sửa được.
CREATE OR REPLACE FUNCTION enforce_payroll_payment_batch_freeze()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'Completed' THEN
      RAISE EXCEPTION 'payroll_payment_batch_freeze:insert-completed: dot % khong duoc sinh o trang thai Completed (hoan tat chi qua API-072)',
        NEW.code
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.payroll_period_id IS DISTINCT FROM OLD.payroll_period_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'payroll_payment_batch_freeze:period-immutable: dot % (id=%) khong doi ky/cong ty sau khi tao',
      OLD.code, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'Completed' AND (
       NEW.status       IS DISTINCT FROM OLD.status
    OR NEW.method       IS DISTINCT FROM OLD.method
    OR NEW.code         IS DISTINCT FROM OLD.code
    OR NEW.pay_date     IS DISTINCT FROM OLD.pay_date
    OR NEW.completed_by IS DISTINCT FROM OLD.completed_by
    OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
    OR NEW.deleted_at   IS DISTINCT FROM OLD.deleted_at
    OR NEW.deleted_by   IS DISTINCT FROM OLD.deleted_by
  ) THEN
    RAISE EXCEPTION 'payroll_payment_batch_freeze:frozen: dot % (id=%) da Completed — chi sua duoc note',
      OLD.code, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- FULL gate database-reviewer H1: xoá mềm đợt còn dòng SỐNG ⇒ các dòng đó giữ slot
  -- payroll_payment_lines_payslip_uq dưới một đợt «đã biến mất» ⇒ phiếu bị khoá VĨNH VIỄN khỏi mọi đợt hợp lệ
  -- khác, không lỗi nào bắn (fail-open). Gỡ dòng TRƯỚC, xoá đợt SAU. EXISTS chạy sau khi UPDATE đã giữ khoá
  -- hàng đợt ⇒ xếp hàng với FOR SHARE của T2 (INSERT dòng song song không lọt).
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM payroll_payment_lines l
                  WHERE l.batch_id = OLD.id AND l.company_id = OLD.company_id AND l.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'payroll_payment_batch_freeze:has-active-lines: dot % (id=%) con dong chi song — go dong truoc khi xoa dot',
      OLD.code, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payroll_payment_batch_freeze
  BEFORE INSERT OR UPDATE ON payroll_payment_batches
  FOR EACH ROW EXECUTE FUNCTION enforce_payroll_payment_batch_freeze();
--> statement-breakpoint

-- ─────────────── (4b) T2 payroll_payment_line_guard ───────────────
-- (i) đóng băng dòng của đợt Completed (kể cả deleted_at — thiếu vế đó là gỡ một người khỏi bảng chi SAU KHI chi)
-- (ii) chặn INSERT vào đợt Completed (đường «gỡ mềm rồi thêm lại» mà unique partial không chặn)
-- (iii) chặn chuyển dòng RA KHỎI hoặc SANG đợt Completed
-- (iv) nhất quán chéo: phiếu CÙNG user với dòng + CÙNG kỳ với đợt (không trả phiếu của X cho Y; phiếu kỳ P2
--      không «phủ» luật PHỦ của kỳ P1). Kỳ của đợt bất biến nhờ T1, kỳ/user của phiếu bất biến (append-only).
-- (v) đọc đợt bằng FOR SHARE — xếp hàng với FOR UPDATE của 072, chặn race «sửa dòng trong lúc đang hoàn tất».
--     Cần quyền UPDATE trên bảng đợt (mediaos_app có). Chi phí: 2 lookup/dòng (067 lập đợt lớn = O(N) câu).
CREATE OR REPLACE FUNCTION enforce_payroll_payment_line_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_status text;
  v_new_period uuid;
  v_old_status text;
  v_ps_user    uuid;
  v_ps_period  uuid;
BEGIN
  -- `deleted_at IS NULL` (FULL gate database-reviewer H1): đợt đã xoá mềm = không tồn tại với dòng chi —
  -- ghi dòng vào nó sẽ giữ slot payslip_uq dưới một đợt «đã biến mất».
  SELECT b.status, b.payroll_period_id INTO v_new_status, v_new_period
    FROM payroll_payment_batches b
   WHERE b.id = NEW.batch_id AND b.company_id = NEW.company_id AND b.deleted_at IS NULL
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payroll_payment_line_guard:not-found: dot % khong ton tai trong cong ty cua dong', NEW.batch_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_new_status = 'Completed' THEN
      RAISE EXCEPTION 'payroll_payment_line_guard:insert-into-completed: dot % da Completed — khong them dong', NEW.batch_id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'payroll_payment_line_guard:frozen: dong % khong doi cong ty', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
      SELECT b.status INTO v_old_status
        FROM payroll_payment_batches b
       WHERE b.id = OLD.batch_id AND b.company_id = OLD.company_id
         FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'payroll_payment_line_guard:not-found: dot cu % khong ton tai', OLD.batch_id
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_old_status = 'Completed' THEN
        RAISE EXCEPTION 'payroll_payment_line_guard:frozen: dong % thuoc dot da Completed — khong chuyen dot', OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_new_status = 'Completed' THEN
        RAISE EXCEPTION 'payroll_payment_line_guard:move-to-completed: khong chuyen dong % sang dot da Completed', OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF v_new_status = 'Completed' AND (
         NEW.user_id                 IS DISTINCT FROM OLD.user_id
      OR NEW.payslip_id              IS DISTINCT FROM OLD.payslip_id
      OR NEW.bank_account_snapshot   IS DISTINCT FROM OLD.bank_account_snapshot
      OR NEW.bank_name_snapshot      IS DISTINCT FROM OLD.bank_name_snapshot
      OR NEW.account_holder_snapshot IS DISTINCT FROM OLD.account_holder_snapshot
      OR NEW.paid_at                 IS DISTINCT FROM OLD.paid_at
      OR NEW.deleted_at              IS DISTINCT FROM OLD.deleted_at
      OR NEW.deleted_by              IS DISTINCT FROM OLD.deleted_by
    ) THEN
      RAISE EXCEPTION 'payroll_payment_line_guard:frozen: dong % thuoc dot da Completed — khong sua phieu/so TK/paid_at/xoa mem', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.payslip_id IS DISTINCT FROM OLD.payslip_id
     OR NEW.user_id    IS DISTINCT FROM OLD.user_id
     OR NEW.batch_id   IS DISTINCT FROM OLD.batch_id THEN
    SELECT ps.user_id, ps.payroll_period_id INTO v_ps_user, v_ps_period
      FROM payslips ps
     WHERE ps.id = NEW.payslip_id AND ps.company_id = NEW.company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payroll_payment_line_guard:not-found: phieu % khong ton tai trong cong ty cua dong', NEW.payslip_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_ps_user IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'payroll_payment_line_guard:cross-user: phieu % khong thuoc nhan su cua dong', NEW.payslip_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_ps_period IS DISTINCT FROM v_new_period THEN
      RAISE EXCEPTION 'payroll_payment_line_guard:cross-period: phieu % khong thuoc ky cua dot %', NEW.payslip_id, NEW.batch_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payroll_payment_line_guard
  BEFORE INSERT OR UPDATE ON payroll_payment_lines
  FOR EACH ROW EXECUTE FUNCTION enforce_payroll_payment_line_guard();
--> statement-breakpoint

-- ─────────────── (4c) T3 payroll_advance_freeze_guard ───────────────
-- Clone enforce_bonus_penalty_freeze (0564, A–E) + ba khác biệt:
--   M3 INSERT: bắt buộc hình dạng Pending sạch + created_by NOT NULL (không INSERT thẳng Approved/Deducted).
--   (E) Deducted → Approved HỢP LỆ khi nhả consume (tính lại kỳ chưa Approved) và CHỈ khi nhả CẢ cặp.
--   B2  bind/nhả chỉ khi kỳ ∈ {CollectingData, Calculated}, đọc kỳ FOR SHARE (xếp hàng với FOR UPDATE của
--       submit/approve). Không có vế này: nhả khoản đã trừ ở kỳ Locked rồi bind kỳ sau = TRỪ LƯƠNG HAI LẦN.
--   ⚠️ bonus_penalties (0564) có CÙNG lỗ B2 — nợ R9 của plan, KHÔNG vá ở đây.
CREATE OR REPLACE FUNCTION enforce_payroll_advance_freeze()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_frozen        boolean;
  v_period_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'Pending'
       OR NEW.payroll_period_id IS NOT NULL OR NEW.consumed_at IS NOT NULL
       OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL
       OR NEW.created_by IS NULL THEN
      RAISE EXCEPTION 'payroll_advance_freeze_guard:insert-shape: tam ung phai sinh o Pending, chua quyet dinh, chua bind ky, co created_by'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  v_frozen := (OLD.status <> 'Pending' OR OLD.payroll_period_id IS NOT NULL);

  -- created_by + company_id bất biến ở MỌI trạng thái — đổi người tạo lúc Pending rồi tự duyệt là lách four-eyes.
  IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'payroll_advance_freeze_guard:frozen: tam ung % khong doi nguoi tao/cong ty', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- (A) rời Pending / đã bind ⇒ khoá field tiền + lý do + vết quyết định.
  IF v_frozen AND (
       NEW.amount              IS DISTINCT FROM OLD.amount
    OR NEW.user_id             IS DISTINCT FROM OLD.user_id
    OR NEW.deduct_period_month IS DISTINCT FROM OLD.deduct_period_month
    OR NEW.reason              IS DISTINCT FROM OLD.reason
    OR NEW.decision_note       IS DISTINCT FROM OLD.decision_note
    OR NEW.decided_by          IS DISTINCT FROM OLD.decided_by
    OR NEW.decided_at          IS DISTINCT FROM OLD.decided_at
  ) THEN
    RAISE EXCEPTION 'payroll_advance_freeze_guard:frozen: tam ung % da roi Pending hoac da bind ky — cam sua tien/ly do/vet quyet dinh', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- (B) rời Pending / đã bind ⇒ cấm xoá mềm.
  IF v_frozen AND (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by) THEN
    RAISE EXCEPTION 'payroll_advance_freeze_guard:frozen: tam ung % da roi Pending hoac da bind ky — cam xoa mem', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- (C) cấm RE-BIND x → y (y ≠ x, y NOT NULL); nhả x → NULL đi qua (F).
  IF OLD.payroll_period_id IS NOT NULL AND NEW.payroll_period_id IS NOT NULL
     AND NEW.payroll_period_id IS DISTINCT FROM OLD.payroll_period_id THEN
    RAISE EXCEPTION 'payroll_advance_freeze_guard:rebind: tam ung % da bind ky % — cam chuyen sang ky khac', OLD.id, OLD.payroll_period_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- (D) câu quyết định (Pending → khác) không được kèm sửa tiền.
  IF OLD.status = 'Pending' AND NEW.status IS DISTINCT FROM OLD.status AND (
       NEW.amount              IS DISTINCT FROM OLD.amount
    OR NEW.user_id             IS DISTINCT FROM OLD.user_id
    OR NEW.deduct_period_month IS DISTINCT FROM OLD.deduct_period_month
    OR NEW.reason              IS DISTINCT FROM OLD.reason
  ) THEN
    RAISE EXCEPTION 'payroll_advance_freeze_guard:frozen: tam ung % — cam vua doi status vua sua tien trong cung mot lenh', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- (E) tập chuyển tiếp DB cho phép. Thiếu (E) thì `SET status='Pending'` gỡ băng toàn bộ (A) (HIGH-1 của S13).
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'Pending'  AND NEW.status IN ('Approved', 'Rejected'))
    OR (OLD.status = 'Approved' AND NEW.status = 'Deducted')
    OR (OLD.status = 'Deducted' AND NEW.status = 'Approved'
        AND NEW.payroll_period_id IS NULL AND NEW.consumed_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'payroll_advance_freeze_guard:status-terminal: tam ung % khong chuyen % -> %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- (F) B2 — bind/nhả CHỈ khi kỳ còn tính lại được.
  IF OLD.payroll_period_id IS NOT NULL AND NEW.payroll_period_id IS NULL THEN
    SELECT pp.status INTO v_period_status
      FROM payroll_periods pp
     WHERE pp.id = OLD.payroll_period_id AND pp.company_id = OLD.company_id
       FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payroll_advance_freeze_guard:not-found: ky % cua tam ung % khong ton tai', OLD.payroll_period_id, OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_period_status NOT IN ('CollectingData', 'Calculated') THEN
      RAISE EXCEPTION 'payroll_advance_freeze_guard:period-frozen: khong nha tam ung % khoi ky % dang %', OLD.id, OLD.payroll_period_id, v_period_status
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.payroll_period_id IS NULL AND NEW.payroll_period_id IS NOT NULL THEN
    SELECT pp.status INTO v_period_status
      FROM payroll_periods pp
     WHERE pp.id = NEW.payroll_period_id AND pp.company_id = NEW.company_id
       FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payroll_advance_freeze_guard:not-found: ky % khong ton tai trong cong ty cua tam ung %', NEW.payroll_period_id, OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_period_status NOT IN ('CollectingData', 'Calculated') THEN
      RAISE EXCEPTION 'payroll_advance_freeze_guard:period-frozen: khong bind tam ung % vao ky % dang %', OLD.id, NEW.payroll_period_id, v_period_status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payroll_advance_freeze_guard
  BEFORE INSERT OR UPDATE ON payroll_advances
  FOR EACH ROW EXECUTE FUNCTION enforce_payroll_advance_freeze();
--> statement-breakpoint

-- ════════════════════════════════ (5) VERIFY FAIL-LOUD (khuôn 0570 khối 7 — KHÔNG rút gọn) ════════════════
-- ⚠️ Chạy bằng role migration (SUPERUSER/BYPASSRLS) ⇒ chứng minh policy TỒN TẠI, KHÔNG chứng minh ĐÚNG.
--    Chứng minh cô lập tenant thật: s15-payroll-db2-invariants.int-spec nhóm A (chạy bằng mediaos_app).
DO $$
DECLARE
  v_new_tables CONSTANT text[] := ARRAY[
    'payroll_advances', 'payroll_payment_batches', 'payroll_payment_lines', 'payroll_budgets'];
  t     text;
  v_n   integer;
  v_bad text;
  v_def text;
BEGIN
  -- (5.1) RLS ENABLE + FORCE + đúng 1 policy tenant_isolation.
  FOREACH t IN ARRAY v_new_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '[0572] verify: % thieu RLS ENABLE hoac FORCE', t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation';
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0572] verify: % thieu policy tenant_isolation (dem duoc %)', t, v_n;
    END IF;
  END LOOP;

  -- (5.2) Tập quyền mediaos_app ĐÚNG BẰNG INSERT,SELECT,UPDATE (không DELETE) — aclexplode.
  SELECT string_agg(format('%s=[%s]', x.relname, COALESCE(x.privs, '')), '; ') INTO v_bad
    FROM (
      SELECT tn AS relname,
             (SELECT string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type)
                FROM pg_class c, aclexplode(c.relacl) a
               WHERE c.relname = tn AND a.grantee = 'mediaos_app'::regrole) AS privs
        FROM unnest(v_new_tables) AS tn
    ) x
   WHERE x.privs IS DISTINCT FROM 'INSERT,SELECT,UPDATE';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0572] verify: tap quyen mediaos_app LECH (phai dung INSERT,SELECT,UPDATE): %', v_bad;
  END IF;

  -- (5.3) mediaos_worker 0 quyền trên cả 4 + ĐỐI CHỨNG DƯƠNG worker VẪN SELECT payroll_periods.
  FOREACH t IN ARRAY v_new_tables LOOP
    SELECT count(*) INTO v_n
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.relname = t AND a.grantee = 'mediaos_worker'::regrole;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0572] verify: mediaos_worker co % quyen tren % — phai 0', v_n, t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
                  WHERE c.relname = 'payroll_periods' AND a.privilege_type = 'SELECT'
                    AND a.grantee = 'mediaos_worker'::regrole) THEN
    RAISE EXCEPTION '[0572] verify: mediaos_worker MAT SELECT tren payroll_periods — thu hoi QUA TAY';
  END IF;

  -- (5.4) 0 GRANT cấp cột trên 4 bảng (revoke-table-grant-wipes-column-grants).
  SELECT string_agg(format('%s.%s=%s', tb.relname, a2.attname, x.privilege_type), '; ') INTO v_bad
    FROM pg_attribute a2
    JOIN pg_class tb ON tb.oid = a2.attrelid
    CROSS JOIN LATERAL aclexplode(a2.attacl) x
   WHERE tb.relname = ANY (v_new_tables) AND a2.attnum > 0 AND NOT a2.attisdropped;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0572] verify: co GRANT CAP COT tren bang moi: %', v_bad;
  END IF;

  -- (5.5) company_id NOT NULL + UNIQUE (company_id, id).
  FOREACH t IN ARRAY v_new_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = t AND column_name = 'company_id' AND is_nullable = 'NO') THEN
      RAISE EXCEPTION '[0572] verify: %.company_id KHONG phai NOT NULL', t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_constraint WHERE conname = t || '_company_id_id_uq' AND contype = 'u';
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0572] verify: % thieu UNIQUE (company_id, id) (dem duoc %)', t, v_n;
    END IF;
  END LOOP;

  -- (5.6) Composite FK: 6 + 5 + 6 + 4 = 21 trên 4 bảng; 0 FK một cột ngoài companies; 2 FK mới của kỳ đúng tên.
  SELECT count(*) INTO v_n
    FROM pg_constraint c JOIN pg_class tb ON tb.oid = c.conrelid
   WHERE tb.relname = ANY (v_new_tables) AND c.contype = 'f' AND array_length(c.conkey, 1) >= 2;
  IF v_n <> 21 THEN
    RAISE EXCEPTION '[0572] verify: co % composite FK tren 4 bang moi, ky vong dung 21', v_n;
  END IF;
  SELECT string_agg(format('%s.%s', tb.relname, c.conname), '; ') INTO v_bad
    FROM pg_constraint c
    JOIN pg_class tb ON tb.oid = c.conrelid
    JOIN pg_class rt ON rt.oid = c.confrelid
   WHERE tb.relname = ANY (v_new_tables) AND c.contype = 'f'
     AND array_length(c.conkey, 1) = 1 AND rt.relname <> 'companies';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0572] verify: con FK MOT COT toi bang khac companies: %', v_bad;
  END IF;
  SELECT string_agg(x.cn, ', ') INTO v_bad
    FROM unnest(ARRAY['payroll_periods_template_id_company_fk', 'payroll_periods_paid_by_company_fk']) AS x(cn)
   WHERE NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = x.cn AND contype = 'f' AND conrelid = 'payroll_periods'::regclass);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0572] verify: payroll_periods thieu FK: %', v_bad;
  END IF;

  -- (5.7) CHECK mới tồn tại ĐÚNG TÊN.
  SELECT string_agg(x.cn, ', ') INTO v_bad
    FROM unnest(ARRAY[
      'payroll_advances_status_check', 'payroll_advances_amount_check', 'payroll_advances_month_check',
      'payroll_advances_decided_pair_check', 'payroll_advances_reject_note_check',
      'payroll_advances_consumed_pair_check', 'payroll_advances_consume_status_check',
      'payroll_advances_deducted_bound_check', 'payroll_advances_four_eyes_check',
      'payroll_payment_batches_method_check', 'payroll_payment_batches_status_check',
      'payroll_payment_batches_completed_pair_check', 'payroll_payment_lines_bank_pair_check',
      'payroll_budgets_year_check', 'payroll_budgets_amount_check',
      'payroll_periods_paid_pair_check']) AS x(cn)
   WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = x.cn AND contype = 'c');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0572] verify: thieu CHECK: %', v_bad;
  END IF;

  -- (5.7b) M8 — ĐỊNH NGHĨA 5 CHECK của payroll_periods ĐÚNG BẰNG (LIKE '%Published%' để lọt việc xoá 'Locked').
  FOR t, v_def IN
    SELECT * FROM (VALUES
      ('payroll_periods_status_check',
       'CHECK ((status = ANY (ARRAY[''Draft''::text, ''CollectingData''::text, ''Calculated''::text, ''Reviewing''::text, ''Approved''::text, ''Published''::text, ''Paid''::text, ''Locked''::text])))'),
      ('payroll_periods_submitted_pair_check',
       'CHECK (((status <> ALL (ARRAY[''Reviewing''::text, ''Approved''::text, ''Published''::text, ''Paid''::text, ''Locked''::text])) OR ((submitted_by IS NOT NULL) AND (submitted_at IS NOT NULL))))'),
      ('payroll_periods_approved_pair_check',
       'CHECK (((status <> ALL (ARRAY[''Approved''::text, ''Published''::text, ''Paid''::text, ''Locked''::text])) OR ((approved_by IS NOT NULL) AND (approved_at IS NOT NULL))))'),
      ('payroll_periods_published_pair_check',
       'CHECK (((status <> ALL (ARRAY[''Published''::text, ''Paid''::text, ''Locked''::text])) OR ((published_by IS NOT NULL) AND (published_at IS NOT NULL) AND (approved_by IS NOT NULL) AND (approved_at IS NOT NULL))))'),
      ('payroll_periods_paid_pair_check',
       'CHECK (((status <> ALL (ARRAY[''Paid''::text, ''Locked''::text])) OR ((paid_by IS NOT NULL) AND (paid_at IS NOT NULL))))')
    ) AS e(cn, def)
  LOOP
    SELECT pg_get_constraintdef(oid) INTO v_bad
      FROM pg_constraint WHERE conname = t AND conrelid = 'payroll_periods'::regclass;
    IF v_bad IS DISTINCT FROM v_def THEN
      RAISE EXCEPTION '[0572] verify: % LECH dinh nghia. Thuc te: % | Ky vong: %', t, v_bad, v_def;
    END IF;
  END LOOP;

  -- (5.8) Unique index đúng tên + indisunique; company_period_idx của đợt KHÔNG unique (ghim chiều ngược).
  SELECT string_agg(x.ix, ', ') INTO v_bad
    FROM unnest(ARRAY['payroll_payment_lines_payslip_uq', 'payroll_payment_lines_batch_user_uq',
                      'payroll_budgets_year_unit_uq', 'payroll_payment_batches_company_code_uq']) AS x(ix)
   WHERE NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
                      WHERE ic.relname = x.ix AND i.indisunique);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0572] verify: thieu unique index: %', v_bad;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
                  WHERE ic.relname = 'payroll_payment_batches_company_period_idx' AND NOT i.indisunique) THEN
    RAISE EXCEPTION '[0572] verify: payroll_payment_batches_company_period_idx vang hoac UNIQUE — ky nhieu dot se chet';
  END IF;

  -- (5.9) 3 trigger tồn tại, bật (O), đúng bảng.
  SELECT string_agg(x.tg || '@' || x.tb, ', ') INTO v_bad
    FROM (VALUES ('payroll_payment_batch_freeze', 'payroll_payment_batches'),
                 ('payroll_payment_line_guard',   'payroll_payment_lines'),
                 ('payroll_advance_freeze_guard', 'payroll_advances')) AS x(tg, tb)
   WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g
                      WHERE g.tgname = x.tg AND g.tgrelid = x.tb::regclass
                        AND NOT g.tgisinternal AND g.tgenabled = 'O');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0572] verify: trigger chot cuoi vang hoac tat: %', v_bad;
  END IF;

  -- (5.10) Hậu di trú (lặp lại — khối VERIFY là cổng cuối, không tin khối trước).
  SELECT count(*) INTO v_n FROM payroll_periods
   WHERE status = 'Paid' OR (status IN ('Paid', 'Locked') AND (paid_by IS NULL OR paid_at IS NULL));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0572] verify: % ky Paid con sot hoac Locked thieu vet paid', v_n;
  END IF;

  RAISE NOTICE '[0572] VERIFY XANH: payroll_periods 8 trang thai + 4 CHECK cap · 4 bang moi · 21 composite FK · 3 trigger.';
END $$;
