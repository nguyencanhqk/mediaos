-- Migration 0432: FOUNDATION-DB-2 (🔴 RED) — nâng audit_logs về DB-08 §8.5 shape (ADDITIVE).
-- Gate: FULL (security-reviewer [append-only] + database-reviewer + silent-failure-hunter).
--
-- BAND 0432 (lane foundation-db). Journal: idx 115, when 1717500500000 (> head 0431 idx 114 / 1717500490000).
-- Nối tiếp ĐƠN ĐIỆU sau head 0431_foundation_db1_settings. Migration đơn điệu sau head 0430 (idx 113).
--
-- MỤC TIÊU (audit_logs DB-08 §8.5 — truy vết ai/làm-gì/khi-nào + diff old/new + trace xuyên module):
--   audit_logs hiện hữu (mig 0003 + 0011/0014/.../0420 object_type CHECK) có shape G2-4 cũ:
--     id/company_id/actor_user_id/action/object_type/object_id/before/after/ip/user_agent/created_at.
--   WO này THÊM (ADDITIVE) các cột DB-08 §8.5 còn thiếu, GIỮ NGUYÊN cột cũ để KHÔNG vỡ ghi hiện tại
--   (AuditService cũ vẫn ghi object_type/before/after). AuditService v2 (FOUNDATION-BE-3) sẽ điền cột mới.
--
-- BẤT BIẾN (CLAUDE.md §2/§3):
--   #1 company_id: audit_logs ĐÃ có RLS ENABLE/FORCE + policy audit_logs_tenant_iso (mig 0003) — GIỮ NGUYÊN,
--      WO này KHÔNG đụng RLS/policy (additive cột thôi). Cột company_id giữ FORCE.
--   #2 APPEND-ONLY: app role (mediaos_app) chỉ SELECT/INSERT — KHÔNG UPDATE/DELETE (mig 0003 grant chỉ
--      SELECT,INSERT; KHÔNG migration nào grant UPDATE/DELETE). WO này REVOKE UPDATE, DELETE tường minh để
--      HARDEN (idempotent — không có cũng an toàn) → ghi-rồi-update bằng app role PHẢI FAIL.
--   #3 KHÔNG ghi secret/hash/token vào old_values/new_values (mask ở tầng AuditMaskerService — BE-3).
--   #5 UUID PK + timestamptz UTC-at-rest (ADR-0008) — cột mới entity_id UUID, không thêm timestamp mới.
--
-- ⚠️ ADDITIVE / nullable: mọi cột mới NULL được. DB-08 đánh dấu actor_type/module_code/entity_type/
--    sensitivity_level/result_status là "Có" (bắt buộc) ở tầng NGHIỆP VỤ; nhưng audit_logs đã có dữ liệu
--    + writer cũ KHÔNG set các cột này → NOT NULL sẽ vỡ ghi hiện tại. Vì vậy giữ nullable ở tầng DB; CHECK
--    `IN (...)` cho phép NULL (predicate trả UNKNOWN ⇒ pass). AuditService v2 (BE-3) ép required ở tầng app.
--    Đây là LỆCH có chủ đích so với spec để bảo toàn BẤT BIẾN "không vỡ ghi hiện tại" (WO done_when #1).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 1) Thêm cột DB-08 §8.5 (ADDITIVE, nullable). IF NOT EXISTS để idempotent/an toàn re-run.
--    Cột cũ tương đương GIỮ NGUYÊN: action(text)·object_type·object_id·before·after·ip·user_agent·
--    actor_user_id·created_at. KHÔNG đổi/đổi-tên cột cũ (writer cũ vẫn dùng).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS module_code        varchar(50);
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_type        varchar(100);
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_id          uuid;
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_type         varchar(50);
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS old_values         jsonb;
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS new_values         jsonb;
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS changed_fields     jsonb;
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS sensitivity_level  varchar(50);
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS result_status      varchar(50);
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS request_id         varchar(100);
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS correlation_id     varchar(100);
--> statement-breakpoint
-- ip_address (DB-08 varchar(45) IPv4/IPv6) song song cột `ip`(text) cũ — writer cũ giữ `ip`,
-- writer v2 (BE-3) dùng ip_address. user_agent ĐÃ tồn tại (mig 0003, text) ⇒ KHÔNG thêm lại.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address         varchar(45);
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 2) CHECK actor_type / sensitivity_level / result_status (DB-08 §8.5). CHO PHÉP NULL (additive — hàng
--    cũ + writer cũ không set; `IN (...)` trả UNKNOWN khi NULL ⇒ pass). KHÔNG đụng object_type CHECK
--    (union append-only của 0011…0420 — GIỮ NGUYÊN). IF NOT EXISTS guard để idempotent.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_audit_logs_actor_type') THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT chk_audit_logs_actor_type
      CHECK (actor_type IS NULL OR actor_type IN ('User', 'System', 'Job', 'Integration'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_audit_logs_sensitivity_level') THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT chk_audit_logs_sensitivity_level
      CHECK (sensitivity_level IS NULL OR sensitivity_level IN ('Normal', 'Sensitive', 'HighlySensitive'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_audit_logs_result_status') THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT chk_audit_logs_result_status
      CHECK (result_status IS NULL OR result_status IN ('Success', 'Failure', 'Denied', 'Error'));
  END IF;
END $$;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 3) Index DB-08 §8.5 (WO done_when #3). company_id+created_at DESC (liệt kê theo tenant mới→cũ),
--    module_code+entity_type+entity_id (truy vết theo entity), request_id, correlation_id (trace).
--    Index cũ audit_logs_company_object_idx (company_id,object_type,object_id) GIỮ NGUYÊN.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created
  ON audit_logs (company_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs (module_code, entity_type, entity_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_audit_logs_request
  ON audit_logs (request_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation
  ON audit_logs (correlation_id);
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 4) APPEND-ONLY HARDEN (BẤT BIẾN #2). mediaos_app chỉ SELECT/INSERT. REVOKE UPDATE,DELETE tường minh
--    (idempotent — mig 0003 vốn không grant; REVOKE quyền chưa-có là no-op an toàn). Sau migration:
--    app role ghi-rồi-update/delete trên audit_logs PHẢI FAIL (rls-tenant-isolation-tester xác nhận).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
REVOKE UPDATE, DELETE ON audit_logs FROM mediaos_app;
--> statement-breakpoint
-- Tái khẳng định grant append-only đúng (SELECT/INSERT) — không nới rộng.
GRANT SELECT, INSERT ON audit_logs TO mediaos_app;

-- -------- Down (manual) --------
-- REVOKE? (append-only — không khôi phục UPDATE/DELETE). Gỡ additive:
-- DROP INDEX IF EXISTS idx_audit_logs_correlation;
-- DROP INDEX IF EXISTS idx_audit_logs_request;
-- DROP INDEX IF EXISTS idx_audit_logs_entity;
-- DROP INDEX IF EXISTS idx_audit_logs_company_created;
-- ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS chk_audit_logs_result_status;
-- ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS chk_audit_logs_sensitivity_level;
-- ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS chk_audit_logs_actor_type;
-- ALTER TABLE audit_logs DROP COLUMN IF EXISTS ip_address, ... (mọi cột §1).
