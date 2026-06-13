-- Migration 0090: G12-1 — mở rộng audit_logs_object_type_chk cho G12 (Payroll salary profile).
-- Tiền lệ: 0011/0014/0020/0033/0060 (DROP+ADD CHECK qua migration role / DATABASE_DIRECT_URL).
--   Append-only (BẤT BIẾN #2) áp cho *app-role DML*, KHÔNG phải migration DDL → DROP/ADD ở đây hợp lệ.
-- ⚠️ PHẢI chạy TRƯỚC mọi bước G12 khác — nếu không audit_logs ghi 'salary_profile' (xem/sửa lương)
--    sẽ vi phạm CHECK constraint → runtime error (class bug G4-7/G6-0/G11-0).
-- ⚠️ SUPERSET (rủi ro #1): sau merge master, 0090 được RE-STAMP chạy SAU CÙNG (when > 0100_g14).
--    CHECK cuối trước 0090 do 0081_g8 set = 44 type master (31 G7+HR + 7 G10 + 5 G13 + 1 G8 approval_rule).
--    Danh sách dưới = 44 type master + 1 type G12 'salary_profile' = 45 type. DROP+ADD tại đây PHẢI là
--    SUPERSET của 0081 — thiếu type nào là XOÁ type đó khỏi CHECK (CRITICAL class-bug).
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
    'chat_room',
    'chat_message',
    'notification',
    'notification_rule',
    'notification_preference',
    'meeting',
    'meeting_room',
    'revenue_record',
    'cost_record',
    'cost_allocation',
    'profit_snapshot',
    'expense_request',
    'approval_rule',
    'salary_profile'
  ));
