-- Migration 0438: S0-FND-DB-1 (🔴 RED) — hoàn tất audit_logs về DB-08 §8.5 shape (ADDITIVE).
-- Gate: FULL (security-reviewer + database-reviewer[rls-tenant-isolation-tester] + silent-failure-hunter).
--
-- BAND 0438 (lane foundation-db). Journal: idx 121, when 1717500560000 (> head 0437 idx 120 / 1717500550000).
-- Nối tiếp ĐƠN ĐIỆU sau head 0437_be2_audit_sequence_counter. KHÔNG db:generate, KHÔNG drop/rename.
--
-- MỤC TIÊU (done_when #2 — "shape bảng nền khớp DB-08 audit_logs §8.5"):
--   0432 đã thêm 12 cột §8.5 (module_code/entity_type/entity_id/actor_type/old_values/new_values/
--   changed_fields/sensitivity_level/result_status/request_id/correlation_id/ip_address). WO này THÊM nốt
--   11 cột §8.5 CÒN THIẾU để shape audit_logs khớp đủ §8.5. TẤT CẢ nullable — writer cũ (AuditService v1
--   ghi object_type/before/after) + writer v2 (FOUNDATION-BE-3 ghi cột mới) đều KHÔNG vỡ. AuditService v2
--   (S1-FND-AUDIT-1) sẽ điền cột mới + masking.
--
-- BẤT BIẾN (CLAUDE.md §2/§3):
--   #1 tenant: audit_logs ĐÃ có RLS ENABLE/FORCE + policy audit_logs_tenant_iso (mig 0003) — GIỮ NGUYÊN,
--      WO này KHÔNG đụng RLS/policy/FORCE (additive cột thôi). company_id GIỮ NOT NULL.
--      ↳ LỆCH CÓ CHỦ ĐÍCH vs spec §8.5 (spec cho company_id nullable cho "system event"): ở N=1 không có
--        sự kiện không-công-ty; mọi writer audit hiện tại chạy trong withTenant (DB DEFAULT điền company_id).
--        NOT NULL mạnh hơn (bất biến #1) → KHÔNG nới. FOLLOW-UP (Phase sau): nếu cần audit sự kiện
--        platform-level không-công-ty, mở WO nới sang nullable + chuyển audit_logs sang mẫu nullable-tenant
--        (USING company_id=ctx OR company_id IS NULL; skipNoContext ở rls-coverage-assert) — KHÔNG làm ở đây.
--   #2 APPEND-ONLY: 0432 đã REVOKE UPDATE,DELETE ON audit_logs FROM mediaos_app. WO này GIỮ — chỉ
--      re-assert GRANT SELECT,INSERT (no-op an toàn). KHÔNG nới UPDATE/DELETE. Test RED ghi-rồi-update FAIL
--      ở audit-logs-appendonly.int-spec.ts.
--   #3 KHÔNG secret/hash/token vào old_values/new_values/error_message/metadata — masking ở AuditMaskerService
--      (S1-FND-AUDIT-1). DB chỉ là cột.
--   #5 UUID PK + timestamptz UTC-at-rest — cột mới actor_employee_id/entity_id_text/... KHÔNG thêm timestamp mới.
--
-- ⚠️ ADDITIVE / nullable: mọi cột mới NULL được (writer cũ không set). KHÔNG đụng object_type CHECK
--    (union append-only 0011…0437 — GIỮ NGUYÊN). data_scope KHÔNG CHECK (spec §8.5 không định nghĩa CHECK
--    cho cột này; ép Own/Team/Department/Company/System ở tầng app/Zod tại S1-FND-AUDIT-1).
--
-- 📌 DEVIATION KẾ THỪA (ghi nhận, KHÔNG sửa ở WO này — tránh churn/DROP index đang dùng):
--    idx_audit_logs_entity (mig 0432) = (module_code, entity_type, entity_id) — spec §8.5 muốn thêm
--    `, created_at DESC`. Giữ nguyên bản 0432 (đủ cho truy vết entity); không re-create. Đã đối chiếu.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 1) Thêm 11 cột DB-08 §8.5 còn thiếu (ADDITIVE, nullable). IF NOT EXISTS để idempotent/an toàn re-run.
--    actor_employee_id: uuid KHÔNG FK — HR dùng employee_profiles (không employees); theo tiền lệ
--    file_access_logs (mig 0433). FK sẽ thêm khi HR schema chốt entity (ngoài scope WO này).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_employee_id  uuid;
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action_group       varchar(100);
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_id_text     varchar(255);
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_code        varchar(255);
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS permission_code    varchar(150);
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS data_scope         varchar(50);
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS device_info        jsonb;
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS diff_summary       text;
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS error_code         varchar(100);
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS error_message      text;
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata           jsonb;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 2) Index DB-08 §8.5 còn thiếu (0432 đã có company_created/entity/request/correlation).
--    actor_created: liệt kê theo người thực hiện mới→cũ. action: lọc theo (tenant,module,action) mới→cũ.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
  ON audit_logs (actor_user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs (company_id, module_code, action, created_at DESC);
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 3) APPEND-ONLY re-assert (BẤT BIẾN #2). 0432 đã REVOKE UPDATE,DELETE — re-assert grant đúng (no-op
--    an toàn, KHÔNG nới). Sau migration: app role ghi-rồi-update/delete audit_logs PHẢI FAIL.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT ON audit_logs TO mediaos_app;

-- -------- Down (manual) --------
-- Append-only — KHÔNG khôi phục UPDATE/DELETE. Gỡ additive:
-- DROP INDEX IF EXISTS idx_audit_logs_action;
-- DROP INDEX IF EXISTS idx_audit_logs_actor_created;
-- ALTER TABLE audit_logs
--   DROP COLUMN IF EXISTS metadata, DROP COLUMN IF EXISTS error_message, DROP COLUMN IF EXISTS error_code,
--   DROP COLUMN IF EXISTS diff_summary, DROP COLUMN IF EXISTS device_info, DROP COLUMN IF EXISTS data_scope,
--   DROP COLUMN IF EXISTS permission_code, DROP COLUMN IF EXISTS entity_code, DROP COLUMN IF EXISTS entity_id_text,
--   DROP COLUMN IF EXISTS action_group, DROP COLUMN IF EXISTS actor_employee_id;
