-- Migration 0090: G12-1 — mở rộng audit_logs_object_type_chk cho G12 (Payroll salary profile).
-- Tiền lệ: 0011/0014/0020/0033/0060 (DROP+ADD CHECK qua migration role / DATABASE_DIRECT_URL).
--   Append-only (BẤT BIẾN #2) áp cho *app-role DML*, KHÔNG phải migration DDL → DROP/ADD ở đây hợp lệ.
-- ⚠️ PHẢI chạy TRƯỚC mọi bước G12 khác — nếu không audit_logs ghi 'salary_profile' (xem/sửa lương)
--    sẽ vi phạm CHECK constraint → runtime error (class bug G4-7/G6-0/G11-0).
-- ⚠️ SUPERSET (rủi ro #1): danh sách dưới = 31 type của 0060 (24 G7 + 7 HR, đã land master qua G11)
--    + 1 type G12 'salary_profile' = 32 type. 0090 chạy SAU 0060 nên DROP+ADD tại đây PHẢI là superset
--    của 0060 — thiếu type nào là XOÁ type đó khỏi CHECK (CRITICAL class-bug). Nếu lane band giữa
--    (G8 0080s) thêm object type land trước, NGƯỜI MERGE hợp nhất tiếp tại đây (UNION mọi lane).
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
    'leave_balance',
    'salary_profile'
  ));
