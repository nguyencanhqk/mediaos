-- Migration 0014: G5-0a — mở rộng audit_logs_object_type_chk để hỗ trợ G5 object types.
-- Tiền lệ: 0011_audit_object_types.sql đã làm mẫu tương tự (DROP+ADD CHECK).
-- ⚠️ PHẢI chạy TRƯỚC mọi bước G5 khác — nếu không mọi audit_logs ghi 'employee', 'position',
--    'org_unit', 'team' sẽ vi phạm CHECK constraint → runtime error (class bug G4-7).

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
    'team'
  ));
