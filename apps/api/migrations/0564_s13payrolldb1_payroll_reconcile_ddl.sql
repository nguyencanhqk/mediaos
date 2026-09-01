-- Migration 0564: S13-PAYROLL-DB-1 (🔴 RED, zone=red, crown — payroll) — RECONCILE DDL 6 bảng di sản G12
--   + tạo bảng NHÁP `payroll_period_lines` (DB-13 §5/§6, kế hoạch docs/plans/S13-PAYROLL-DB-1.md §2).
--   THUẦN DDL VIẾT TAY — **KHÔNG chạy `db:generate`** (schema/payroll.ts sửa tay song song, cùng commit).
--
-- DESTRUCTIVE-APPROVED: PAY-DEC-002 (owner ký nguyên gói wave S13-PAYROLL 31/08/2026) — GỠ 20 cột ghi-rồi-bỏ
--   của hướng cũ trên 5/6 bảng di sản G12, + 11 CHECK chết theo, + 2 unique index, + 3 trigger/function ép FSM cũ.
--   ĐO 01/09/2026 trên DB `mediaos` (PROD + dev-online dùng chung): **cả 6 bảng = 0 hàng**, 0 route,
--   0 thư mục apps/api/src/payroll/, 0 dòng app.module.ts ⇒ 0 dữ liệu mất, 0 hộ tiêu thụ. Tiền kiểm "0 hàng"
--   fail-loud ở khối (1) ngay dưới: có hàng ⇒ RAISE EXCEPTION, DỪNG, báo người.
--
-- ── VÌ SAO GỠ chứ không nối dây ────────────────────────────────────────────────────────────────
--   20 cột chia làm bốn nhóm, mỗi nhóm là một quyết định ĐÃ CHỐT ở wave plan §3, không phải dọn tuỳ hứng:
--     · KPI ngoài phạm vi sản phẩm (de-media-fy, CLAUDE.md §1): payroll_periods.kpi_locked · payslips.kpi_amount
--       · bonus_penalties.source/reference_type/task_id/kpi_result_id;
--     · VND duy nhất (PAY-DEC-004): 3 cột `currency` — hằng ở service, không phải cột;
--     · v1 chỉ lương THÁNG + hồ sơ VERSIONED (PAY-DEC-003/004): salary_profiles.salary_type/pay_cycle/status
--       — cờ `status` chạy song song với versioning theo effective_date là nguồn mâu thuẫn;
--     · đường KHIẾU NẠI và đường adjustment/void ngoài v1 (SPEC-11 §5.2/§22f/§22g → PARK-PAYROLL-001):
--       payslips.entry_kind/replaces_payslip_id · payslip_acknowledgements.status/reason/resolved_*/
--       resolution_note/updated_at.
--   Cả 20 cột đều KHÔNG có route nào ghi ⇒ giữ lại là cột ghi-rồi-bỏ
--   (`write-only-column-means-delete-not-wire-up`: `docs/DB` quyết hướng vá, không phải sự tồn tại của cột).
--   ⚠️ `DROP COLUMN` của Postgres gỡ theo MỌI CHECK/index chạm cột đó TRONG IM LẶNG
--   (`drop-column-silently-drops-check`) ⇒ mỗi mục GỠ dưới đây liệt kê TƯỜNG MINH cái chết theo, và
--   `payslips_amounts_check` được DỰNG LẠI có kiểm soát. Khối verify (11) đếm lại đủ 20 cột đã biến mất.
--
-- ⚠️ BAND DI SẢN 0091–0180 BẤT KHẢ XÂM PHẠM — mọi thay đổi làm ở file MỚI này, không sửa file cũ.
--
-- BƯỚC 0 — ĐO THẬT trên DB đích 2026-09-01 (plan §0), mọi lệnh dưới đây viết theo số ĐO, không suy từ migration cũ
--   (grant-in-old-migration-is-not-current-state):
--   • 6 bảng di sản = **0 hàng** ⇒ đủ điều kiện GỠ cột (guard (1) dưới đây RAISE nếu ≠ 0 lúc chạy thật).
--   • RLS ENABLE+FORCE + policy `tenant_isolation` literal-GUC: **đã đúng sẵn cả 6** ⇒ chỉ VERIFY, không tạo lại.
--   • Composite tenant-FK: **ĐÃ CÓ SẴN** từ 0535 trên cả 6 bảng (DB-13 §4.2 giả định chưa có — SAI, plan §0.3).
--     ⇒ file này chỉ THÊM composite cho cột `*_by` MỚI + SỬA `ON DELETE` của các composite lệch khuôn.
--   • `attendance_periods` ĐÃ có UNIQUE (company_id, id) (0535:585) ⇒ bước "thêm nếu thiếu" của DB-13 §5.2 là NO-OP.
--   • 0 column-GRANT trên cả 6 bảng ⇒ REVOKE cấp bảng an toàn (revoke-table-grant-wipes-column-grants).
--   • pg_default_acl = 0 hàng ⇒ bảng mới không bị auto-grant.
--
-- QUYẾT ĐỊNH CHỐT (plan §1 P1–P7 · §8 sau plan-review vòng 1):
--   P2 `salary_profiles.user_id`: CẢ HAI FK (đơn cột + composite) CASCADE → NO ACTION. Bảng này **KHÔNG** nằm
--      trong cleanupTenants() — nó đang sống nhờ CASCADE ⇒ cùng commit PHẢI thêm `DELETE FROM salary_profiles`
--      trước `DELETE FROM users` (drop-table-must-clean-test-teardown).
--   P3 `payslip_items.payslip_id`: CẢ HAI CASCADE → NO ACTION (CASCADE trên bảng chỉ-INSERT là đường xoá ẩn).
--   P4 `bonus_penalties.decided_by` (RENAME từ approved_by): RESTRICT → SET NULL (decided_by). RESTRICT chặn
--      cascade companies→users (bài học cleanupTenants).
--   B2 `bonus_penalties.payroll_period_id`: SET NULL → **NO ACTION** (DB-13 §5.5). SET NULL cấp DB null một vế
--      của cặp ⇒ 23514 trên bonus_penalties_consumed_pair_check giữa cascade. Nhả consume phải qua service.
--   B3 `payroll_periods.attendance_period_id`: SET NULL → **NO ACTION**. CHECK mới
--      payroll_periods_calculated_needs_attendance_check đòi cột NOT NULL khi kỳ rời Draft/CollectingData;
--      RI SET NULL trong cascade ⇒ 23514. Teardown an toàn: cleanupTenants xoá payroll_periods (seed.ts:503)
--      TRƯỚC attendance_periods (seed.ts:613).
--   B1 trigger `bonus_penalty_guard` (0098:110-149) có BỐN nhánh, không một. Chỉ nhánh (1) ép FSM chữ thường bị
--      bỏ; ba nhánh còn lại là BẤT BIẾN TIỀN ⇒ dựng lại trong `enforce_bonus_penalty_freeze()` (khối 7g).
--   P7 THU HỒI SELECT của mediaos_worker trên salary_profiles/payslips/payslip_items (đo: 0 route, 0 handler,
--      0 @SystemJobHandler đọc bảng lương ở v1). GIỮ worker SELECT trên payroll_periods/bonus_penalties/
--      payslip_acknowledgements (không chứa số lương per-phiếu).
--   Đổi ON DELETE = DROP + ADD constraint (Postgres không ALTER CONSTRAINT được ON DELETE), **GIỮ NGUYÊN TÊN**
--      constraint để census FK không tụt sàn ngoài dự kiến; riêng cột RENAME thì đổi tên theo cột.
--
-- BẤT BIẾN:
--   #1 company_id + RLS FORCE: 6 bảng verify lại fail-loud; `payroll_period_lines` tạo policy TRƯỚC mọi INSERT.
--   #2 append-only: payslips/payslip_items giữ GRANT SELECT+INSERT; payslip_acknowledgements REVOKE UPDATE về
--      cùng khuôn; KHÔNG bảng PAYROLL nào có DELETE cho app role.
--   #3 tiền: numeric(18,2), VND duy nhất (mọi cột `currency` GỠ), mọi CHECK số học viết ở SQL.
--
-- BAND 0564 (lane S13-PAYROLL-DB-1). Journal: idx 231, when 1717587353000 (> 0563 idx 230 / 1717587352000).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) GUARD: 0 hàng trên cả 6 bảng + nền tảng có sẵn ───────────────
-- Mọi lệnh DROP COLUMN / SET NOT NULL dưới đây GIẢ ĐỊNH 0 hàng. Có hàng ⇒ DỪNG, báo người (DB-13 §4.9) —
-- WO migration KHÔNG tự quyết backfill dữ liệu lương.
DO $$
DECLARE
  t      text;
  v_n    bigint;
  v_bad  text := '';
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  FOREACH t IN ARRAY ARRAY['salary_profiles', 'payroll_periods', 'payslips',
                           'payslip_items', 'bonus_penalties', 'payslip_acknowledgements'] LOOP
    EXECUTE format('SELECT count(*) FROM %I', t) INTO v_n;
    IF v_n <> 0 THEN
      v_bad := v_bad || format('%s=%s ', t, v_n);
    END IF;
  END LOOP;

  IF v_bad <> '' THEN
    RAISE EXCEPTION '[0564] DUNG: bang luong di san CO DU LIEU (%) — moi lenh GO cot gia dinh 0 hang. '
                    'Bao nguoi, KHONG tu quyet backfill (DB-13 §4.9).', v_bad;
  END IF;

  -- attendance_periods phải có UNIQUE (company_id, id) làm đích composite FK. Đo 2026-09-01: ĐÃ CÓ (0535:585).
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.conrelid = 'attendance_periods'::regclass AND c.contype = 'u'
     AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
           WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['company_id', 'id']::text[];
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0564] attendance_periods thieu UNIQUE (company_id, id) (dem duoc %) — composite FK khong tao duoc', v_n;
  END IF;

  RAISE NOTICE '[0564] guard OK: 6 bang luong = 0 hang; attendance_periods co UNIQUE (company_id, id)';
END;
$$;
--> statement-breakpoint

-- ─────────────── (2) DROP 3 TRIGGER + 3 FUNCTION di sản (DB-13 §5, rủi ro #2 §11) ───────────────
-- Cả ba ép FSM CŨ (chữ thường) ⇒ giữ lại là chặn oan MỌI chuyển tiếp mới. FSM 7 trạng thái ép ở service (§4.4).
-- Nhánh BẤT BIẾN TIỀN của `bonus_penalty_guard` được dựng lại HẸP ở khối (7g) — KHÔNG gỡ trắng.
DROP TRIGGER IF EXISTS payroll_period_status_guard ON payroll_periods;
--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_payroll_period_status();
--> statement-breakpoint
DROP TRIGGER IF EXISTS bonus_penalty_guard ON bonus_penalties;
--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_bonus_penalty_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS payslip_ack_status_guard ON payslip_acknowledgements;
--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_payslip_ack_status();
--> statement-breakpoint

-- ════════════════════════════════ (3) salary_profiles (DB-13 §5.1 · §6.2) ════════════════════════════════
-- GỠ 4 cột + 3 CHECK. ⚠️ DROP COLUMN status cũng GIẾT `salary_profiles_company_user_active_uq`
-- (partial index có predicate `status = 'active'`) TRONG IM LẶNG — liệt kê tường minh ở đây
-- (drop-column-silently-drops-check), thay bằng unique versioned theo effective_date.
ALTER TABLE salary_profiles DROP CONSTRAINT IF EXISTS salary_profile_type_check;
--> statement-breakpoint
ALTER TABLE salary_profiles DROP CONSTRAINT IF EXISTS salary_profile_pay_cycle_check;
--> statement-breakpoint
ALTER TABLE salary_profiles DROP CONSTRAINT IF EXISTS salary_profile_status_check;
--> statement-breakpoint
DROP INDEX IF EXISTS salary_profiles_company_user_active_uq;
--> statement-breakpoint
ALTER TABLE salary_profiles
  DROP COLUMN salary_type,
  DROP COLUMN pay_cycle,
  DROP COLUMN currency,
  DROP COLUMN status;
--> statement-breakpoint
-- Vết người thao tác — bảng crown-jewel trước nay KHÔNG có (DB-13 §5.1).
ALTER TABLE salary_profiles
  ADD COLUMN created_by uuid,
  ADD COLUMN updated_by uuid,
  ADD COLUMN deleted_by uuid;
--> statement-breakpoint
-- P2: user_id CASCADE → NO ACTION, đổi CẢ HAI vế. Trộn CASCADE (đơn cột) + NO ACTION (composite) trên cùng cặp
-- bảng là bẫy thứ-tự-trigger RI. DROP + ADD giữ NGUYÊN TÊN ⇒ census FK đơn cột không tụt.
ALTER TABLE salary_profiles DROP CONSTRAINT salary_profiles_user_id_fkey;
--> statement-breakpoint
ALTER TABLE salary_profiles DROP CONSTRAINT salary_profiles_user_id_company_fk;
--> statement-breakpoint
ALTER TABLE salary_profiles
  ADD CONSTRAINT salary_profiles_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE NO ACTION,
  ADD CONSTRAINT salary_profiles_user_id_company_fk FOREIGN KEY (company_id, user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT salary_profiles_created_by_company_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT salary_profiles_updated_by_company_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT salary_profiles_deleted_by_company_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
-- Versioned: một phiên bản / ngày hiệu lực. Chốt cuối PAYROLL-ERR-014.
CREATE UNIQUE INDEX salary_profiles_company_user_effective_uq
  ON salary_profiles (company_id, user_id, effective_date) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- ════════════════════════════════ (4) payroll_periods (DB-13 §5.2 · §6.3) ════════════════════════════════
ALTER TABLE payroll_periods DROP COLUMN kpi_locked;
--> statement-breakpoint
-- FSM 7 trạng thái PascalCase (SPEC-01 §17.15). DB chỉ CHECK TẬP GIÁ TRỊ — chuyển tiếp ép ở service
-- (`assertPeriodTransition`, SPEC-11 §13.1); CHECK không so được OLD/NEW (check-cannot-enforce-fsm-transitions).
ALTER TABLE payroll_periods DROP CONSTRAINT payroll_periods_status_check;
--> statement-breakpoint
ALTER TABLE payroll_periods ALTER COLUMN status SET DEFAULT 'Draft';
--> statement-breakpoint
ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_status_check
  CHECK (status IN ('Draft', 'CollectingData', 'Calculated', 'Reviewing', 'Approved', 'Paid', 'Locked'));
--> statement-breakpoint
ALTER TABLE payroll_periods DROP CONSTRAINT payroll_periods_approved_pair_check;
--> statement-breakpoint
ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_approved_pair_check
  CHECK (status NOT IN ('Approved', 'Paid', 'Locked')
         OR (approved_by IS NOT NULL AND approved_at IS NOT NULL));
--> statement-breakpoint
ALTER TABLE payroll_periods DROP CONSTRAINT payroll_periods_published_pair_check;
--> statement-breakpoint
ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_published_pair_check
  CHECK (status NOT IN ('Paid', 'Locked')
         OR (published_by IS NOT NULL AND published_at IS NOT NULL
             AND approved_by IS NOT NULL AND approved_at IS NOT NULL));
--> statement-breakpoint
-- Vết đầy đủ vòng đời 7 trạng thái + cờ đã-sinh-phiếu (đọc DƯỚI ROW-LOCK — SPEC-11 §13.1; KHÔNG đếm bảng
-- payslips vì bảng khác không được row-lock của hàng kỳ bảo vệ).
ALTER TABLE payroll_periods
  ADD COLUMN pay_date               date,
  ADD COLUMN note                   text,
  ADD COLUMN reopen_reason          text,
  ADD COLUMN updated_by             uuid,
  ADD COLUMN calculated_by          uuid,
  ADD COLUMN calculated_at          timestamptz,
  ADD COLUMN submitted_by           uuid,
  ADD COLUMN submitted_at           timestamptz,
  ADD COLUMN locked_by              uuid,
  ADD COLUMN locked_at              timestamptz,
  ADD COLUMN payslips_generated_by  uuid,
  ADD COLUMN payslips_generated_at  timestamptz;
--> statement-breakpoint
-- B3: attendance_period_id SET NULL → NO ACTION (cả hai vế). CHECK calculated_needs_attendance dưới đây đòi cột
-- NOT NULL khi kỳ rời Draft/CollectingData ⇒ RI SET NULL trong cascade sẽ đẻ 23514 giữa lượt xoá.
ALTER TABLE payroll_periods DROP CONSTRAINT payroll_periods_attendance_period_id_fkey;
--> statement-breakpoint
ALTER TABLE payroll_periods DROP CONSTRAINT payroll_periods_attendance_period_id_company_fk;
--> statement-breakpoint
ALTER TABLE payroll_periods
  ADD CONSTRAINT payroll_periods_attendance_period_id_fkey FOREIGN KEY (attendance_period_id)
    REFERENCES attendance_periods (id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_periods_attendance_period_id_company_fk FOREIGN KEY (company_id, attendance_period_id)
    REFERENCES attendance_periods (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_periods_updated_by_company_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT payroll_periods_calculated_by_company_fk FOREIGN KEY (company_id, calculated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (calculated_by),
  ADD CONSTRAINT payroll_periods_submitted_by_company_fk FOREIGN KEY (company_id, submitted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (submitted_by),
  ADD CONSTRAINT payroll_periods_locked_by_company_fk FOREIGN KEY (company_id, locked_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (locked_by),
  ADD CONSTRAINT payroll_periods_payslips_generated_by_company_fk FOREIGN KEY (company_id, payslips_generated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (payslips_generated_by);
--> statement-breakpoint
-- Chốt cuối four-eyes (PAY-DEC-007): service là tầng chính (PAYROLL-ERR-005), DB là lưới an toàn khoá cả
-- super-admin. ⚠️ reopen/reject PHẢI xoá vết duyệt cũ theo bảng RESET SPEC-11 §13.1, kẻo A duyệt → reopen →
-- A gửi duyệt lại là 23514 = 500 ở vùng đỏ (four-eyes-check-needs-trail-reset).
ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_four_eyes_check
  CHECK (approved_by IS NULL OR submitted_by IS NULL OR approved_by <> submitted_by);
--> statement-breakpoint
-- ⚠️ CẶP BẮT BUỘC của four_eyes_check — KHÔNG được tách khỏi nhau.
-- `four_eyes_check` có vế `submitted_by IS NULL OR …` (bắt buộc, vì bảng RESET SPEC-11 §13.1 xoá `submitted_*`
-- khi reject/reopen). Một mình nó ⇒ chỉ cần ĐỂ `submitted_by` NULL là four-eyes VÔ HIỆU: ghi thẳng kỳ
-- `Approved` với approved_by = người tính, CHECK vẫn xanh. CHECK dưới đây đóng lối thoát đó bằng cách đòi
-- `submitted_by` phải có mặt từ `Reviewing` trở đi (security-reviewer S13-PAYROLL-DB-1, HIGH-2).
-- Tương thích bảng RESET: `reject` hạ về `Calculated`, `reopen` hạ về `CollectingData` — cả hai NGOÀI danh
-- sách nên xoá `submitted_*` cùng lệnh là hợp lệ; `approve`/`publish`/`lock` đều giữ nguyên `submitted_*`.
ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_submitted_pair_check
  CHECK (status NOT IN ('Reviewing', 'Approved', 'Paid', 'Locked')
         OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL));
--> statement-breakpoint
ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_locked_pair_check
  CHECK (status <> 'Locked' OR (locked_by IS NOT NULL AND locked_at IS NOT NULL));
--> statement-breakpoint
ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_calculated_needs_attendance_check
  CHECK (status IN ('Draft', 'CollectingData') OR attendance_period_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_generated_pair_check
  CHECK ((payslips_generated_by IS NULL) = (payslips_generated_at IS NULL));
--> statement-breakpoint

-- ════════════════════════════════ (5) payslips (DB-13 §5.3 · §6.5) — GIỮ KHUÔN APPEND-ONLY ════════════════
-- v1 KHÔNG có đường tạo adjustment/void (SPEC-11 §3.4, §22g) — sai sót sau phát hành xử lý bằng thưởng/phạt
-- kỳ SAU. ⚠️ DROP COLUMN entry_kind giết `payslips_period_user_original_uq` (predicate entry_kind='original')
-- và CHECK chain/entry_kind — GỠ TƯỜNG MINH ở đây rồi dựng lại unique THẲNG (mạnh hơn partial).
ALTER TABLE payslips DROP CONSTRAINT payslips_entry_kind_check;
--> statement-breakpoint
ALTER TABLE payslips DROP CONSTRAINT payslips_chain_check;
--> statement-breakpoint
DROP INDEX IF EXISTS payslips_period_user_original_uq;
--> statement-breakpoint
DROP INDEX IF EXISTS payslips_replaces_uq;
--> statement-breakpoint
-- replaces_payslip_id mang FK đơn cột + composite ⇒ cả hai chết theo DROP COLUMN (plan §0.4 — tính vào −4 sàn).
ALTER TABLE payslips
  DROP COLUMN entry_kind,
  DROP COLUMN replaces_payslip_id,
  DROP COLUMN kpi_amount,
  DROP COLUMN currency;
--> statement-breakpoint
-- Hết vai trò "slot nullable" của G8-4: bonus/penalty là số thật, mặc định 0.
ALTER TABLE payslips
  ALTER COLUMN bonus_amount   SET DEFAULT 0,
  ALTER COLUMN penalty_amount SET DEFAULT 0;
--> statement-breakpoint
UPDATE payslips SET bonus_amount = COALESCE(bonus_amount, 0), penalty_amount = COALESCE(penalty_amount, 0);
--> statement-breakpoint
ALTER TABLE payslips
  ALTER COLUMN bonus_amount   SET NOT NULL,
  ALTER COLUMN penalty_amount SET NOT NULL;
--> statement-breakpoint
-- input_snapshot_json: NOT NULL và **KHÔNG DEFAULT** — cặp với CHECK <> '{}' dưới đây. Để DEFAULT '{}' thì mọi
-- INSERT bỏ trống cột đều 23514 (DEFAULT thành giá trị CHẾT). Bảng 0 hàng nên ADD ... NOT NULL chạy được.
-- adjustment_amount CÓ DẤU (dương = truy lĩnh · âm = truy thu), nằm NGOÀI gross/deduction — thiếu cột này thì
-- khoản điều chỉnh tay biến mất hoặc bị cộng hai lần lúc generate-payslips (SPEC-11 §13.4).
ALTER TABLE payslips
  ADD COLUMN deduction_amount    numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN adjustment_amount   numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN paid_leave_days     numeric(8,2)  NOT NULL DEFAULT 0,
  ADD COLUMN unpaid_leave_days   numeric(8,2)  NOT NULL DEFAULT 0,
  ADD COLUMN input_snapshot_json jsonb         NOT NULL;
--> statement-breakpoint
-- DỰNG LẠI có kiểm soát: thêm deduction_amount + net (net clamp về 0 ở SQL ⇒ CHECK khẳng định điều đó).
-- ⚠️ adjustment_amount CỐ Ý ngoài CHECK này — nó có dấu.
ALTER TABLE payslips DROP CONSTRAINT payslips_amounts_check;
--> statement-breakpoint
ALTER TABLE payslips ADD CONSTRAINT payslips_amounts_check
  CHECK (base_salary >= 0 AND total_allowances >= 0 AND deduction_amount >= 0 AND gross >= 0 AND net >= 0);
--> statement-breakpoint
ALTER TABLE payslips ADD CONSTRAINT payslips_snapshot_check
  CHECK (input_snapshot_json <> '{}'::jsonb);
--> statement-breakpoint
-- Chốt cuối chống sinh phiếu HAI LẦN (PAYROLL-ERR-006). Unique THẲNG mạnh hơn partial vừa mất theo entry_kind.
ALTER TABLE payslips ADD CONSTRAINT payslips_period_user_uq
  UNIQUE (company_id, payroll_period_id, user_id);
--> statement-breakpoint

-- ════════════════════════════════ (6) payslip_items (DB-13 §5.4 · §6.6) ════════════════════════════════
ALTER TABLE payslip_items DROP CONSTRAINT payslip_items_type_check;
--> statement-breakpoint
-- Bỏ 'kpi' (ngoài phạm vi sản phẩm), thêm 'adjustment' (đích của payroll_period_lines.adjustment_amount).
ALTER TABLE payslip_items ADD CONSTRAINT payslip_items_type_check
  CHECK (item_type IN ('earning', 'deduction', 'allowance', 'attendance', 'bonus', 'penalty', 'adjustment'));
--> statement-breakpoint
-- Thứ tự hiển thị breakdown không phụ thuộc created_at (now() per-statement làm ties là THẬT).
ALTER TABLE payslip_items ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- P3: CASCADE → NO ACTION cả hai vế. payslips không bao giờ bị xoá; CASCADE là đường xoá ẩn trên bảng chỉ-INSERT.
ALTER TABLE payslip_items DROP CONSTRAINT payslip_items_payslip_id_fkey;
--> statement-breakpoint
ALTER TABLE payslip_items DROP CONSTRAINT payslip_items_payslip_id_company_fk;
--> statement-breakpoint
ALTER TABLE payslip_items
  ADD CONSTRAINT payslip_items_payslip_id_fkey FOREIGN KEY (payslip_id)
    REFERENCES payslips (id) ON DELETE NO ACTION,
  ADD CONSTRAINT payslip_items_payslip_id_company_fk FOREIGN KEY (company_id, payslip_id)
    REFERENCES payslips (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint

-- ════════════════════════════════ (7) bonus_penalties (DB-13 §5.5 · §6.7) ════════════════════════════════
-- ⚠️ `bonus_penalties_reference_check` CHẾT THEO DROP COLUMN reference_type/task_id/kpi_result_id — GỠ TƯỜNG
-- MINH và **KHÔNG dựng lại** (khác 0548 nơi phải dựng lại vì cột còn). 2 FK đơn cột (task_id, kpi_result_id)
-- + 2 composite tương ứng cũng biến mất ⇒ tính vào −4 của FK_SINGLE_COL_PAIRS_FLOOR (plan §0.4).
ALTER TABLE bonus_penalties DROP CONSTRAINT bonus_penalties_source_check;
--> statement-breakpoint
ALTER TABLE bonus_penalties DROP CONSTRAINT bonus_penalties_reference_check;
--> statement-breakpoint
ALTER TABLE bonus_penalties
  DROP COLUMN source,
  DROP COLUMN reference_type,
  DROP COLUMN task_id,
  DROP COLUMN kpi_result_id,
  DROP COLUMN currency;
--> statement-breakpoint
-- Lý do BẮT BUỘC (PL-02). 0 hàng nên không cần backfill.
ALTER TABLE bonus_penalties ALTER COLUMN reason SET NOT NULL;
--> statement-breakpoint
-- Một cặp cột phục vụ CẢ duyệt lẫn từ chối.
ALTER TABLE bonus_penalties RENAME COLUMN approved_by TO decided_by;
--> statement-breakpoint
ALTER TABLE bonus_penalties RENAME COLUMN approved_at TO decided_at;
--> statement-breakpoint
-- Tên index/constraint phải nói THẬT về cột sau RENAME (kẻo tên nói dối cột).
ALTER INDEX bonus_penalties_approved_by_idx RENAME TO bonus_penalties_decided_by_idx;
--> statement-breakpoint
ALTER TABLE bonus_penalties DROP CONSTRAINT bonus_penalties_status_check;
--> statement-breakpoint
ALTER TABLE bonus_penalties ALTER COLUMN status SET DEFAULT 'Pending';
--> statement-breakpoint
ALTER TABLE bonus_penalties ADD CONSTRAINT bonus_penalties_status_check
  CHECK (status IN ('Pending', 'Approved', 'Rejected'));
--> statement-breakpoint
ALTER TABLE bonus_penalties DROP CONSTRAINT bonus_penalties_approved_pair_check;
--> statement-breakpoint
ALTER TABLE bonus_penalties ADD CONSTRAINT bonus_penalties_decided_pair_check
  CHECK (status = 'Pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL));
--> statement-breakpoint
ALTER TABLE bonus_penalties DROP CONSTRAINT bonus_penalties_consume_approved_check;
--> statement-breakpoint
ALTER TABLE bonus_penalties ADD CONSTRAINT bonus_penalties_consume_approved_check
  CHECK (payroll_period_id IS NULL OR status = 'Approved');
--> statement-breakpoint
ALTER TABLE bonus_penalties
  ADD COLUMN decision_note text,
  ADD COLUMN updated_by    uuid,
  ADD COLUMN deleted_by    uuid;
--> statement-breakpoint
ALTER TABLE bonus_penalties ADD CONSTRAINT bonus_penalties_reject_note_check
  CHECK (status <> 'Rejected' OR decision_note IS NOT NULL);
--> statement-breakpoint
-- P4: decided_by RESTRICT → SET NULL (col), đổi tên constraint theo cột mới.
-- B2: payroll_period_id SET NULL → NO ACTION — nhả consume phải đi qua service để consumed_at cùng về NULL,
--     kẻo RI null một vế và vỡ bonus_penalties_consumed_pair_check (23514) giữa cascade.
ALTER TABLE bonus_penalties DROP CONSTRAINT bonus_penalties_approved_by_fkey;
--> statement-breakpoint
ALTER TABLE bonus_penalties DROP CONSTRAINT bonus_penalties_approved_by_company_fk;
--> statement-breakpoint
ALTER TABLE bonus_penalties DROP CONSTRAINT bonus_penalties_payroll_period_id_fkey;
--> statement-breakpoint
ALTER TABLE bonus_penalties DROP CONSTRAINT bonus_penalties_payroll_period_id_company_fk;
--> statement-breakpoint
ALTER TABLE bonus_penalties
  ADD CONSTRAINT bonus_penalties_decided_by_fkey FOREIGN KEY (decided_by)
    REFERENCES users (id) ON DELETE SET NULL,
  ADD CONSTRAINT bonus_penalties_decided_by_company_fk FOREIGN KEY (company_id, decided_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (decided_by),
  ADD CONSTRAINT bonus_penalties_payroll_period_id_fkey FOREIGN KEY (payroll_period_id)
    REFERENCES payroll_periods (id) ON DELETE NO ACTION,
  ADD CONSTRAINT bonus_penalties_payroll_period_id_company_fk FOREIGN KEY (company_id, payroll_period_id)
    REFERENCES payroll_periods (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT bonus_penalties_updated_by_company_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT bonus_penalties_deleted_by_company_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
-- Đích của composite FK từ payroll_period_lines (bảng duy nhất còn thiếu — 5 bảng kia đã có từ 0535).
ALTER TABLE bonus_penalties ADD CONSTRAINT bonus_penalties_company_id_id_uq UNIQUE (company_id, id);
--> statement-breakpoint

-- ─────────────── (7g) Trigger HẸP thay `bonus_penalty_guard` — BA nhánh bất biến tiền (plan §8.1) ───────────────
-- Bản cũ (0098:110-149) có BỐN nhánh, tất cả là lớp DB DUY NHẤT so được OLD/NEW (CHECK không làm được)
-- ⇒ gỡ trắng bất kỳ nhánh nào là mất bất biến tiền TRONG IM LẶNG. Nhánh (1) của bản cũ làm HAI việc: ép FSM
-- chữ thường (phải bỏ — chặn oan hàng PascalCase) VÀ ép tính TERMINAL (phải giữ) ⇒ tách ra thành nhánh (E).
--   (A) đóng băng field tiền/lý do/VẾT NGƯỜI QUYẾT ĐỊNH sau khi rời Pending HOẶC đã consume
--   (B) cấm xoá mềm sau khi rời Pending HOẶC đã consume            [nhánh 2b của 0098]
--   (C) cấm RE-BIND payroll_period_id sang kỳ KHÁC sau khi consume [nhánh 3 của 0098]
--       ⇒ CHO PHÉP x → NULL (nhả consume khi tính lại kỳ chưa Approved — SPEC-11 §13.3)
--       ⇒ CẤM      x → y  (y ≠ x, y NOT NULL)
--   (D) câu lệnh DUYỆT (Pending → khác) không được kèm sửa tiền — điều kiện OLD.status <> 'Pending' của (A)
--       một mình cho phép UPDATE vừa duyệt vừa đổi amount.
--   (E) TERMINAL: rời Pending rồi thì KHÔNG đổi status nữa  [= nhánh (1) của 0098, DỰNG LẠI]
--       — thiếu (E) thì `Approved → Pending → sửa tiền → duyệt lại` gỡ băng được toàn bộ (A).
-- KHÔNG nhánh nào ép chuyển tiếp FSM (PAYROLL-ERR-011/012/013 là việc của service).
-- ⚠️ Cột NULLABLE dùng IS DISTINCT FROM: `<>` với một vế NULL trả NULL ⇒ không bao giờ true ⇒ sửa
--    decision_note trên hàng đã duyệt sẽ lọt im lặng.
-- Trigger HẸP (không đóng băng cả bảng) nên không dính bẫy frozen-table-triggers-break-db-init.
CREATE OR REPLACE FUNCTION enforce_bonus_penalty_freeze()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_frozen boolean := (OLD.status <> 'Pending' OR OLD.payroll_period_id IS NOT NULL);
BEGIN
  -- (A) đóng băng field tiền + lý do + VẾT NGƯỜI QUYẾT ĐỊNH
  -- ⚠️ `decided_by`/`decided_at` NẰM TRONG danh sách này — trigger di sản 0098 KHÔNG đóng băng
  --    `approved_by`/`approved_at`, tức sau khi duyệt vẫn có thể GÁN LẠI ai là người duyệt một khoản tiền
  --    trong im lặng. Đó là lỗ trong chính câu chuyện "DB là lưới an toàn của four-eyes" mà file này khẳng
  --    định; wave rewrite trigger là dịp đóng, nên đóng (database-reviewer S13-PAYROLL-DB-1, MEDIUM-1).
  --    An toàn với đường hợp lệ: CHECK bonus_penalties_consume_approved_check cấm hàng `Pending` được consume
  --    ⇒ hàng Pending LUÔN có v_frozen = false ⇒ chính câu lệnh DUYỆT (Pending → Approved/Rejected, ghi
  --    decided_*) không bao giờ vào nhánh này. FSM §13.3 cho hai đích là TERMINAL nên không có đường un-decide.
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
      'bonus_penalty_freeze_guard: % (id=%, ky %) da roi Pending hoac da consume — cam sua field tien/ly do/vet quyet dinh',
      OLD.kind, OLD.id, OLD.period_month
      USING ERRCODE = 'check_violation';
  END IF;

  -- (B) cấm xoá mềm sau khi rời Pending / đã consume
  IF v_frozen AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION
      'bonus_penalty_freeze_guard: % (id=%, ky %) da roi Pending hoac da consume — cam xoa mem',
      OLD.kind, OLD.id, OLD.period_month
      USING ERRCODE = 'check_violation';
  END IF;

  -- (C) cấm re-bind sang kỳ KHÁC; vẫn cho nhả consume về NULL
  IF OLD.payroll_period_id IS NOT NULL
     AND NEW.payroll_period_id IS DISTINCT FROM OLD.payroll_period_id
     AND NEW.payroll_period_id IS NOT NULL THEN
    RAISE EXCEPTION
      'bonus_penalty_freeze_guard: % (id=%, ky %) da consume ky luong — cam re-bind sang ky khac',
      OLD.kind, OLD.id, OLD.period_month
      USING ERRCODE = 'check_violation';
  END IF;

  -- (D) câu lệnh duyệt/từ chối không được kèm sửa tiền (decided_*/decision_note vẫn ghi được)
  IF OLD.status = 'Pending' AND NEW.status IS DISTINCT FROM OLD.status AND (
       NEW.amount       IS DISTINCT FROM OLD.amount
    OR NEW.kind         IS DISTINCT FROM OLD.kind
    OR NEW.user_id      IS DISTINCT FROM OLD.user_id
    OR NEW.period_month IS DISTINCT FROM OLD.period_month
    OR NEW.reason       IS DISTINCT FROM OLD.reason
  ) THEN
    RAISE EXCEPTION
      'bonus_penalty_freeze_guard: % (id=%, ky %) — cam vua doi status vua sua field tien trong cung mot lenh',
      OLD.kind, OLD.id, OLD.period_month
      USING ERRCODE = 'check_violation';
  END IF;

  -- (E) TERMINAL: rời `Pending` rồi thì KHÔNG đổi `status` nữa.
  -- ⚠️ ĐÂY LÀ NHÁNH (1) CỦA TRIGGER DI SẢN, DỰNG LẠI. Bản đầu của migration này gỡ trắng nhánh (1) vì tưởng
  --    nó CHỈ ép FSM chữ thường `draft→approved/rejected`. Sai: nó làm HAI việc, và việc thứ hai — ép tính
  --    TERMINAL — là cái NEO giữ cho các nhánh đóng băng tiền không bị vòng qua. Không có (E), chuỗi ba lệnh
  --    sau gỡ băng hoàn toàn một khoản đã duyệt:
  --      1. UPDATE … SET status='Pending'      → (A) không kể `status`; (D) đòi OLD.status='Pending' ⇒ lọt.
  --                                               CHECK decided_pair cũng cho qua vì vế `status='Pending'`.
  --      2. UPDATE … SET amount=99999999       → giờ OLD.status='Pending' ⇒ v_frozen=false ⇒ lọt.
  --      3. duyệt lại.
  --    (security-reviewer S13-PAYROLL-DB-1, HIGH-1.)
  --    KHÔNG mâu thuẫn `check-cannot-enforce-fsm-transitions`: (E) không ép ĐỒ THỊ chuyển tiếp (việc của
  --    service, PAYROLL-ERR-011/012/013) — nó chỉ ép một BẤT BIẾN mà CHECK không diễn đạt được vì cần so
  --    OLD/NEW. SPEC-11 §13.3: `Pending → Approved | Rejected`, hai đích là TERMINAL, không có đường un-decide.
  IF OLD.status <> 'Pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION
      'bonus_penalty_freeze_guard: % (id=%, ky %) da o trang thai TERMINAL % — cam doi status',
      OLD.kind, OLD.id, OLD.period_month, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bonus_penalty_freeze_guard
  BEFORE UPDATE ON bonus_penalties
  FOR EACH ROW EXECUTE FUNCTION enforce_bonus_penalty_freeze();
--> statement-breakpoint

-- ════════════════════ (8) payslip_acknowledgements (DB-13 §5.6 · §6.8) — VỀ SỔ CHỈ-INSERT ════════════════
-- Khiếu nại (disputed/resolved) NGOÀI phạm vi v1 (SPEC-11 §5.2, §22f) — mở lại cùng PARK-PAYROLL-001. Giữ 5 cột
-- + 3 CHECK mà không route nào ghi = cột ghi-rồi-bỏ (write-only-column-means-delete-not-wire-up).
-- Hàng tồn tại = đã xác nhận. resolved_by mang FK đơn cột + composite ⇒ cả hai chết theo (tính vào −4 sàn).
ALTER TABLE payslip_acknowledgements DROP CONSTRAINT payslip_ack_status_check;
--> statement-breakpoint
ALTER TABLE payslip_acknowledgements DROP CONSTRAINT payslip_ack_dispute_reason_check;
--> statement-breakpoint
ALTER TABLE payslip_acknowledgements DROP CONSTRAINT payslip_ack_resolved_pair_check;
--> statement-breakpoint
ALTER TABLE payslip_acknowledgements
  DROP COLUMN status,
  DROP COLUMN reason,
  DROP COLUMN resolved_by,
  DROP COLUMN resolved_at,
  DROP COLUMN resolution_note,
  DROP COLUMN updated_at;
--> statement-breakpoint
-- UPDATE chỉ tồn tại để phục vụ đường khiếu nại vừa gỡ ⇒ về đúng khuôn sổ chỉ-INSERT (bất biến #2).
-- Đo 2026-09-01: 0 column-GRANT trên bảng này ⇒ REVOKE cấp bảng không xoá nhầm gì
-- (revoke-table-grant-wipes-column-grants); verify bằng aclexplode ở khối (11).
REVOKE UPDATE ON payslip_acknowledgements FROM mediaos_app;
--> statement-breakpoint

-- ════════════════ (9) payroll_period_lines — BẢNG MỚI DUY NHẤT của wave (DB-13 §3.1 · §6.4) ════════════════
-- Bảng lương NHÁP, mutable trước Approved. Bắt buộc kỹ thuật để `payslips` giữ được khuôn append-only mà bảng
-- lương vẫn tính lại được (SPEC-11 §3.4, §22a). KHÔNG đẻ bảng thứ tám kiểu payroll_period_inputs — snapshot đầu
-- vào là cột input_snapshot_json trên chính dòng nháp và trên payslips.
CREATE TABLE payroll_period_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL DEFAULT (NULLIF(current_setting('app.current_company_id', true), ''))::uuid
                        REFERENCES companies (id) ON DELETE CASCADE,
  payroll_period_id   uuid NOT NULL,
  user_id             uuid NOT NULL,
  salary_profile_id   uuid,
  work_days           numeric(8,2)  NOT NULL DEFAULT 0,
  present_days        numeric(8,2)  NOT NULL DEFAULT 0,
  paid_leave_days     numeric(8,2)  NOT NULL DEFAULT 0,
  unpaid_leave_days   numeric(8,2)  NOT NULL DEFAULT 0,
  late_minutes        integer       NOT NULL DEFAULT 0,
  input_snapshot_json jsonb         NOT NULL,
  base_amount         numeric(18,2) NOT NULL DEFAULT 0,
  allowance_amount    numeric(18,2) NOT NULL DEFAULT 0,
  bonus_amount        numeric(18,2) NOT NULL DEFAULT 0,
  penalty_amount      numeric(18,2) NOT NULL DEFAULT 0,
  deduction_amount    numeric(18,2) NOT NULL DEFAULT 0,
  adjustment_amount   numeric(18,2) NOT NULL DEFAULT 0,
  adjustment_reason   text,
  gross               numeric(18,2) NOT NULL DEFAULT 0,
  net                 numeric(18,2) NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,
  deleted_at          timestamptz,
  deleted_by          uuid,
  -- ⚠️ adjustment_amount CỐ Ý ngoài CHECK này — nó CÓ DẤU (dương = truy lĩnh · âm = truy thu), nằm NGOÀI
  --    gross/deduction. net = GREATEST(gross − deduction_amount + adjustment_amount, 0), clamp ở SQL.
  CONSTRAINT payroll_period_lines_amounts_check CHECK (
    base_amount >= 0 AND allowance_amount >= 0 AND bonus_amount >= 0
    AND penalty_amount >= 0 AND deduction_amount >= 0 AND gross >= 0 AND net >= 0),
  CONSTRAINT payroll_period_lines_adjustment_check CHECK (
    adjustment_amount = 0 OR adjustment_reason IS NOT NULL),
  CONSTRAINT payroll_period_lines_snapshot_check CHECK (input_snapshot_json <> '{}'::jsonb),
  CONSTRAINT payroll_period_lines_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
-- BẤT BIẾN #1: RLS + FORCE + policy TRƯỚC mọi INSERT (khuôn literal-GUC 0549/0559).
ALTER TABLE payroll_period_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_period_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON payroll_period_lines;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payroll_period_lines
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- Composite THUẦN (0 FK đơn cột ngoài company_id → companies) — điều kiện để census FK không cộng thêm.
ALTER TABLE payroll_period_lines
  ADD CONSTRAINT payroll_period_lines_payroll_period_id_company_fk FOREIGN KEY (company_id, payroll_period_id)
    REFERENCES payroll_periods (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_period_lines_user_id_company_fk FOREIGN KEY (company_id, user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_period_lines_salary_profile_id_company_fk FOREIGN KEY (company_id, salary_profile_id)
    REFERENCES salary_profiles (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT payroll_period_lines_created_by_company_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT payroll_period_lines_updated_by_company_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT payroll_period_lines_deleted_by_company_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
-- PARTIAL unique: tính lại = upsert + xoá mềm dòng không còn đủ điều kiện; unique THẲNG sẽ nổ 23505 ở lần tính
-- thứ hai. ⚠️ Mọi JOIN dòng nháp phải lọc deleted_at IS NULL (partial-unique-index-makes-join-duplicate).
CREATE UNIQUE INDEX payroll_period_lines_period_user_uq
  ON payroll_period_lines (company_id, payroll_period_id, user_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX payroll_period_lines_company_period_idx
  ON payroll_period_lines (company_id, payroll_period_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX payroll_period_lines_company_user_idx
  ON payroll_period_lines (company_id, user_id);
--> statement-breakpoint
-- KHÔNG GRANT mediaos_worker: PAYROLL v1 không có system job đọc bảng lương (P7). KHÔNG DELETE.
GRANT SELECT, INSERT, UPDATE ON payroll_period_lines TO mediaos_app;
--> statement-breakpoint

-- ─────────────── (10) THU HỒI SELECT của mediaos_worker trên bảng chở số lương (DB-13 §4.3 · P7) ───────────────
-- Đo 31/08/2026: 0 route, 0 handler, 0 @SystemJobHandler đọc bảng lương ở v1. Quyền đọc trên bảng lương không
-- nên trôi qua nhiều WO. GIỮ worker SELECT trên payroll_periods/bonus_penalties/payslip_acknowledgements
-- (không chứa số lương ở mức chi tiết phiếu; nếu Phase sau có job thì đã sẵn).
REVOKE SELECT ON salary_profiles FROM mediaos_worker;
--> statement-breakpoint
REVOKE SELECT ON payslips FROM mediaos_worker;
--> statement-breakpoint
REVOKE SELECT ON payslip_items FROM mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════ (11) VERIFY FAIL-LOUD (khuôn 0549/0559) ════════════════════════════════
DO $$
DECLARE
  v_tables CONSTANT text[] := ARRAY['salary_profiles', 'payroll_periods', 'payroll_period_lines', 'payslips',
                                    'payslip_items', 'bonus_penalties', 'payslip_acknowledgements'];
  t     text;
  r     record;
  v_n   int;
  v_bad text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- (1) RLS ENABLE + FORCE + policy tenant_isolation trên CẢ BẢY bảng (bất biến #1)
  FOREACH t IN ARRAY v_tables LOOP
    SELECT count(*) INTO v_n FROM pg_class
     WHERE oid = t::regclass AND relrowsecurity AND relforcerowsecurity;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0564] verify: % thieu RLS ENABLE hoac FORCE', t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t AND policyname = 'tenant_isolation';
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0564] verify: % thieu policy tenant_isolation (dem duoc %)', t, v_n;
    END IF;
  END LOOP;

  -- (2) APPEND-ONLY (bất biến #2): app 0 UPDATE/DELETE trên 3 sổ chỉ-INSERT — đọc CẢ relacl LẪN attacl
  --     (aclexplode, KHÔNG information_schema.column_privileges — 0540:137).
  FOREACH t IN ARRAY ARRAY['payslips', 'payslip_items', 'payslip_acknowledgements'] LOOP
    SELECT count(*) INTO v_n FROM (
      SELECT x.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
       WHERE c.oid = t::regclass AND x.grantee = 'mediaos_app'::regrole
         AND x.privilege_type IN ('UPDATE', 'DELETE')
      UNION ALL
      SELECT x.privilege_type FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
       WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND x.grantee = 'mediaos_app'::regrole AND x.privilege_type IN ('UPDATE', 'DELETE')
    ) z;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0564] verify: % co % quyen UPDATE/DELETE cho app — pha append-only (bat bien #2)', t, v_n;
    END IF;
  END LOOP;

  -- (2b) KHONG bang PAYROLL nao co DELETE cho app role (soft delete — bất biến #2)
  FOREACH t IN ARRAY v_tables LOOP
    SELECT count(*) INTO v_n FROM (
      SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
       WHERE c.oid = t::regclass AND x.grantee = 'mediaos_app'::regrole AND x.privilege_type = 'DELETE'
      UNION ALL
      SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
       WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND x.grantee = 'mediaos_app'::regrole AND x.privilege_type = 'DELETE'
    ) z;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0564] verify: % co GRANT DELETE cho app role — cam hard-delete du lieu luong', t;
    END IF;
  END LOOP;

  -- (3) WORKER: 0 quyền trên payroll_period_lines + 0 SELECT trên 3 bảng vừa thu hồi; CÒN SELECT trên 3 bảng giữ
  SELECT count(*) INTO v_n FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
   WHERE c.oid = 'payroll_period_lines'::regclass AND x.grantee = 'mediaos_worker'::regrole;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0564] verify: mediaos_worker co % quyen tren payroll_period_lines — phai 0 (P7)', v_n;
  END IF;

  FOREACH t IN ARRAY ARRAY['salary_profiles', 'payslips', 'payslip_items'] LOOP
    SELECT count(*) INTO v_n FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
     WHERE c.oid = t::regclass AND x.grantee = 'mediaos_worker'::regrole AND x.privilege_type = 'SELECT';
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0564] verify: mediaos_worker VAN CON SELECT tren % — buoc (10) that bai', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['payroll_periods', 'bonus_penalties', 'payslip_acknowledgements'] LOOP
    SELECT count(*) INTO v_n FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
     WHERE c.oid = t::regclass AND x.grantee = 'mediaos_worker'::regrole AND x.privilege_type = 'SELECT';
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0564] verify: mediaos_worker MAT SELECT tren % — buoc (10) thu hoi qua tay', t;
    END IF;
  END LOOP;

  -- (4) COMPOSITE FK — DƯƠNG đúng-bằng 30 dòng (plan §8.3, danh sách ĐÓNG). Thiếu/thừa ⇒ đỏ.
  --     Quên hẳn FK thì fk-tenant-census/xtenant-fk-ratchet IM LẶNG (chỉ đếm FK đang tồn tại).
  --     deltype: 'a' = NO ACTION · 'n' = SET NULL. conkey[1] ↔ confkey[1] (company_id), [2] (col ↔ id).
  SELECT string_agg(format('%s.%s -> %s [%s|%s]', d.tbl, d.col, d.tgt, d.del, d.setcols), ' ; ') INTO v_bad
    FROM (
      WITH actual AS (
        SELECT c.conrelid::regclass::text AS tbl,
               (SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[2]) AS col,
               c.confrelid::regclass::text AS tgt,
               c.confdeltype::text AS del,
               COALESCE((SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
                          WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.confdelsetcols)), ARRAY[]::text[]) AS setcols
          FROM pg_constraint c
         WHERE c.contype = 'f'
           AND c.conrelid::regclass::text = ANY (v_tables)
           AND array_length(c.conkey, 1) = 2
           AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) = 'company_id'
           AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[1]) = 'company_id'
           AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[2]) = 'id'
      ), expected (tbl, col, tgt, del, setcols) AS (VALUES
        ('salary_profiles',          'user_id',               'users',              'a', ARRAY[]::text[]),
        ('salary_profiles',          'created_by',            'users',              'n', ARRAY['created_by']),
        ('salary_profiles',          'updated_by',            'users',              'n', ARRAY['updated_by']),
        ('salary_profiles',          'deleted_by',            'users',              'n', ARRAY['deleted_by']),
        ('payroll_periods',          'attendance_period_id',  'attendance_periods', 'a', ARRAY[]::text[]),
        ('payroll_periods',          'created_by',            'users',              'n', ARRAY['created_by']),
        ('payroll_periods',          'updated_by',            'users',              'n', ARRAY['updated_by']),
        ('payroll_periods',          'calculated_by',         'users',              'n', ARRAY['calculated_by']),
        ('payroll_periods',          'submitted_by',          'users',              'n', ARRAY['submitted_by']),
        ('payroll_periods',          'approved_by',           'users',              'n', ARRAY['approved_by']),
        ('payroll_periods',          'published_by',          'users',              'n', ARRAY['published_by']),
        ('payroll_periods',          'locked_by',             'users',              'n', ARRAY['locked_by']),
        ('payroll_periods',          'payslips_generated_by', 'users',              'n', ARRAY['payslips_generated_by']),
        ('payroll_period_lines',     'payroll_period_id',     'payroll_periods',    'a', ARRAY[]::text[]),
        ('payroll_period_lines',     'user_id',               'users',              'a', ARRAY[]::text[]),
        ('payroll_period_lines',     'salary_profile_id',     'salary_profiles',    'a', ARRAY[]::text[]),
        ('payroll_period_lines',     'created_by',            'users',              'n', ARRAY['created_by']),
        ('payroll_period_lines',     'updated_by',            'users',              'n', ARRAY['updated_by']),
        ('payroll_period_lines',     'deleted_by',            'users',              'n', ARRAY['deleted_by']),
        ('payslips',                 'payroll_period_id',     'payroll_periods',    'a', ARRAY[]::text[]),
        ('payslips',                 'user_id',               'users',              'a', ARRAY[]::text[]),
        ('payslips',                 'salary_profile_id',     'salary_profiles',    'a', ARRAY[]::text[]),
        ('payslips',                 'created_by',            'users',              'a', ARRAY[]::text[]),
        ('payslip_items',            'payslip_id',            'payslips',           'a', ARRAY[]::text[]),
        ('bonus_penalties',          'user_id',               'users',              'a', ARRAY[]::text[]),
        ('bonus_penalties',          'created_by',            'users',              'a', ARRAY[]::text[]),
        ('bonus_penalties',          'payroll_period_id',     'payroll_periods',    'a', ARRAY[]::text[]),
        ('bonus_penalties',          'decided_by',            'users',              'n', ARRAY['decided_by']),
        ('bonus_penalties',          'updated_by',            'users',              'n', ARRAY['updated_by']),
        ('bonus_penalties',          'deleted_by',            'users',              'n', ARRAY['deleted_by']),
        ('payslip_acknowledgements', 'payslip_id',            'payslips',           'a', ARRAY[]::text[]),
        ('payslip_acknowledgements', 'user_id',               'users',              'a', ARRAY[]::text[])
      )
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) d;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0564] verify: composite FK LECH so voi danh sach dong (thieu/thua): %', v_bad;
  END IF;

  -- (4a) Đếm thô FK ≥2 cột — bộ lọc "đúng hình dạng" ở (4) RỚT FK lệch hình dạng khỏi cả hai vế EXCEPT
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY (v_tables) AND array_length(c.conkey, 1) >= 2;
  IF v_n <> 32 THEN
    RAISE EXCEPTION '[0564] verify: co % FK >= 2 cot tren 7 bang payroll, ky vong dung 32 — co FK lech hinh dang', v_n;
  END IF;

  -- (4b) payroll_period_lines phải là composite THUẦN: 0 FK một-cột tới bảng ≠ companies.
  --      Đây là điều kiện để hiệu census FK đơn cột đúng bằng −4 (plan §0.4 · §8.3).
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.conrelid = 'payroll_period_lines'::regclass
     AND array_length(c.conkey, 1) = 1 AND c.confrelid <> 'companies'::regclass;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0564] verify: payroll_period_lines con % FK MOT COT toi bang khac companies', v_n;
  END IF;

  -- (5) 20 CỘT đã biến mất (DB-13 §5.7). Đếm thẳng trên pg_attribute — DROP COLUMN im lặng là lớp lỗi chính.
  SELECT string_agg(format('%s.%s', d.tbl, d.col), ', ') INTO v_bad
    FROM (VALUES
      ('salary_profiles', 'salary_type'), ('salary_profiles', 'pay_cycle'),
      ('salary_profiles', 'currency'), ('salary_profiles', 'status'),
      ('payroll_periods', 'kpi_locked'),
      ('payslips', 'entry_kind'), ('payslips', 'replaces_payslip_id'),
      ('payslips', 'kpi_amount'), ('payslips', 'currency'),
      ('bonus_penalties', 'source'), ('bonus_penalties', 'reference_type'),
      ('bonus_penalties', 'task_id'), ('bonus_penalties', 'kpi_result_id'), ('bonus_penalties', 'currency'),
      ('payslip_acknowledgements', 'status'), ('payslip_acknowledgements', 'reason'),
      ('payslip_acknowledgements', 'resolved_by'), ('payslip_acknowledgements', 'resolved_at'),
      ('payslip_acknowledgements', 'resolution_note'), ('payslip_acknowledgements', 'updated_at')
    ) AS d(tbl, col)
   WHERE EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = d.tbl::regclass AND a.attname = d.col
                    AND a.attnum > 0 AND NOT a.attisdropped);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0564] verify: cot le ra phai bien mat VAN CON: %', v_bad;
  END IF;

  -- (6) 3 TRIGGER di sản đã biến mất VÀ trigger hẹp đã tồn tại (không gỡ trắng bất biến tiền)
  SELECT count(*) INTO v_n
    FROM pg_trigger t
   WHERE NOT t.tgisinternal
     AND t.tgname IN ('payroll_period_status_guard', 'bonus_penalty_guard', 'payslip_ack_status_guard');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0564] verify: con % trigger FSM di san — se chan oan moi chuyen tiep moi', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal AND c.relname = 'bonus_penalties' AND t.tgname = 'bonus_penalty_freeze_guard';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0564] verify: thieu trigger hep bonus_penalty_freeze_guard — mat bat bien tien trong im lang';
  END IF;

  -- (7) UNIQUE (company_id, id) trên 6 bảng ĐÍCH của composite FK nội bộ
  FOREACH t IN ARRAY ARRAY['salary_profiles', 'payroll_periods', 'payroll_period_lines',
                           'payslips', 'bonus_penalties'] LOOP
    SELECT count(*) INTO v_n
      FROM pg_constraint c
     WHERE c.conrelid = t::regclass AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['company_id', 'id']::text[];
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0564] verify: % thieu UNIQUE (company_id, id) (dem duoc %)', t, v_n;
    END IF;
  END LOOP;

  -- (8) INDEX unique: so ĐÚNG CHUỖI pg_get_expr của predicate (không ILIKE '%WHERE%' — khuôn 0549 B3)
  FOR r IN SELECT * FROM (VALUES
      ('salary_profiles_company_user_effective_uq',  '(deleted_at IS NULL)'),
      ('payroll_period_lines_period_user_uq',        '(deleted_at IS NULL)'),
      ('payroll_period_lines_company_period_idx',    '(deleted_at IS NULL)')
    ) AS x(idx, pred)
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_class ic JOIN pg_index i ON i.indexrelid = ic.oid
     WHERE ic.relname = r.idx
       AND COALESCE(pg_get_expr(i.indpred, i.indrelid), '') = r.pred;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0564] verify: index % thieu hoac sai predicate (ky vong %)', r.idx, r.pred;
    END IF;
  END LOOP;

  -- (8b) payslips_period_user_uq phải là UNIQUE THẲNG (không predicate) — chốt cuối sinh phiếu hai lần
  SELECT count(*) INTO v_n
    FROM pg_class ic JOIN pg_index i ON i.indexrelid = ic.oid
   WHERE ic.relname = 'payslips_period_user_uq' AND i.indisunique AND i.indpred IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0564] verify: payslips_period_user_uq thieu hoac van la partial — khong chan duoc sinh phieu 2 lan';
  END IF;

  -- (9) Tên index nói THẬT về cột sau RENAME
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bonus_penalties_decided_by_idx') THEN
    RAISE EXCEPTION '[0564] verify: thieu index bonus_penalties_decided_by_idx (RENAME that bai)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bonus_penalties_approved_by_idx') THEN
    RAISE EXCEPTION '[0564] verify: index bonus_penalties_approved_by_idx VAN CON — ten noi doi ten cot';
  END IF;

  RAISE NOTICE '[0564] verify OK: 7 bang RLS+FORCE, append-only nguyen ven, 32 composite FK, 20 cot da go, trigger hep da dung';
END;
$$;
