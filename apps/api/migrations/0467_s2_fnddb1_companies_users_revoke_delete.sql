-- Migration 0467: S2-FND-DB-1 (🔴 RED, zone=red) — REVOKE DELETE ON companies, users FROM mediaos_app.
-- Gate: FULL (database-reviewer + security-reviewer). Grant trên tenant-gốc + tài khoản = crown-jewel.
--
-- MỤC TIÊU (BẤT BIẾN #2 — không hard-delete tenant gốc + tài khoản; DB-08 §8.1 rule 4):
--   mig 0002 GRANT SELECT,INSERT,UPDATE,DELETE ON companies + users TO mediaos_app. Cả hai bảng đã có cột
--   deleted_at (soft-delete) → app-role KHÔNG được xoá CỨNG. WO này REVOKE riêng DELETE khỏi mediaos_app,
--   GIỮ NGUYÊN SELECT/INSERT/UPDATE (soft-delete = UPDATE set deleted_at + create/update admin vẫn chạy).
--   Mọi bảng foundation band 0431+ đều đã bỏ DELETE — WO này kéo companies/users về cùng chuẩn.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 company_id/RLS: companies + users ĐÃ ENABLE + FORCE ROW LEVEL SECURITY + policy tenant-iso từ mig
--      0002 — WO này KHÔNG đụng RLS/FORCE/policy. KHÔNG backfill company_id (không có gì để "đặt-RLS-trước").
--   #2 REVOKE DELETE tường minh → app-role DELETE companies/users PHẢI FAIL (42501 insufficient_privilege).
--      Idempotent: REVOKE quyền chưa-có là no-op an toàn. Tái khẳng định GRANT SELECT,INSERT,UPDATE
--      (KHÔNG nới rộng) để nêu rõ phạm vi mong muốn.
--   • Precondition (Đội 2 re-verify): 0 writer `.delete(companies|users)` trong apps/api/src (drizzle + raw
--     `DELETE FROM`) → KHÔNG cần lane chuyển-soft-delete trước; siết grant an toàn. Seed/teardown test đi qua
--     role owner/superuser (direct pool) — KHÔNG bị ảnh hưởng; chỉ siết mediaos_app. Xoá tenant/user thật đi
--     qua UPDATE deleted_at (CompanyService.updateCompany / auth users), KHÔNG DELETE.
--   • KHÔNG db:generate — grant KHÔNG biểu diễn được bằng drizzle schema → viết SQL tay (convention 04xx).
--   • DELETE là quyền CẤP-BẢNG (không tồn tại DELETE theo cột) → REVOKE chỉ đụng DELETE. GRANT UPDATE
--     (last_login_at) cấp-CỘT ở mig 0370 KHÔNG bị chạm.
--
-- BAND 0467 (lane S2-FND-DB-1). Journal: idx 147, when 1717500730000 (> head 0466 idx 146 / 1717500725000).
--   Nối tiếp ĐƠN ĐIỆU sau 0466_s2_authdb4_user_require_2fa_reset_perm.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- REVOKE DELETE — chặn hard-delete companies (gốc tenant) + users (tài khoản). RLS/FORCE/policy (mig 0002)
-- GIỮ NGUYÊN. Idempotent (REVOKE quyền chưa-có = no-op).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE DELETE ON companies, users FROM mediaos_app;
--> statement-breakpoint

-- Tái khẳng định grant đúng phạm vi (SELECT/INSERT/UPDATE) — KHÔNG cấp lại DELETE. Idempotent.
GRANT SELECT, INSERT, UPDATE ON companies, users TO mediaos_app;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- Fail-LOUD (mẫu mig 0466 fail-loud): xác nhận SAU migration mediaos_app KHÔNG còn DELETE trên
-- companies/users, đồng thời VẪN còn SELECT/INSERT/UPDATE (KHÔNG over-revoke). Tránh âm thầm trượt REVOKE
-- (vd grant DELETE bị cấp lại ở migration tương lai) hoặc siết quá tay.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_table_privilege('mediaos_app', 'companies', 'DELETE') THEN
    RAISE EXCEPTION '[0467] mediaos_app VẪN còn DELETE trên companies sau REVOKE — BẤT BIẾN #2 vỡ.';
  END IF;
  IF has_table_privilege('mediaos_app', 'users', 'DELETE') THEN
    RAISE EXCEPTION '[0467] mediaos_app VẪN còn DELETE trên users sau REVOKE — BẤT BIẾN #2 vỡ.';
  END IF;
  IF NOT (has_table_privilege('mediaos_app', 'companies', 'SELECT')
      AND has_table_privilege('mediaos_app', 'companies', 'INSERT')
      AND has_table_privilege('mediaos_app', 'companies', 'UPDATE')) THEN
    RAISE EXCEPTION '[0467] mediaos_app THIẾU SELECT/INSERT/UPDATE trên companies — REVOKE quá tay.';
  END IF;
  IF NOT (has_table_privilege('mediaos_app', 'users', 'SELECT')
      AND has_table_privilege('mediaos_app', 'users', 'INSERT')
      AND has_table_privilege('mediaos_app', 'users', 'UPDATE')) THEN
    RAISE EXCEPTION '[0467] mediaos_app THIẾU SELECT/INSERT/UPDATE trên users — REVOKE quá tay.';
  END IF;
  RAISE NOTICE '[0467] REVOKE DELETE companies+users OK — SELECT/INSERT/UPDATE giữ nguyên (append-only tenant/account)';
END $$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy; BẤT BIẾN #2 KHÔNG khôi phục DELETE) --------
-- GRANT DELETE ON companies, users TO mediaos_app;  -- (KHÔNG nên — tái mở hard-delete tenant gốc + tài khoản)
