-- Migration 0487: S4-NOTI-BE-4 (🔴 RED, zone=red, crown) — mở GRANT INSERT,UPDATE cho app role trên
--   notification_events + notification_templates để BE-4 ghi COMPANY-OVERRIDE (bật/tắt event · sửa
--   template theo công ty). GRANT-ONLY DDL — KHÔNG tạo bảng, KHÔNG đổi RLS/policy, KHÔNG db:generate.
--
-- BỐI CẢNH (nối tiếp phần blocked của S4-NOTI-BE-3):
--   0479 tạo notification_events/notification_templates với company_id NULLABLE + RLS+FORCE + policy
--   nullable-tenant (USING company_id=GUC OR IS NULL / WITH CHECK company_id=GUC) và CHỈ GRANT SELECT cho
--   mediaos_app (comment "write company-override → S4-NOTI-BE-3"). BE-3 chỉ kịp làm READ (GET) vì viết
--   override đòi GRANT INSERT,UPDATE mới = DDL ⇒ đẩy sang WO này. Nay mở đúng 2 quyền đó.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 KHÔNG ĐỔI cô lập tenant — KHÔNG ALTER/DROP POLICY, KHÔNG đụng ENABLE/FORCE RLS. Policy WITH CHECK
--      (company_id = GUC, KHÔNG "OR IS NULL") của 0479 là BACKSTOP CỨNG: app role KHÔNG BAO GIỜ ghi được
--      hàng company_id NULL (global). Vì vậy code BE-4 bật/tắt event global = INSERT hàng company-override
--      MỚI (company_id=GUC), KHÔNG UPDATE thẳng hàng global. GRANT chỉ mở khả năng ghi hàng-tenant.
--   #2 KHÔNG grant DELETE — config = toggle/override, KHÔNG hard-delete. notification_delivery_logs GIỮ
--      append-only (SELECT,INSERT) — KHÔNG đụng ở WO này. UPDATE chỉ dùng cho re-toggle override có sẵn
--      của CHÍNH company (predicate kép id + company_id ở repo), KHÔNG phải ghi-đè hàng global.
--   #5 KHÔNG đổi schema/PK/timestamp — thuần GRANT.
--   • Idempotent: GRANT lặp lại KHÔNG lỗi (Postgres cộng dồn quyền). Chạy nhiều lần vô hại.
--   • worker role KHÔNG cần INSERT/UPDATE config (chỉ đọc để render) — GIỮ SELECT-only của 0479.
--
-- BAND 0487 (lane S4-NOTI-BE-4). Journal: idx 167, when 1717500830000 (> head 0486 idx 166 / 1717500825000).
--   Nối tiếp ĐƠN ĐIỆU sau 0486_s4_taskrecon2_contract_comment_legacy.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

GRANT INSERT, UPDATE ON notification_events    TO mediaos_app;
GRANT INSERT, UPDATE ON notification_templates TO mediaos_app;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- REVOKE INSERT, UPDATE ON notification_events    FROM mediaos_app;
-- REVOKE INSERT, UPDATE ON notification_templates FROM mediaos_app;
