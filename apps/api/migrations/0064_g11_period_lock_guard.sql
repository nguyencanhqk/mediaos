-- Migration 0064: G11-F7 — Period-lock immutability guard (DB-thuần, trigger BEFORE UPDATE).
--
-- VÌ SAO: app role mediaos_app có GRANT UPDATE trên attendance_periods (0061). Sau khi một kỳ công
-- được khoá (status='locked' — chốt số liệu trước khi feed payroll G12), KHÔNG được mở lại ngầm.
-- Đây là mở rộng BẤT BIẾN §2.2 (append-only/immutability cho kỳ đã khoá): cấm transition locked→open.
--
-- LỚP PHỤ THÊM, KHÔNG thay RLS: trigger chỉ fire SAU khi RLS (app.current_company_id) đã cho UPDATE
-- chạm đúng hàng của tenant. Tenant isolation §2.1 vẫn là lớp đầu tiên; trigger chặn transition trái phép.
--
-- PHẠM VI HẸP: chỉ chặn ĐÚNG locked→open. Mọi mutation hợp lệ khác (open→locked, đổi field khác trên
-- kỳ locked, INSERT) KHÔNG bị ảnh hưởng — tránh chặn nhầm luồng hợp lệ.
-- Thông điệp RAISE chỉ chứa period_month + id (không dữ liệu nhạy cảm).

CREATE OR REPLACE FUNCTION enforce_attendance_period_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'locked' AND NEW.status = 'open' THEN
    RAISE EXCEPTION
      'attendance_period_lock: kỳ công % (id=%) đã khoá, cấm mở lại (locked→open)',
      OLD.period_month, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER attendance_period_lock_guard
  BEFORE UPDATE ON attendance_periods
  FOR EACH ROW
  EXECUTE FUNCTION enforce_attendance_period_lock();
