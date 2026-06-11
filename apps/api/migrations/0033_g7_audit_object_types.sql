-- Migration 0033: G7-1 — mở rộng audit_logs_object_type_chk để hỗ trợ G7 Workflow Builder.
-- Tiền lệ: 0011/0014/0020 đã làm mẫu (DROP+ADD CHECK qua migration role / DATABASE_DIRECT_URL).
--   Append-only (BẤT BIẾN #2) áp cho *app-role DML*, KHÔNG phải migration DDL → DROP/ADD CONSTRAINT hợp lệ.
-- ⚠️ PHẢI chạy TRƯỚC mọi audit ghi 'workflow_template' (WorkflowTemplatesService 1c) — nếu không INSERT
--    audit_logs vi phạm CHECK → rollback cả transaction nghiệp vụ.
-- Đồng bộ với AUDIT_OBJECT_TYPES (db/schema/audit.ts) trong CÙNG commit (TS const + SQL CHECK đổi cùng lúc).
-- 23 type cũ (đến 'content_type') giữ nguyên byte-identical 0020; append 1 type G7 'workflow_template'
--   (gom audit step/dep/checklist dưới aggregate template, objectId=templateId).

ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_object_type_chk;
--> statement-breakpoint
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_object_type_chk CHECK (object_type IN (
    'company',
    'user',
    'auth',
    'outbox_event',
    'workflow_instance',
    'workflow_step',
    'task',
    'approval_request',
    'employee',
    'position',
    'org_unit',
    'team',
    'channel',
    'platform_account',
    'channel_account',
    'channel_member',
    'project',
    'project_team',
    'project_member',
    'content',
    'content_channel',
    'content_asset',
    'content_type',
    'workflow_template'
  ));
