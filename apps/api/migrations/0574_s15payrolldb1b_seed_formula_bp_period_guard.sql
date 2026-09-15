-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0574 — S15-PAYROLL-DB-1B · (1) vá công thức seed LUONG_CO_BAN · (2) index RI payroll_template_components
--        · (3) nhánh (F) B2 + INSERT cho enforce_bonus_penalty_freeze (trả nợ DB-2 §3.5.a B2 + LOW-1)
-- Nguồn: DB-13 §13.4 · §5.5 · SPEC-11 §12.1 · §13.4 «Nghỉ KHÔNG lương» (QUYẾT ĐỊNH OWNER 2026-09-01)
-- Plan + biên bản cổng: docs/plans/S15-PAYROLL-DB-1B.md (§3.8 = vá plan-review vòng 1, ĐÈ §4)
--
-- ── SỐ ĐO bước 0 (14/09/2026) ──────────────────────────────────────────────────────────────────
--   • _journal.json head = idx 240 / 0573_s15payrolldb2_noti_trackc ⇒ file này idx 241.
--   • Chưa migration nào tắt trigger ⇒ đây là tiền lệ đầu. Khối (1) giữ ALTER + UPDATE + ALTER trong MỘT khối DO:
--     ALTER TABLE … DISABLE/ENABLE TRIGGER lấy SHARE ROW EXCLUSIVE tới COMMIT và thay đổi pg_trigger chưa commit
--     KHÔNG phiên nào thấy ⇒ không có cửa sổ «trigger đang tắt» nhìn được từ bên ngoài.
--   • Công thức mới chốt BẰNG SỐ ĐO (plan §5.2.a — 51.584 ca so số học CHÍNH XÁC bằng BigInt): khớp 100%.
--     v1 (payroll-calc.repository.ts) lệch ĐÚNG 0,01 ở ca HOÀ nửa xu (PG chia trước, cắt chữ số rồi mới nhân) —
--     v1 là bên làm tròn sai. NGHI_KHONG_LUONG khớp chính xác 100% ⇒ KHÔNG sửa.
--   • PROD — agent KHÔNG chạm. Người vận hành ĐO trước deploy (plan §9 R1), dán số vào RELEASE:
--       SELECT count(*) FROM salary_components WHERE is_system AND code = 'LUONG_CO_BAN'
--          AND formula = 'SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_PRESENT_DAYS / SYS_WORK_DAYS';
--       SELECT count(*) FROM payroll_period_lines WHERE template_fingerprint IS NOT NULL;   -- PHẢI = 0
--       SELECT version();                                                                  -- PHẢI ≥ 14
--
-- ⚠️ Seeder chạy MỖI LẦN BOOT với ON CONFLICT DO NOTHING (không cập nhật hàng đã có) và trigger 0570 đóng băng
--    `formula` của hàng is_system với MỌI role ⇒ migration là đường DUY NHẤT vá được hàng đã seed. Assert (7) mới
--    của seeder (payroll-master-data.integrity.ts) báo ĐÍCH DANH nếu môi trường nào còn lệch.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (0) PREFLIGHT — fail-loud TRƯỚC mọi ghi ───────────────
DO $$
DECLARE
  v_old CONSTANT text := 'SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_PRESENT_DAYS / SYS_WORK_DAYS';
  v_new CONSTANT text := 'MIN(SYS_BASE_SALARY * (SYS_PRESENT_DAYS + SYS_UNPAID_LEAVE_DAYS) / SYS_WORK_DAYS, SYS_BASE_SALARY) * SYS_PAY_RATIO / 100';
  v_n        integer;
  v_old_rows integer;
  v_new_rows integer;
  v_override integer;
BEGIN
  -- (0a) Role migration phải vượt RLS — UPDATE ở (1) phải thấy hàng của MỌI tenant (khuôn 0572).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION '[0574] DUNG: current_user=% khong SUPERUSER/BYPASSRLS — va cong thuc se chi thay hang cua mot tenant', current_user;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  -- (0b) Hai trigger + function phải đúng hình dạng mà khối (1)/(3) giả định.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.salary_components'::regclass AND NOT tgisinternal
                    AND tgname = 'salary_component_system_freeze' AND tgenabled = 'O') THEN
    RAISE EXCEPTION '[0574] DUNG: trigger salary_component_system_freeze vang mat hoac KHONG o trang thai bat (O)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.bonus_penalties'::regclass AND NOT tgisinternal
                    AND tgname = 'bonus_penalty_freeze_guard') THEN
    RAISE EXCEPTION '[0574] DUNG: trigger bonus_penalty_freeze_guard vang mat — 0564 chua chay?';
  END IF;
  IF to_regprocedure('public.enforce_bonus_penalty_freeze()') IS NULL THEN
    RAISE EXCEPTION '[0574] DUNG: function enforce_bonus_penalty_freeze() vang mat';
  END IF;

  -- (0c) Chưa dòng lương nào TÍNH theo mẫu v2. Khác 0 ⇒ đổi công thức là đổi nghĩa số đã lưu ⇒ owner chốt trước.
  SELECT count(*) INTO v_n FROM public.payroll_period_lines WHERE template_fingerprint IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0574] DUNG: % dong luong da tinh theo mau v2 (template_fingerprint) — doi cong thuc la doi nghia lich su, owner chot truoc', v_n;
  END IF;

  -- (0d) Hàng thứ ba (không cũ, không mới) chỉ có khi ai đó đã vượt trigger ⇒ fail-closed, KHÔNG tự đè.
  SELECT count(*) INTO v_n FROM public.salary_components
   WHERE is_system AND code = 'LUONG_CO_BAN' AND (formula IS NULL OR formula NOT IN (v_old, v_new));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0574] DUNG: % hang he thong LUONG_CO_BAN mang cong thuc THU BA — da co nguoi vuot trigger, KHONG tu de', v_n;
  END IF;

  SELECT count(*) FILTER (WHERE formula = v_old), count(*) FILTER (WHERE formula = v_new)
    INTO v_old_rows, v_new_rows
    FROM public.salary_components WHERE is_system AND code = 'LUONG_CO_BAN';
  -- Ghi đè trong mẫu mang chuỗi cũ là dữ liệu NGƯỜI DÙNG — KHÔNG sửa, chỉ báo (plan §9 R4).
  SELECT count(*) INTO v_override FROM public.payroll_template_components WHERE formula_override = v_old;
  RAISE NOTICE '[0574] preflight: LUONG_CO_BAN chuoi cu=% · chuoi moi=% · formula_override mang chuoi cu=% (KHONG sua)',
    v_old_rows, v_new_rows, v_override;
END $$;
--> statement-breakpoint

-- ─────────────── (1) VÁ công thức LUONG_CO_BAN — MỘT khối DO, nguyên tử ───────────────
-- Tắt ĐÚNG MỘT trigger, sửa ĐÚNG MỘT cột của ĐÚNG các hàng mang chuỗi cũ CHÍNH XÁC, bật lại — trong cùng khối. Lỗi ở
-- bất kỳ đâu ⇒ transaction của migrator rollback, trigger về nguyên trạng. `updated_by` để nguyên: không có actor
-- người; vết thay đổi = migration này + DB-13 §13.4. Không lọc deleted_at: CHECK system_not_deletable cấm hàng hệ
-- thống xoá mềm.
DO $$
DECLARE
  v_old CONSTANT text := 'SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_PRESENT_DAYS / SYS_WORK_DAYS';
  v_new CONSTANT text := 'MIN(SYS_BASE_SALARY * (SYS_PRESENT_DAYS + SYS_UNPAID_LEAVE_DAYS) / SYS_WORK_DAYS, SYS_BASE_SALARY) * SYS_PAY_RATIO / 100';
  v_before integer;
  v_n      integer;
BEGIN
  SELECT count(*) INTO v_before FROM public.salary_components
   WHERE is_system AND code = 'LUONG_CO_BAN' AND formula = v_old;

  -- 0 hàng mang chuỗi cũ (DB mới / chạy lại) ⇒ KHÔNG tắt trigger, KHÔNG lấy khoá. ELSE gán 0 TƯỜNG MINH: v_n NULL
  -- làm phép so bên dưới thành NULL ⇒ IF không bắn ⇒ xanh câm (database-review DB-1B L-2).
  IF v_before > 0 THEN
    ALTER TABLE public.salary_components DISABLE TRIGGER salary_component_system_freeze;
    UPDATE public.salary_components
       SET formula = v_new, updated_at = now()
     WHERE is_system AND code = 'LUONG_CO_BAN' AND formula = v_old;
    GET DIAGNOSTICS v_n = ROW_COUNT; -- KHÔNG dùng FOUND
    ALTER TABLE public.salary_components ENABLE TRIGGER salary_component_system_freeze;
  ELSE
    v_n := 0;
  END IF;

  IF v_n IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION '[0574] va cong thuc cap nhat % hang, do truoc duoc % — DUNG', v_n, v_before;
  END IF;
  RAISE NOTICE '[0574] LUONG_CO_BAN: da va % hang', v_n;
END $$;
--> statement-breakpoint

-- ─────────────── (2) index RI — vế trái FK payroll_template_components_component_id_company_fk ───────────────
-- database-review BE-2 LOW-2: FK (company_id, component_id) KHÔNG có index ⇒ templatesContainingTx (046/047) và RI khi
-- xoá/đổi hàng salary_components quét cả bảng. Bảng nhỏ + migrator chạy trong transaction ⇒ không CONCURRENTLY.
CREATE INDEX IF NOT EXISTS payroll_template_components_company_component_idx
  ON public.payroll_template_components (company_id, component_id);
--> statement-breakpoint

-- ─────────────── (3) enforce_bonus_penalty_freeze — (A)–(E) GIỮ NGUYÊN logic 0564 · + (F) B2 · + nhánh INSERT ───────────────
-- Lỗ B2 (plan DB-2 §3.5.a — cùng hình dạng T3 payroll_advances ở 0572): 0564 không có vế trạng-thái-kỳ ⇒
--   (i)  nhả khoản đã trừ ở kỳ Locked/Paid rồi gắn kỳ sau = TRỪ LƯƠNG HAI LẦN;
--   (ii) gắn vào kỳ ≥ Reviewing (hoặc kỳ đã xoá mềm) = `consumed` mà KHÔNG BAO GIỜ vào dòng lương.
-- Service v1 không tạo được hai ca này (khoá kỳ FOR UPDATE + tiền-kiểm trạng thái); (F) là LƯỚI CUỐI ở DB cho mô hình
-- «bug/script/repository gọi thẳng» — cùng lý do tồn tại của (A)–(E).
--
-- Message `bonus_penalty_freeze_guard:<tag>: …`, tag ĐÓNG = frozen · rebind · status-terminal · period-frozen · not-found.
-- Giữ tiền tố ⇒ payroll.errors.ts vẫn map 409 PAYROLL-ERR-013 `bonus-frozen-race` (chốt RACE; service tiền-kiểm trước).
--
-- ⚠️ KHÔNG thêm «INSERT chỉ Pending sạch» như T3 (plan §3.6): giết fixture đối kháng dựng hàng đã-duyệt bằng INSERT và
--    các ca ghim TÊN CHECK (BEFORE INSERT bắn trước CHECK). INSERT chỉ nhận vế B2.
-- ⚠️ Nhả KHÔNG lọc deleted_at (còn cứu khoản ra được); gắn/INSERT CÓ lọc — máy tính chỉ chạm kỳ sống (plan §3.8 M-3).
-- ⚠️ KHOÁ: kỳ đọc FOR SHARE. Máy tính giữ kỳ FOR UPDATE TRƯỚC khi ghi bonus_penalties (cùng tx ⇒ không tự xung đột).
--    BE-3 PHẢI giữ thứ tự «khoá kỳ → ghi bonus»; đảo lại là nguy cơ 40P01 (plan §9 R6).
CREATE OR REPLACE FUNCTION public.enforce_bonus_penalty_freeze()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_frozen        boolean;
  v_period_status text;
BEGIN
  -- INSERT: chỉ vế B2 — hàng sinh ra ĐÃ consume thì kỳ phải sống và còn tính lại được.
  IF TG_OP = 'INSERT' THEN
    IF NEW.payroll_period_id IS NOT NULL THEN
      SELECT pp.status INTO v_period_status
        FROM public.payroll_periods pp
       WHERE pp.id = NEW.payroll_period_id AND pp.company_id = NEW.company_id AND pp.deleted_at IS NULL
         FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'bonus_penalty_freeze_guard:not-found: ky % khong ton tai (hoac da xoa mem) trong cong ty cua khoan %', NEW.payroll_period_id, NEW.id
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_period_status NOT IN ('CollectingData', 'Calculated') THEN
        RAISE EXCEPTION 'bonus_penalty_freeze_guard:period-frozen: khong chen khoan % da gan ky % dang %', NEW.id, NEW.payroll_period_id, v_period_status
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- KHÔNG khởi tạo từ OLD ở DECLARE: nhánh INSERT không có OLD (khuôn 0572).
  v_frozen := (OLD.status <> 'Pending' OR OLD.payroll_period_id IS NOT NULL);

  -- (A) đóng băng field tiền + lý do + VẾT NGƯỜI QUYẾT ĐỊNH (logic 0564, chỉ đổi message sang tag).
  IF v_frozen AND (
       NEW.amount        IS DISTINCT FROM OLD.amount
    OR NEW.kind          IS DISTINCT FROM OLD.kind
    OR NEW.user_id       IS DISTINCT FROM OLD.user_id
    OR NEW.period_month  IS DISTINCT FROM OLD.period_month
    OR NEW.reason        IS DISTINCT FROM OLD.reason
    OR NEW.decision_note IS DISTINCT FROM OLD.decision_note
    OR NEW.decided_by    IS DISTINCT FROM OLD.decided_by
    OR NEW.decided_at    IS DISTINCT FROM OLD.decided_at
  ) THEN
    RAISE EXCEPTION
      'bonus_penalty_freeze_guard:frozen: % (id=%, ky %) da roi Pending hoac da consume — cam sua field tien/ly do/vet quyet dinh',
      OLD.kind, OLD.id, OLD.period_month
      USING ERRCODE = 'check_violation';
  END IF;

  -- (B) cấm xoá mềm sau khi rời Pending / đã consume
  IF v_frozen AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION
      'bonus_penalty_freeze_guard:frozen: % (id=%, ky %) da roi Pending hoac da consume — cam xoa mem',
      OLD.kind, OLD.id, OLD.period_month
      USING ERRCODE = 'check_violation';
  END IF;

  -- (C) cấm re-bind sang kỳ KHÁC; nhả x → NULL đi qua (F)
  IF OLD.payroll_period_id IS NOT NULL
     AND NEW.payroll_period_id IS DISTINCT FROM OLD.payroll_period_id
     AND NEW.payroll_period_id IS NOT NULL THEN
    RAISE EXCEPTION
      'bonus_penalty_freeze_guard:rebind: % (id=%, ky %) da consume ky luong — cam re-bind sang ky khac',
      OLD.kind, OLD.id, OLD.period_month
      USING ERRCODE = 'check_violation';
  END IF;

  -- (D) câu lệnh duyệt/từ chối không được kèm sửa tiền
  IF OLD.status = 'Pending' AND NEW.status IS DISTINCT FROM OLD.status AND (
       NEW.amount       IS DISTINCT FROM OLD.amount
    OR NEW.kind         IS DISTINCT FROM OLD.kind
    OR NEW.user_id      IS DISTINCT FROM OLD.user_id
    OR NEW.period_month IS DISTINCT FROM OLD.period_month
    OR NEW.reason       IS DISTINCT FROM OLD.reason
  ) THEN
    RAISE EXCEPTION
      'bonus_penalty_freeze_guard:frozen: % (id=%, ky %) — cam vua doi status vua sua field tien trong cung mot lenh',
      OLD.kind, OLD.id, OLD.period_month
      USING ERRCODE = 'check_violation';
  END IF;

  -- (E) TERMINAL: rời Pending rồi thì KHÔNG đổi status nữa (thiếu (E) thì Approved → Pending gỡ băng toàn bộ (A)).
  IF OLD.status <> 'Pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION
      'bonus_penalty_freeze_guard:status-terminal: % (id=%, ky %) da o trang thai TERMINAL % — cam doi status',
      OLD.kind, OLD.id, OLD.period_month, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- (F) B2 — nhả/gắn consume CHỈ khi kỳ còn tính lại được. x → y đã bị (C) chặn ở trên.
  IF OLD.payroll_period_id IS NOT NULL AND NEW.payroll_period_id IS NULL THEN
    SELECT pp.status INTO v_period_status
      FROM public.payroll_periods pp
     WHERE pp.id = OLD.payroll_period_id AND pp.company_id = OLD.company_id
       FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bonus_penalty_freeze_guard:not-found: ky % cua khoan % khong ton tai', OLD.payroll_period_id, OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_period_status NOT IN ('CollectingData', 'Calculated') THEN
      RAISE EXCEPTION 'bonus_penalty_freeze_guard:period-frozen: khong nha khoan % khoi ky % dang %', OLD.id, OLD.payroll_period_id, v_period_status
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.payroll_period_id IS NULL AND NEW.payroll_period_id IS NOT NULL THEN
    SELECT pp.status INTO v_period_status
      FROM public.payroll_periods pp
     WHERE pp.id = NEW.payroll_period_id AND pp.company_id = NEW.company_id AND pp.deleted_at IS NULL
       FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bonus_penalty_freeze_guard:not-found: ky % khong ton tai (hoac da xoa mem) trong cong ty cua khoan %', NEW.payroll_period_id, OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_period_status NOT IN ('CollectingData', 'Calculated') THEN
      RAISE EXCEPTION 'bonus_penalty_freeze_guard:period-frozen: khong gan khoan % vao ky % dang %', OLD.id, NEW.payroll_period_id, v_period_status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- CREATE OR REPLACE TRIGGER (PG ≥ 14) thay DROP + CREATE: không lấy ACCESS EXCLUSIVE trên bonus_penalties khi app
-- đang chạy; giữ nguyên TÊN (ca C8 s13-payroll-db1-invariants ghim tên).
CREATE OR REPLACE TRIGGER bonus_penalty_freeze_guard
  BEFORE INSERT OR UPDATE ON public.bonus_penalties
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bonus_penalty_freeze();
--> statement-breakpoint

-- ════════════════════════════════ (4) VERIFY FAIL-LOUD ════════════════════════════════
-- Chạy lại toàn file là idempotent: (1) vá 0 hàng · (2) IF NOT EXISTS · (3) OR REPLACE · (4) vẫn xanh.
DO $$
DECLARE
  v_new CONSTANT text := 'MIN(SYS_BASE_SALARY * (SYS_PRESENT_DAYS + SYS_UNPAID_LEAVE_DAYS) / SYS_WORK_DAYS, SYS_BASE_SALARY) * SYS_PAY_RATIO / 100';
  v_fn  oid := to_regprocedure('public.enforce_bonus_penalty_freeze()');
  v_n   integer;
  v_def text;
  v_src text;
BEGIN
  SELECT count(*) INTO v_n FROM public.salary_components
   WHERE is_system AND code = 'LUONG_CO_BAN' AND formula IS DISTINCT FROM v_new;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0574] verify: con % hang he thong LUONG_CO_BAN KHONG mang cong thuc moi', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.salary_components'::regclass AND NOT tgisinternal
                    AND tgname = 'salary_component_system_freeze' AND tgenabled = 'O') THEN
    RAISE EXCEPTION '[0574] verify: salary_component_system_freeze KHONG duoc bat lai — hang is_system SUA DUOC, net=gross im lang';
  END IF;

  -- tgtype: 1 ROW | 2 BEFORE | 4 INSERT | 16 UPDATE = 23 (không DELETE/TRUNCATE).
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'public.bonus_penalties'::regclass AND NOT tgisinternal
     AND tgname = 'bonus_penalty_freeze_guard' AND tgtype = 23 AND tgenabled = 'O' AND tgfoid = v_fn;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0574] verify: bonus_penalty_freeze_guard khong phai BEFORE INSERT OR UPDATE FOR EACH ROW dang bat, tro dung function';
  END IF;

  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_fn;
  IF v_src IS NULL
     OR v_src NOT LIKE '%period-frozen%'
     OR v_src NOT LIKE '%public.payroll_periods%'
     OR v_src NOT LIKE '%pp.deleted_at IS NULL%' THEN
    RAISE EXCEPTION '[0574] verify: enforce_bonus_penalty_freeze thieu nhanh (F) (period-frozen / public.payroll_periods / loc deleted_at)';
  END IF;
  -- Lọc kỳ xoá mềm ở ĐÚNG HAI vế (INSERT + gắn); vế nhả KHÔNG lọc. LIKE ở trên mù với việc gỡ MỘT trong hai vế
  -- (database-review DB-1B M-1).
  IF (length(v_src) - length(replace(v_src, 'pp.deleted_at IS NULL', ''))) / length('pp.deleted_at IS NULL') <> 2 THEN
    RAISE EXCEPTION '[0574] verify: loc pp.deleted_at IS NULL phai xuat hien DUNG 2 lan (INSERT + gan) trong enforce_bonus_penalty_freeze';
  END IF;

  SELECT pg_get_indexdef(to_regclass('public.payroll_template_components_company_component_idx')) INTO v_def;
  IF v_def IS DISTINCT FROM
     'CREATE INDEX payroll_template_components_company_component_idx ON public.payroll_template_components USING btree (company_id, component_id)' THEN
    RAISE EXCEPTION '[0574] verify: index RI sai dinh nghia: %', coalesce(v_def, '<vang mat>');
  END IF;
END $$;
