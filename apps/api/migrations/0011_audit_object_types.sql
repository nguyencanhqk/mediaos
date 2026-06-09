-- Migration 0011: mở rộng audit_logs_object_type_chk để khớp AUDIT_OBJECT_TYPES trong schema.
-- Schema đã khai báo đủ types nhưng CHECK constraint ở 0003 chỉ có types G2 ban đầu.

ALTER TABLE audit_logs
  DROP CONSTRAINT audit_logs_object_type_chk;

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_object_type_chk
    CHECK (object_type IN (
      'company',
      'user',
      'auth',
      'outbox_event',
      'workflow_instance',
      'workflow_step',
      'task',
      'approval_request'
    ));
