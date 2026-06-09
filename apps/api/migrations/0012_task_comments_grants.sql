-- Migration 0012: task_comments thiếu GRANT và policy sai (không NULLIF → crash khi không có ngữ cảnh tenant).

-- Sửa RLS policy: thêm NULLIF để tránh invalid input syntax khi setting rỗng
ALTER POLICY task_comments_tenant_isolation ON task_comments
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);

-- GRANT bị bỏ sót ở 0009
GRANT SELECT, INSERT, UPDATE, DELETE ON task_comments TO mediaos_app;
GRANT SELECT ON task_comments TO mediaos_worker;
