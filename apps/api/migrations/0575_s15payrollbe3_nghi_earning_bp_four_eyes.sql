-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0575 — S15-PAYROLL-BE-3 · (1) vá hàng hệ thống NGHI_KHONG_LUONG → `earning` công thức ÂM (owner O-5 15/09/2026)
--        · (2) CHECK bonus_penalties_four_eyes_check (nợ security-review DB-1B MEDIUM)
-- Nguồn: SPEC-11 §13.6 E · §13.7 E · DB-13 §13.4 · plan docs/plans/S15-PAYROLL-BE-3.md §0 O-5 · §3.4 · §4.1
--
-- ── VÌ SAO (1) ────────────────────────────────────────────────────────────────────────────────────
--   LUONG_CO_BAN (mig 0574) cộng SYS_UNPAID_LEAVE_DAYS vào tử số; NGHI_KHONG_LUONG trừ lại với kind = 'deduction'.
--   THU_NHAP_CHIU_THUE = MAX(TONG_THU_NHAP − TONG_BH_NV − GT − Σtax_exempt, 0) KHÔNG trừ deduction ⇒ TNCN tính trên
--   tiền nghỉ không lương mà NV không nhận (ca A1: 750.000 thay vì 550.000/tháng; mọi bất biến SQL vẫn xanh).
--   `earning` âm ⇒ TONG_THU_NHAP = thu nhập thật. decimal.js ROUND_HALF_UP đối xứng quanh 0 ⇒ |mới| = cũ từng xu
--   (formula.line.spec.ts — 1.240 ca, ≥ 500 ca hoà nửa xu).
-- ── VÌ SAO (2) ────────────────────────────────────────────────────────────────────────────────────
--   bonus_penalties chỉ có decided_pair_check ⇒ INSERT/UPDATE thô hàng Approved tự duyệt (decided_by = created_by)
--   được máy tính lương nhặt vào lương. 027 tiền-kiểm ở service; CHECK là lưới cuối (map 409 PAYROLL-ERR-012).
--
-- ── SỐ ĐO bước 0 (15/09/2026) ─────────────────────────────────────────────────────────────────────
--   • _journal.json head = idx 241 / 0574_s15payrolldb1b_seed_formula_bp_period_guard ⇒ file này idx 242.
--   • Khuôn 0574: tắt ĐÚNG MỘT trigger trong MỘT khối DO (ALTER lấy SHARE ROW EXCLUSIVE tới COMMIT, pg_trigger chưa
--     commit không phiên nào thấy ⇒ không có cửa sổ «trigger đang tắt» nhìn được từ ngoài).
--   • PROD — agent KHÔNG chạm. Người vận hành ĐO trước deploy, dán số vào RELEASE:
--       SELECT count(*) FROM salary_components WHERE is_system AND code = 'NGHI_KHONG_LUONG' AND kind = 'deduction';
--       SELECT count(*) FROM payroll_period_lines WHERE template_fingerprint IS NOT NULL;                -- PHẢI = 0
--       SELECT count(*) FROM bonus_penalties WHERE status = 'Approved' AND decided_by = created_by;     -- PHẢI = 0
--
-- ⚠️ Seeder chạy MỖI LẦN BOOT với ON CONFLICT DO NOTHING (không cập nhật hàng đã có) và trigger 0570 đóng băng
--    `kind`/`formula` của hàng is_system ⇒ migration là đường DUY NHẤT vá được hàng đã seed. Build BE cũ (seedVersion
--    ≤ v3) seed công ty MỚI sau mốc này sẽ mang hình dạng cũ ⇒ cổng drift lúc tính trả 422 018 `system-component-drift`
--    (plan §9 R1) — không tính sai im lặng.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (0) PREFLIGHT — fail-loud TRƯỚC mọi ghi ───────────────
DO $$
DECLARE
  v_old CONSTANT text := 'SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_UNPAID_LEAVE_DAYS / SYS_WORK_DAYS';
  v_new CONSTANT text := '-(SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_UNPAID_LEAVE_DAYS / SYS_WORK_DAYS)';
  v_n        integer;
  v_old_rows integer;
  v_new_rows integer;
BEGIN
  -- (0a) Role migration phải vượt RLS — UPDATE ở (1) và preflight (0f) phải thấy hàng của MỌI tenant (khuôn 0572/0574).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION '[0575] DUNG: current_user=% khong SUPERUSER/BYPASSRLS — va va preflight se chi thay hang cua mot tenant', current_user;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  -- (0b) Trigger đóng băng hàng hệ thống phải đúng hình dạng khối (1) giả định.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.salary_components'::regclass AND NOT tgisinternal
                    AND tgname = 'salary_component_system_freeze' AND tgenabled = 'O') THEN
    RAISE EXCEPTION '[0575] DUNG: trigger salary_component_system_freeze vang mat hoac KHONG o trang thai bat (O)';
  END IF;

  -- (0c) Chưa dòng lương nào TÍNH theo mẫu v2. Khác 0 ⇒ đổi kind/công thức là đổi nghĩa số đã lưu ⇒ owner chốt trước.
  SELECT count(*) INTO v_n FROM public.payroll_period_lines WHERE template_fingerprint IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0575] DUNG: % dong luong da tinh theo mau v2 (template_fingerprint) — doi nghia NGHI_KHONG_LUONG la doi nghia lich su, owner chot truoc', v_n;
  END IF;

  -- (0d) Hình dạng THỨ BA (không cũ, không mới) chỉ có khi ai đó đã vượt trigger ⇒ fail-closed, KHÔNG tự đè.
  SELECT count(*) INTO v_n FROM public.salary_components
   WHERE is_system AND code = 'NGHI_KHONG_LUONG'
     AND NOT ((kind = 'deduction' AND formula IS NOT DISTINCT FROM v_old)
           OR (kind = 'earning'   AND formula IS NOT DISTINCT FROM v_new));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0575] DUNG: % hang he thong NGHI_KHONG_LUONG mang hinh dang THU BA (kind/cong thuc) — da co nguoi vuot trigger, KHONG tu de', v_n;
  END IF;

  -- (0e) Ghi đè công thức trong MẪU trên NGHI_KHONG_LUONG hệ thống: sau vá kind = 'earning' ⇒ ghi đè DƯƠNG sẽ CỘNG tiền
  --      nghỉ không lương. Dữ liệu người dùng — KHÔNG sửa hộ, dừng cho owner chốt.
  SELECT count(*) INTO v_n
    FROM public.payroll_template_components ptc
    JOIN public.salary_components sc ON sc.company_id = ptc.company_id AND sc.id = ptc.component_id
   WHERE sc.is_system AND sc.code = 'NGHI_KHONG_LUONG' AND ptc.formula_override IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0575] DUNG: % mau bang luong ghi de cong thuc NGHI_KHONG_LUONG — sau khi doi sang earning, ghi de duong se CONG tien; owner chot truoc', v_n;
  END IF;

  -- (0f) CHECK (2) thêm VALIDATED ⇒ hàng tự duyệt đang có sẽ làm ALTER nổ giữa chừng. Báo số hàng, KHÔNG tự sửa vết duyệt.
  SELECT count(*) INTO v_n FROM public.bonus_penalties
   WHERE status = 'Approved' AND decided_by IS NOT DISTINCT FROM created_by;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0575] DUNG: % khoan thuong/phat Approved TU DUYET (decided_by = created_by) — xu ly du lieu truoc khi them bonus_penalties_four_eyes_check', v_n;
  END IF;

  SELECT count(*) FILTER (WHERE kind = 'deduction' AND formula = v_old),
         count(*) FILTER (WHERE kind = 'earning' AND formula = v_new)
    INTO v_old_rows, v_new_rows
    FROM public.salary_components WHERE is_system AND code = 'NGHI_KHONG_LUONG';
  RAISE NOTICE '[0575] preflight: NGHI_KHONG_LUONG hinh dang cu=% · hinh dang moi=%', v_old_rows, v_new_rows;
END $$;
--> statement-breakpoint

-- ─────────────── (1) VÁ NGHI_KHONG_LUONG — MỘT khối DO, nguyên tử ───────────────
-- Tắt ĐÚNG MỘT trigger, sửa ĐÚNG hai cột (kind + formula) của ĐÚNG các hàng mang hình dạng cũ CHÍNH XÁC, bật lại —
-- trong cùng khối. `updated_by` để nguyên: không có actor người; vết thay đổi = migration này + DB-13 §13.4.
DO $$
DECLARE
  v_old CONSTANT text := 'SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_UNPAID_LEAVE_DAYS / SYS_WORK_DAYS';
  v_new CONSTANT text := '-(SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_UNPAID_LEAVE_DAYS / SYS_WORK_DAYS)';
  v_before integer;
  v_n      integer;
BEGIN
  SELECT count(*) INTO v_before FROM public.salary_components
   WHERE is_system AND code = 'NGHI_KHONG_LUONG' AND kind = 'deduction' AND formula = v_old;

  -- 0 hàng cũ (DB mới / chạy lại) ⇒ KHÔNG tắt trigger, KHÔNG lấy khoá. ELSE gán 0 TƯỜNG MINH: v_n NULL làm phép so
  -- bên dưới thành NULL ⇒ IF không bắn ⇒ xanh câm (bài học database-review DB-1B L-2).
  IF v_before > 0 THEN
    ALTER TABLE public.salary_components DISABLE TRIGGER salary_component_system_freeze;
    UPDATE public.salary_components
       SET kind = 'earning', formula = v_new, updated_at = now()
     WHERE is_system AND code = 'NGHI_KHONG_LUONG' AND kind = 'deduction' AND formula = v_old;
    GET DIAGNOSTICS v_n = ROW_COUNT; -- KHÔNG dùng FOUND
    ALTER TABLE public.salary_components ENABLE TRIGGER salary_component_system_freeze;
  ELSE
    v_n := 0;
  END IF;

  IF v_n IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION '[0575] va NGHI_KHONG_LUONG cap nhat % hang, do truoc duoc % — DUNG', v_n, v_before;
  END IF;
  RAISE NOTICE '[0575] NGHI_KHONG_LUONG: da va % hang', v_n;
END $$;
--> statement-breakpoint

-- ─────────────── (2) CHECK four-eyes thưởng/phạt ───────────────
-- `IS DISTINCT FROM`: decided_by NULL (FK SET NULL khi xoá user) không làm CHECK nổ. Tên có tiền tố bảng (mapPayrollPgError
-- khớp theo tên). VALIDATED — (0f) đã chứng minh 0 vi phạm. Bọc IF NOT EXISTS để chạy lại file là idempotent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.bonus_penalties'::regclass
                    AND conname = 'bonus_penalties_four_eyes_check') THEN
    ALTER TABLE public.bonus_penalties
      ADD CONSTRAINT bonus_penalties_four_eyes_check
      CHECK (status <> 'Approved' OR decided_by IS DISTINCT FROM created_by);
  END IF;
END $$;
--> statement-breakpoint

-- ════════════════════════════════ (3) VERIFY FAIL-LOUD ════════════════════════════════
-- Chạy lại toàn file là idempotent: (0) xanh · (1) vá 0 hàng · (2) IF NOT EXISTS · (3) vẫn xanh.
DO $$
DECLARE
  v_new CONSTANT text := '-(SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_UNPAID_LEAVE_DAYS / SYS_WORK_DAYS)';
  v_n   integer;
  v_def text;
BEGIN
  SELECT count(*) INTO v_n FROM public.salary_components
   WHERE is_system AND code = 'NGHI_KHONG_LUONG'
     AND (kind IS DISTINCT FROM 'earning' OR formula IS DISTINCT FROM v_new);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0575] verify: con % hang he thong NGHI_KHONG_LUONG KHONG mang (earning, cong thuc am)', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.salary_components'::regclass AND NOT tgisinternal
                    AND tgname = 'salary_component_system_freeze' AND tgenabled = 'O') THEN
    RAISE EXCEPTION '[0575] verify: salary_component_system_freeze KHONG duoc bat lai — hang is_system SUA DUOC';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.bonus_penalties'::regclass
     AND c.conname = 'bonus_penalties_four_eyes_check' AND c.contype = 'c' AND c.convalidated;
  IF v_def IS DISTINCT FROM
     'CHECK (((status <> ''Approved''::text) OR (decided_by IS DISTINCT FROM created_by)))' THEN
    RAISE EXCEPTION '[0575] verify: bonus_penalties_four_eyes_check sai dinh nghia hoac chua VALIDATED: %', coalesce(v_def, '<vang mat>');
  END IF;
END $$;
