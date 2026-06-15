-- Migration 0130: G12-4 — payroll_periods FSM duyệt bảng lương (draft→approved→published).
--
-- BAND 0130-0139 (lane G12-approval, band tràn — band gốc 0090-0099 ĐẦY). idx 77, when 1717500140000 (>0099's 1717500139000).
-- ADR-0005 mở rộng: kỳ lương giờ có VÒNG DUYỆT (draft→approved→published) thay cho draft→locked (G12-2).
--   - RETIRE 'locked' (G12-2 chưa có dữ liệu thật, chưa test transition lock()) → enum mới {draft,approved,published}.
--   - DROP locked_by/locked_at (đổi nghĩa rủi ro) → ADD created_by + approved_by/at + published_by/at (vết duyệt).
--   - SoD (segregation of duties): người DUYỆT ≠ người CHẠY lương kỳ này (service kiểm qua payslips.created_by).
--   - Trigger HẸP enforce_payroll_period_status: CHỈ cho draft→approved, approved→published; chặn MỌI lùi
--     trạng thái + chặn xoá mềm kỳ KHÔNG-draft. Thay trigger lock-guard 0094. KHÔNG đụng trigger G11 0064.
--   - GRANT giữ nguyên (SELECT,INSERT,UPDATE; NO DELETE — soft-delete). Không backfill (cột mới NULL).

-- ── Cột vết duyệt: bỏ locked_*, thêm created_by + approved_*/published_* ──
ALTER TABLE payroll_periods
  DROP COLUMN locked_by,
  DROP COLUMN locked_at,
  ADD COLUMN created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN approved_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN approved_at   timestamptz,
  ADD COLUMN published_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN published_at  timestamptz;
--> statement-breakpoint

-- ── Swap status CHECK draft/locked → draft/approved/published ──
ALTER TABLE payroll_periods DROP CONSTRAINT payroll_periods_status_check;
--> statement-breakpoint
ALTER TABLE payroll_periods
  ADD CONSTRAINT payroll_periods_status_check
    CHECK (status IN ('draft','approved','published')),
  -- approved ⇒ cặp duyệt đầy đủ. OR-form NULL-safe (status NOT NULL).
  ADD CONSTRAINT payroll_periods_approved_pair_check
    CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  -- published ⇒ cặp phát hành đầy đủ + ĐÃ approved trước (giữ approved_by/at) → cấm nhảy thẳng draft→published.
  ADD CONSTRAINT payroll_periods_published_pair_check
    CHECK (status <> 'published'
           OR (published_by IS NOT NULL AND published_at IS NOT NULL
               AND approved_by IS NOT NULL AND approved_at IS NOT NULL));
--> statement-breakpoint

-- ── Trigger HẸP FSM (thay enforce_payroll_period_lock 0094) ──
-- Mở rộng BẤT BIẾN §2.2: sau khi duyệt/phát hành lương, CẤM lùi trạng thái (immutability vòng duyệt).
-- PHẠM VI: chỉ chuyển trạng thái hợp lệ là draft→approved + approved→published. Mọi đổi field khác trên
-- kỳ (vd set approved_by/at trong cùng UPDATE flip status) KHÔNG bị ảnh hưởng (chỉ kiểm OLD.status vs NEW.status).
-- Cấm xoá mềm (set deleted_at) kỳ KHÔNG-draft. Thông điệp chỉ chứa status/period_month/id (KHÔNG tiền).
DROP TRIGGER payroll_period_lock_guard ON payroll_periods;
--> statement-breakpoint
DROP FUNCTION enforce_payroll_period_lock();
--> statement-breakpoint
CREATE FUNCTION enforce_payroll_period_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> NEW.status THEN
    IF NOT ((OLD.status = 'draft'    AND NEW.status = 'approved')
         OR (OLD.status = 'approved' AND NEW.status = 'published')) THEN
      RAISE EXCEPTION
        'payroll_period_status: chuyển trạng thái không hợp lệ % → % (kỳ %, id=%)',
        OLD.status, NEW.status, OLD.period_month, OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- Chỉ kỳ draft mới được xoá mềm (approved/published là sổ duyệt — không biến mất).
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION
      'payroll_period_status: chỉ kỳ draft mới được xoá mềm (status=%, kỳ %, id=%)',
      OLD.status, OLD.period_month, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payroll_period_status_guard
  BEFORE UPDATE ON payroll_periods
  FOR EACH ROW
  EXECUTE FUNCTION enforce_payroll_period_status();
