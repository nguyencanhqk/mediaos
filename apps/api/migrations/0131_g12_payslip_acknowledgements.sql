-- Migration 0131: G12-4 — payslip_acknowledgements (nhân viên xác nhận / khiếu nại bảng lương đã phát hành).
--
-- BAND 0130-0139 (lane G12-approval). idx 78, when 1717500141000 (>0130). Chạy SAU 0130.
-- Tiền lệ RLS/grant: 0094 (payroll_periods), 0098 (bonus_penalties). MUTABLE hẹp (FSM trigger), KHÔNG append-only:
--   acknowledged | disputed | resolved. disputed→resolved là UPDATE hợp lệ (HR xử lý khiếu nại) ⇒ cần GRANT UPDATE.
--   KHÁC payslip snapshot (append-only): đây là metadata ĐỒNG Ý/KHIẾU NẠI, KHÔNG chứa tiền lương.
--   - company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy USING+WITH CHECK (BẤT BIẾN #1).
--   - GRANT app SELECT,INSERT,UPDATE (NO DELETE — vết đồng ý không xoá). worker SELECT (read-only).
--   - Ownership + "kỳ published" ép ở SERVICE (nhân viên chỉ thao tác trên payslip của CHÍNH MÌNH, kỳ đã phát hành).
--   - unique (company,payslip,user): 1 xác nhận/khiếu nại / payslip / người (chống double-ack).
--   - Trigger HẸP enforce_payslip_ack_status: chỉ disputed→resolved; chặn acknowledged→*, disputed→acknowledged, resolved→*.

CREATE TABLE payslip_acknowledgements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL
                    DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                    REFERENCES companies(id) ON DELETE CASCADE,
  payslip_id      uuid NOT NULL REFERENCES payslips(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  status          text NOT NULL,
  reason          text,
  resolved_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE payslip_acknowledgements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payslip_acknowledgements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payslip_acknowledgements
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX payslip_ack_company_id_idx ON payslip_acknowledgements(company_id);
--> statement-breakpoint
-- Tra theo payslip (HR xem danh sách xác nhận/khiếu nại của 1 phiếu).
CREATE INDEX payslip_ack_company_payslip_idx
  ON payslip_acknowledgements(company_id, payslip_id);
--> statement-breakpoint
-- 1 ack / (company, payslip, user) — chống double-ack (đua INSERT → 23505 → 409 ở service).
CREATE UNIQUE INDEX payslip_acknowledgements_payslip_user_uq
  ON payslip_acknowledgements(company_id, payslip_id, user_id);
--> statement-breakpoint
ALTER TABLE payslip_acknowledgements
  ADD CONSTRAINT payslip_ack_status_check
    CHECK (status IN ('acknowledged','disputed','resolved')),
  -- Khiếu nại PHẢI có lý do (OR-form NULL-safe — status NOT NULL).
  ADD CONSTRAINT payslip_ack_dispute_reason_check
    CHECK (status <> 'disputed' OR reason IS NOT NULL),
  -- resolved ⇒ cặp xử lý đầy đủ (ai xử lý + khi nào).
  ADD CONSTRAINT payslip_ack_resolved_pair_check
    CHECK (status <> 'resolved' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL));
--> statement-breakpoint
-- mutable hẹp: app có UPDATE (disputed→resolved) nhưng KHÔNG DELETE. worker chỉ đọc.
GRANT SELECT, INSERT, UPDATE ON payslip_acknowledgements TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON payslip_acknowledgements TO mediaos_worker;
--> statement-breakpoint

-- ── Trigger HẸP FSM: chỉ disputed→resolved; chặn mọi lùi/đổi-chéo trạng thái ──
-- Mở rộng immutability: sau khi nhân viên đã xác nhận (acknowledged) hoặc đã giải quyết (resolved),
-- KHÔNG đổi nữa. disputed (khiếu nại) chỉ được chuyển sang resolved (HR xử lý). Defense-in-depth
-- (service đã chặn ở tầng trên). Thông điệp chỉ id (KHÔNG tiền/PII).
CREATE FUNCTION enforce_payslip_ack_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> NEW.status THEN
    IF NOT (OLD.status = 'disputed' AND NEW.status = 'resolved') THEN
      RAISE EXCEPTION
        'payslip_ack_status: chuyển trạng thái không hợp lệ % → % (id=%)',
        OLD.status, NEW.status, OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payslip_ack_status_guard
  BEFORE UPDATE ON payslip_acknowledgements
  FOR EACH ROW
  EXECUTE FUNCTION enforce_payslip_ack_status();
