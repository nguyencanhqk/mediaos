-- Migration 0098: G12-3 — bonus_penalties (thưởng/phạt, MUTABLE draft→approved/rejected) + RLS + FORCE + GRANT.
--
-- BAND 0090-0099 (lane G12-bonus). Tiền lệ RLS/grant/trigger: 0094 (payroll_periods). idx 75, when>master max (74/1717500137000).
-- ADR-0005 spirit: bonus_penalty là ĐỀ XUẤT chờ duyệt (MUTABLE) — KHÁC payslips (append-only snapshot).
--   - company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy USING+WITH CHECK (BẤT BIẾN #1).
--   - GRANT app SELECT,INSERT,UPDATE (NO DELETE — soft-delete deleted_at). worker SELECT read-only.
--   - reference (task/defect/kpi_result) = typed-FK NULLABLE ON DELETE RESTRICT (giữ chuỗi audit, referent không biến mất).
--     CHECK `reference_check` ép đúng-một-hoặc-không theo reference_type. FK KHÔNG ép cùng-tenant → service validate tay.
--   - kind tách bonus/penalty + amount > 0 (KHÔNG số âm — tránh lỗi dấu khi gộp vào payslip).
--   - payroll_period_id + consumed_at = bind kỳ đã consume (chống trả 2 lần khi runPayroll). approved ⇒ cặp approver bắt buộc.
--   - Trigger HẸP enforce_bonus_penalty_guard: (1) chặn transition sai (rời 'draft' rồi đổi status),
--     (2) đóng băng field tiền/khoá sau khi rời draft, (3) MIỄN TRỪ consume (payroll_period_id NULL→set 1 lần).
--     Self-approve (approved_by=created_by) chặn ở SERVICE (trigger không có ngữ cảnh actor sạch).

CREATE TABLE bonus_penalties (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL
                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id),
  kind              text NOT NULL,
  amount            numeric(18,2) NOT NULL,
  currency          text NOT NULL DEFAULT 'VND',
  period_month      text NOT NULL,
  reason            text,
  source            text NOT NULL DEFAULT 'manual',
  reference_type    text,
  task_id           uuid REFERENCES tasks(id)       ON DELETE RESTRICT,
  defect_id         uuid REFERENCES defects(id)     ON DELETE RESTRICT,
  kpi_result_id     uuid REFERENCES kpi_results(id) ON DELETE RESTRICT,
  status            text NOT NULL DEFAULT 'draft',
  -- RESTRICT (như reference FK): người duyệt 1 khoản tiền không được xoá cứng khi còn record tham chiếu
  -- (giữ approved_pair + chuỗi audit). User xoá MỀM (deleted_at) nên RESTRICT thực tế không cản vận hành.
  approved_by       uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at       timestamptz,
  payroll_period_id uuid REFERENCES payroll_periods(id) ON DELETE SET NULL,
  consumed_at       timestamptz,
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
--> statement-breakpoint
ALTER TABLE bonus_penalties ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bonus_penalties FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON bonus_penalties
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX bonus_penalties_company_id_idx ON bonus_penalties(company_id);
--> statement-breakpoint
-- Khoá gộp khi runPayroll: (company, user, period_month).
CREATE INDEX bonus_penalties_company_user_month_idx
  ON bonus_penalties(company_id, user_id, period_month);
--> statement-breakpoint
CREATE INDEX bonus_penalties_company_status_idx
  ON bonus_penalties(company_id, status) WHERE deleted_at IS NULL;
--> statement-breakpoint
-- FK approved_by ON DELETE RESTRICT → index để PG check referent không seq-scan khi xoá user (hiếm, soft-delete).
CREATE INDEX bonus_penalties_approved_by_idx
  ON bonus_penalties(approved_by) WHERE approved_by IS NOT NULL;
--> statement-breakpoint
ALTER TABLE bonus_penalties
  ADD CONSTRAINT bonus_penalties_kind_check   CHECK (kind IN ('bonus','penalty')),
  ADD CONSTRAINT bonus_penalties_amount_check CHECK (amount > 0),
  ADD CONSTRAINT bonus_penalties_status_check CHECK (status IN ('draft','approved','rejected')),
  ADD CONSTRAINT bonus_penalties_source_check CHECK (source IN ('manual','kpi','defect')),
  ADD CONSTRAINT bonus_penalties_month_check  CHECK (period_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- CASE → boolean SẠCH (KHÔNG NULL): branch literal `reference_type = 'task'` cho NULL khi reference_type
  -- NULL, làm OR ra NULL ⇒ CHECK PASS sai (lỗ hổng). CASE ELSE false đóng lỗ: reference_type NULL + FK set bị chặn.
  ADD CONSTRAINT bonus_penalties_reference_check CHECK (
    CASE
      WHEN reference_type IS NULL THEN (task_id IS NULL AND defect_id IS NULL AND kpi_result_id IS NULL)
      WHEN reference_type = 'task'       THEN (task_id       IS NOT NULL AND defect_id IS NULL AND kpi_result_id IS NULL)
      WHEN reference_type = 'defect'     THEN (defect_id     IS NOT NULL AND task_id   IS NULL AND kpi_result_id IS NULL)
      WHEN reference_type = 'kpi_result' THEN (kpi_result_id IS NOT NULL AND task_id   IS NULL AND defect_id     IS NULL)
      ELSE false
    END
  ),
  ADD CONSTRAINT bonus_penalties_approved_pair_check CHECK (
    status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  ),
  ADD CONSTRAINT bonus_penalties_consumed_pair_check CHECK (
       (payroll_period_id IS NULL AND consumed_at IS NULL)
    OR (payroll_period_id IS NOT NULL AND consumed_at IS NOT NULL)
  ),
  -- CHỈ hàng approved mới được consume (bind kỳ lương). Chặn ở DB kể cả khi service/repo có bug.
  ADD CONSTRAINT bonus_penalties_consume_approved_check CHECK (
    payroll_period_id IS NULL OR status = 'approved'
  );
--> statement-breakpoint
-- mutable: app role UPDATE (draft→approved/rejected, consume) nhưng KHÔNG DELETE (soft-delete). worker đọc.
GRANT SELECT, INSERT, UPDATE ON bonus_penalties TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON bonus_penalties TO mediaos_worker;
--> statement-breakpoint

-- ─── Trigger HẸP: FSM duyệt + đóng băng tiền sau duyệt, MIỄN TRỪ consume ───
-- Mở rộng BẤT BIẾN §2 (immutability cho bản ghi đã rời nháp): sau khi duyệt/từ chối, cấm sửa số tiền/khoá
-- và cấm đổi lại status (terminal). MIỄN TRỪ consume: payroll_period_id NULL→set 1 lần (+consumed_at) cho phép
-- ngay cả trên hàng approved (đây là bind hệ thống khi chạy lương, KHÔNG phải sửa tiền). Cấm re-bind sang kỳ khác.
-- PHẠM VI HẸP — không đụng trigger 0094 (payroll_periods). Thông điệp chỉ chứa id+kind+period_month (không amount nhạy cảm).
CREATE OR REPLACE FUNCTION enforce_bonus_penalty_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    -- (1) terminal/đã duyệt: status không được đổi nữa (draft→approved/rejected là transition HỢP LỆ duy nhất,
    --     và path đó có OLD.status='draft' nên KHÔNG vào nhánh này).
    IF NEW.status <> OLD.status THEN
      RAISE EXCEPTION
        'bonus_penalty_guard: % (id=%, kỳ %) đã ở trạng thái %, cấm đổi status (terminal)',
        OLD.kind, OLD.id, OLD.period_month, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    -- (2) đóng băng field tiền/đối tượng sau khi rời draft (gồm currency — tiền tệ cũng là field tiền).
    IF NEW.kind <> OLD.kind
       OR NEW.amount <> OLD.amount
       OR NEW.currency <> OLD.currency
       OR NEW.user_id <> OLD.user_id
       OR NEW.period_month <> OLD.period_month
       OR NEW.reference_type IS DISTINCT FROM OLD.reference_type
       OR NEW.task_id IS DISTINCT FROM OLD.task_id
       OR NEW.defect_id IS DISTINCT FROM OLD.defect_id
       OR NEW.kpi_result_id IS DISTINCT FROM OLD.kpi_result_id THEN
      RAISE EXCEPTION
        'bonus_penalty_guard: % (id=%, kỳ %) đã duyệt, cấm sửa field tiền/đối tượng',
        OLD.kind, OLD.id, OLD.period_month
        USING ERRCODE = 'check_violation';
    END IF;
    -- (2b) cấm xoá mềm sau khi rời draft (đã duyệt/từ chối = bất biến; xoá mềm CHỈ khi còn draft).
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      RAISE EXCEPTION
        'bonus_penalty_guard: % (id=%, kỳ %) đã rời draft, cấm xoá mềm',
        OLD.kind, OLD.id, OLD.period_month
        USING ERRCODE = 'check_violation';
    END IF;
    -- (3) consume: cấm re-bind sang kỳ khác (đã consume rồi không đổi kỳ).
    IF OLD.payroll_period_id IS NOT NULL
       AND NEW.payroll_period_id IS DISTINCT FROM OLD.payroll_period_id THEN
      RAISE EXCEPTION
        'bonus_penalty_guard: % (id=%, kỳ %) đã consume kỳ lương, cấm re-bind',
        OLD.kind, OLD.id, OLD.period_month
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bonus_penalty_guard
  BEFORE UPDATE ON bonus_penalties
  FOR EACH ROW
  EXECUTE FUNCTION enforce_bonus_penalty_guard();
