-- Migration 0060: G11-0 — mở rộng audit_logs_object_type_chk cho G11 (HR Attendance/Leave).
-- Tiền lệ: 0011/0014/0020 (DROP+ADD CHECK qua migration role / DATABASE_DIRECT_URL).
--   Append-only (BẤT BIẾN #2) áp cho *app-role DML*, KHÔNG phải migration DDL → DROP/ADD ở đây hợp lệ.
-- ⚠️ PHẢI chạy TRƯỚC mọi bước G11 khác — nếu không audit_logs ghi 'attendance_record', 'leave_request'…
--    sẽ vi phạm CHECK constraint → runtime error (class bug G4-7/G5-0a/G6-0).
-- ⚠️ MERGE NOTE (lane song song): danh sách dưới = 0020 (23 type, baseline master@0031) + 7 type G11.
--    Nếu G7/G9/G10 đã thêm object type sau 0031, NGƯỜI MERGE phải hợp nhất danh sách tại đây
--    (giống xử lý renumber journal Drizzle).
-- Đồng bộ với AUDIT_OBJECT_TYPES (db/schema/audit.ts) trong CÙNG commit.

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
    'work_schedule',
    'attendance_record',
    'attendance_adjustment_request',
    'attendance_period',
    'leave_type',
    'leave_request',
    'leave_balance'
  ));
