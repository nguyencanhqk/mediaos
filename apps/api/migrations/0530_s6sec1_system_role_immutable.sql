-- S6-SEC-1 · S0-B — CHẶN GHI CHÉO TENANT LÊN ROLE HỆ THỐNG TOÀN CỤC
--
-- LỖ HỔNG (FULL gate `rls-tenant-isolation-tester`, đã tái lập trên DB thật, đã commit + đọc lại được
-- từ tenant khác): admin của MỘT tenant, chỉ cần `assign:permission`, XOÁ được `role_permissions` của
-- role hệ thống **toàn cục** (`roles.company_id IS NULL`) — role mà MỌI tenant dùng chung.
--
-- CƠ CHẾ. Policy `role_permissions_tenant_isolation` (mig 0005) cố ý đặt `OR r.company_id IS NULL`
-- trong `USING` để tenant ĐỌC được role hệ thống, và đặt `WITH CHECK` chặt để chặn GHI. Nhưng
-- **Postgres KHÔNG áp `WITH CHECK` cho DELETE** — DELETE chỉ qua `USING`. Vì vậy khe hở dành cho ĐỌC
-- trở thành QUYỀN XOÁ. Chú thích ở 0005 ("WITH CHECK … system roles immutable") mô tả sai hành vi thật
-- của Postgres; đây là migration sửa lại cho khớp ý định ban đầu.
--
-- HẬU QUẢ nếu không vá: mất grant vĩnh viễn cho toàn hệ — `WITH CHECK` chặn INSERT khôi phục, nên
-- không hoàn tác được qua ứng dụng (phải superuser/migration).
--
-- CÁCH VÁ (2 lớp ở tầng DB; tầng app thêm guard `isSystem` riêng — defense in depth):
--   (a) Policy RESTRICTIVE cho DELETE trên `role_permissions`. RESTRICTIVE được AND với policy
--       permissive sẵn có (permissive thì OR) ⇒ giữ nguyên đường ĐỌC role hệ thống, chỉ siết DELETE
--       về đúng role thuộc tenant hiện tại.
--   (b) Thu hồi GRANT DELETE trên `roles` khỏi `mediaos_app`. Đã kiểm: KHÔNG code path nào dùng —
--       `deleteRole` xoá MỀM bằng UPDATE (`deleted_at`), và UPDATE vẫn an toàn vì WITH CHECK áp cho
--       UPDATE (hàng mới `company_id IS NULL` không thoả ⇒ bị chặn). Quyền DELETE ở đây là đặc quyền
--       thừa, biến một lỗi code tương lai thành thảm hoạ.
--
-- KHÔNG đụng dữ liệu; không backfill; idempotent.

-- (a) role_permissions: DELETE chỉ cho role THUỘC tenant hiện tại.
DROP POLICY IF EXISTS role_permissions_no_delete_system ON role_permissions;
--> statement-breakpoint

CREATE POLICY role_permissions_no_delete_system ON role_permissions
  AS RESTRICTIVE
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_id
        AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    )
  );
--> statement-breakpoint

-- (b) roles: gỡ đặc quyền DELETE thừa của app role (xoá role = soft-delete qua UPDATE).
REVOKE DELETE ON roles FROM mediaos_app;
