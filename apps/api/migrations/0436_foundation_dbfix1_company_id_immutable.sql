-- Migration 0436: FOUNDATION-DB-FIX-1 (🔴 RED) — chặn RE-HOME hàng global trên bảng nullable-tenant.
--   Bịt lỗ: app role UPDATE hàng global (company_id NULL → company_id = tenant mình) ⇒ chiếm/corrupt
--   master-data DÙNG CHUNG. Trigger BEFORE UPDATE khóa company_id BẤT BIẾN.
-- Gate: FULL (security-reviewer [RLS nullable-tenant re-home] + database-reviewer + silent-failure-hunter).
--
-- BAND 0436 (lane foundation-db / hậu-kiểm). Journal: idx 119, when 1717500540000 (> head 0435 idx 118 /
--   1717500530000). Nối tiếp ĐƠN ĐIỆU sau head 0435_foundation_db5_retention_seed_modules.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- DEFECT (security-reviewer + rls-tenant-isolation-tester hội tụ 2026-06-21, dynamically proven rowCount=1):
--   Bảng nullable-tenant (mẫu 0005 roles / 0434 / 0435) dùng policy:
--     USING      (company_id = current_setting OR company_id IS NULL)  → tenant ĐỌC row mình + hàng global.
--     WITH CHECK (company_id = current_setting)                        → ghi CHỈ row tenant mình.
--   ⇒ USING cho phép NHẮM hàng global (company_id IS NULL) để UPDATE; WITH CHECK trên row MỚI lại PASS khi
--     đặt company_id = current_setting. Hệ quả: `UPDATE t SET company_id = <A> WHERE company_id IS NULL`
--     THÀNH CÔNG ⇒ tenant A "re-home" (chiếm) hàng global dùng chung (sequence/holiday/retention/seed/role
--     hệ thống) về tenant mình → corrupt master-data cho mọi tenant. (BẤT BIẾN #1 — cô lập tenant.)
--
-- VÌ SAO KHÔNG sửa bằng RLS thuần: USING (OLD) và WITH CHECK (NEW) đánh giá ĐỘC LẬP, KHÔNG so sánh được
--   OLD.company_id vs NEW.company_id trong 1 policy. Tách `FOR UPDATE USING (company_id = current_setting)`
--   sẽ chặn LUÔN việc app update cột thường của hàng global (vd tăng current_value của system sequence) —
--   QUÁ RỘNG. Trigger BEFORE UPDATE chặn ĐÚNG thao tác có hại (đổi company_id), GIỮ mọi update hợp lệ khác.
--
-- FIX: trigger BEFORE UPDATE FOR EACH ROW raise khi NEW.company_id IS DISTINCT FROM OLD.company_id.
--   `IS DISTINCT FROM` xử lý NULL đúng: NULL↔NULL = không đổi (cho phép) · NULL→uuid / uuid→khác = chặn.
--   company_id của master-data/role được set lúc tạo và KHÔNG bao giờ đổi (xác minh: 0 code-path nào
--   `SET company_id` — mọi nơi company_id chỉ là bộ lọc RLS). ⇒ khóa bất biến KHÔNG phá luồng hợp lệ nào.
--
-- PHẠM VI: 5 bảng Foundation nullable-tenant (0434/0435) + `roles` (0005 — cùng lỗ tiềm ẩn, done_when
--   "cân nhắc áp dụng roles"). KHÔNG đụng schema .ts (trigger là DB-object, Drizzle không model — KHÔNG
--   db:generate). RLS/FORCE/grant của các bảng GIỮ NGUYÊN — migration này chỉ THÊM trigger (additive).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- Hàm guard dùng chung: chặn mọi UPDATE làm đổi company_id (re-home / forge-global).
CREATE OR REPLACE FUNCTION enforce_company_id_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION
      'company_id is immutable on %, re-home blocked (% -> %)',
      TG_TABLE_NAME, OLD.company_id, NEW.company_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- sequence_counters (0434)
DROP TRIGGER IF EXISTS trg_sequence_counters_company_immutable ON sequence_counters;
--> statement-breakpoint
CREATE TRIGGER trg_sequence_counters_company_immutable
  BEFORE UPDATE ON sequence_counters
  FOR EACH ROW EXECUTE FUNCTION enforce_company_id_immutable();
--> statement-breakpoint

-- public_holidays (0434)
DROP TRIGGER IF EXISTS trg_public_holidays_company_immutable ON public_holidays;
--> statement-breakpoint
CREATE TRIGGER trg_public_holidays_company_immutable
  BEFORE UPDATE ON public_holidays
  FOR EACH ROW EXECUTE FUNCTION enforce_company_id_immutable();
--> statement-breakpoint

-- data_retention_policies (0435)
DROP TRIGGER IF EXISTS trg_data_retention_policies_company_immutable ON data_retention_policies;
--> statement-breakpoint
CREATE TRIGGER trg_data_retention_policies_company_immutable
  BEFORE UPDATE ON data_retention_policies
  FOR EACH ROW EXECUTE FUNCTION enforce_company_id_immutable();
--> statement-breakpoint

-- seed_batches (0435)
DROP TRIGGER IF EXISTS trg_seed_batches_company_immutable ON seed_batches;
--> statement-breakpoint
CREATE TRIGGER trg_seed_batches_company_immutable
  BEFORE UPDATE ON seed_batches
  FOR EACH ROW EXECUTE FUNCTION enforce_company_id_immutable();
--> statement-breakpoint

-- seed_items (0435)
DROP TRIGGER IF EXISTS trg_seed_items_company_immutable ON seed_items;
--> statement-breakpoint
CREATE TRIGGER trg_seed_items_company_immutable
  BEFORE UPDATE ON seed_items
  FOR EACH ROW EXECUTE FUNCTION enforce_company_id_immutable();
--> statement-breakpoint

-- roles (0005 — precedent nullable-tenant; cùng lỗ re-home cho system role company_id IS NULL)
DROP TRIGGER IF EXISTS trg_roles_company_immutable ON roles;
--> statement-breakpoint
CREATE TRIGGER trg_roles_company_immutable
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION enforce_company_id_immutable();

-- -------- Down (manual) --------
-- DROP TRIGGER IF EXISTS trg_roles_company_immutable ON roles;
-- DROP TRIGGER IF EXISTS trg_seed_items_company_immutable ON seed_items;
-- DROP TRIGGER IF EXISTS trg_seed_batches_company_immutable ON seed_batches;
-- DROP TRIGGER IF EXISTS trg_data_retention_policies_company_immutable ON data_retention_policies;
-- DROP TRIGGER IF EXISTS trg_public_holidays_company_immutable ON public_holidays;
-- DROP TRIGGER IF EXISTS trg_sequence_counters_company_immutable ON sequence_counters;
-- DROP FUNCTION IF EXISTS enforce_company_id_immutable();
