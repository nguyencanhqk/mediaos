-- Migration 0020: G6-0 — mở rộng audit_logs_object_type_chk để hỗ trợ G6 object types.
-- Tiền lệ: 0011/0014 đã làm mẫu tương tự (DROP+ADD CHECK qua migration role / DATABASE_DIRECT_URL).
--   Append-only (BẤT BIẾN #2) áp cho *app-role DML*, KHÔNG phải migration DDL → DROP/ADD CONSTRAINT ở đây hợp lệ.
-- ⚠️ PHẢI chạy TRƯỚC mọi bước G6 khác — nếu không mọi audit_logs ghi 'channel', 'platform_account',
--    'project', 'content'… sẽ vi phạm CHECK constraint → runtime error (class bug G4-7/G5-0a).
-- Đồng bộ với AUDIT_OBJECT_TYPES (db/schema/audit.ts) trong CÙNG commit (TS const + SQL CHECK đổi cùng lúc).
-- 12 type cũ (đến 'team') giữ nguyên byte-identical 0014; append 11 type G6.

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
    'content_type'
  ));
