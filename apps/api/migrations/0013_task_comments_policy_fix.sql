-- Migration 0013: task_comments policy thiếu NULLIF — crash khi không có ngữ cảnh tenant.
ALTER POLICY task_comments_tenant_isolation ON task_comments
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
