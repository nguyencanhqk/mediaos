-- Migration 0510: S5-FND-REVOKE-1 (🔴 RED, zone=red) — REVOKE DELETE ON org_units, projects FROM mediaos_app.
-- Gate: FULL (database-reviewer + security-reviewer + silent-failure-hunter). Grant cấp-bảng của app role = crown-jewel.
-- Clone mẫu đã ship 0467_s2_fnddb1_companies_users_revoke_delete.sql (companies/users).
--
-- MỤC TIÊU (finding MEDIUM gate S5-GOAL-DB-1 · BẤT BIẾN #2 — không hard-delete):
--   goals.department_id → org_units + goals.project_id → projects đều ON DELETE CASCADE (mig 0504:50-51);
--   goal_updates.goal_id → goals ON DELETE CASCADE (0504:140) và goal_updates append-only (GRANT chỉ
--   SELECT/INSERT). Nếu app role chạy DELETE FROM org_units|projects → CASCADE xóa CỨNG goals + ledger
--   goal_updates, KHÔNG qua soft-delete, KHÔNG audit ⇒ vi phạm kép BẤT BIẾN #2.
--   G-era vẫn GRANT DELETE cho mediaos_app: org_units (0006:36), projects (0007:61). Service hiện chỉ
--   soft-delete (set deleted_at). WO này kéo 2 bảng về đúng chuẩn band 0431+ (app role KHÔNG có DELETE).
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 company_id/RLS: org_units (0006) + projects (0007) ĐÃ ENABLE + FORCE ROW LEVEL SECURITY + policy
--      tenant-iso — WO này KHÔNG đụng RLS/FORCE/policy. KHÔNG backfill company_id (không có gì để đặt-RLS-trước).
--   #2 REVOKE DELETE tường minh → app-role DELETE org_units/projects PHẢI FAIL (42501 insufficient_privilege).
--      Idempotent: REVOKE quyền chưa-có là no-op an toàn. Tái khẳng định GRANT SELECT,INSERT,UPDATE
--      (KHÔNG nới rộng) để nêu rõ phạm vi mong muốn.
--   • Precondition (expand/contract, memory migration-expand-contract-required):
--     - 0 caller TĨNH `.delete(orgUnits|projects)` / `DELETE FROM org_units|projects` trong apps/api/src.
--     - 1 caller ĐỘNG: retention.service.ts:521 `_deleteEligible` chạy `DELETE FROM <entity_type>` qua app role
--       (entity_type KHÔNG có CHECK whitelist). ĐÃ đóng ở LỚP APP cùng WO: thêm org_units/projects vào
--       RetentionService.PROTECTED_TABLES ⇒ retention no-op (deletedRecords=0) TRƯỚC khi tới DB. REVOKE này
--       là backstop cuối (D-I-D). 0 policy seed cho 2 bảng + kill-switch mặc định OFF ⇒ contract-only an toàn.
--     - Seed/teardown test đi qua role owner/superuser (directPool) — KHÔNG bị REVOKE ảnh hưởng; chỉ siết mediaos_app.
--   • KHÔNG db:generate — grant KHÔNG biểu diễn được bằng drizzle schema → viết SQL tay (convention 04xx).
--   • DELETE là quyền CẤP-BẢNG (không tồn tại DELETE theo cột) → REVOKE chỉ đụng DELETE.
--
-- BAND 0510 (lane S5-FND-REVOKE-1). Journal: idx 190, when 1717587312000 (> head 0509 idx 189 / 1717587311000).
--   Nối tiếp ĐƠN ĐIỆU sau 0509_s5_lmsdb1_audit_lms_object_types.
--   ⚠ Tranh số với S5-SYS-CLEAN-1 (phiên khác cũng thêm migration): nếu SYS-CLEAN-1 merge trước ⇒ renumber
--     0510→kế (đổi tên file + tag _journal + message fail-loud '[0510]'). Xử lý ở merge-time.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- REVOKE DELETE — chặn hard-delete org_units + projects (cửa cascade-xoá goals/goal_updates). RLS/FORCE/
-- policy (mig 0006/0007) GIỮ NGUYÊN. Idempotent (REVOKE quyền chưa-có = no-op).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE DELETE ON org_units, projects FROM mediaos_app;
--> statement-breakpoint

-- Tái khẳng định grant đúng phạm vi (SELECT/INSERT/UPDATE) — KHÔNG cấp lại DELETE. Idempotent.
GRANT SELECT, INSERT, UPDATE ON org_units, projects TO mediaos_app;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- Fail-LOUD (mẫu mig 0467): xác nhận SAU migration mediaos_app KHÔNG còn DELETE trên org_units/projects,
-- đồng thời VẪN còn SELECT/INSERT/UPDATE (KHÔNG over-revoke). Tránh âm thầm trượt REVOKE (vd grant DELETE
-- bị cấp lại ở migration tương lai) hoặc siết quá tay.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_table_privilege('mediaos_app', 'org_units', 'DELETE') THEN
    RAISE EXCEPTION '[0510] mediaos_app VẪN còn DELETE trên org_units sau REVOKE — BẤT BIẾN #2 vỡ.';
  END IF;
  IF has_table_privilege('mediaos_app', 'projects', 'DELETE') THEN
    RAISE EXCEPTION '[0510] mediaos_app VẪN còn DELETE trên projects sau REVOKE — BẤT BIẾN #2 vỡ.';
  END IF;
  IF NOT (has_table_privilege('mediaos_app', 'org_units', 'SELECT')
      AND has_table_privilege('mediaos_app', 'org_units', 'INSERT')
      AND has_table_privilege('mediaos_app', 'org_units', 'UPDATE')) THEN
    RAISE EXCEPTION '[0510] mediaos_app THIẾU SELECT/INSERT/UPDATE trên org_units — REVOKE quá tay.';
  END IF;
  IF NOT (has_table_privilege('mediaos_app', 'projects', 'SELECT')
      AND has_table_privilege('mediaos_app', 'projects', 'INSERT')
      AND has_table_privilege('mediaos_app', 'projects', 'UPDATE')) THEN
    RAISE EXCEPTION '[0510] mediaos_app THIẾU SELECT/INSERT/UPDATE trên projects — REVOKE quá tay.';
  END IF;
  RAISE NOTICE '[0510] REVOKE DELETE org_units+projects OK — SELECT/INSERT/UPDATE giữ nguyên (soft-delete, chặn cascade goals/goal_updates)';
END $$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy; BẤT BIẾN #2 KHÔNG khôi phục DELETE) --------
-- GRANT DELETE ON org_units, projects TO mediaos_app;  -- (KHÔNG nên — tái mở cửa cascade-xoá goals + ledger)
