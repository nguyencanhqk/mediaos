-- Migration 0060: G11-0 — mở rộng audit_logs_object_type_chk cho G11 (HR Attendance/Leave).
-- Tiền lệ: 0011/0014/0020 (DROP+ADD CHECK qua migration role / DATABASE_DIRECT_URL).
--   Append-only (BẤT BIẾN #2) áp cho *app-role DML*, KHÔNG phải migration DDL → DROP/ADD ở đây hợp lệ.
-- ⚠️ PHẢI chạy TRƯỚC mọi bước G11 khác — nếu không audit_logs ghi 'attendance_record', 'leave_request'…
--    sẽ vi phạm CHECK constraint → runtime error (class bug G4-7/G5-0a/G6-0).
-- ⚠️ MERGE NOTE (ĐÃ GIẢI 2026-06-12, rebase lên master 6a0d4bd): danh sách dưới = 0033 (24 type,
--    gồm 'workflow_template' G7 đã land master) + 7 type G11 = 31 type. 0060 chạy SAU 0033 nên
--    DROP+ADD tại đây PHẢI là superset của 0033 — thiếu type nào là xoá type đó khỏi CHECK (CRITICAL-3).
--    Nếu G9/G10 thêm object type trước khi G11 land, NGƯỜI MERGE hợp nhất tiếp tại đây.
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
    'workflow_template',
    'work_schedule',
    'attendance_record',
    'attendance_adjustment_request',
    'attendance_period',
    'leave_type',
    'leave_request',
    'leave_balance'
  ));
