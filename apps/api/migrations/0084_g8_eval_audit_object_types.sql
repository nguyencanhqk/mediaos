-- Migration 0084: G8-3 — extend audit_logs_object_type_chk for the evaluation domain.
--
-- BAND 0080s (lane G8). Precedent: 0011/0014/0020/0033/0060/0070/0081 (DROP+ADD CHECK via DIRECT_URL).
--   Append-only (BẤT BIẾN #2) applies to *app-role DML*, NOT to migration DDL → DROP/ADD CONSTRAINT valid.
-- HOT-FILE rule (TASKS §5.3): the CHECK list = UNION(all lanes). Here = full list from 0081 (byte-identical)
--   + 'evaluation_template' + 'evaluation_result' appended. Re-merge across lanes = recompute the full
--   union; never rewrite/shrink/drop another lane's type.
-- Sync with AUDIT_OBJECT_TYPES (db/schema/audit.ts) in the SAME commit (TS const + SQL CHECK move together).
--
-- Audit on scoring: recordScores() writes audit_logs object_type='evaluation_result' IN THE SAME tx
--   (DoD audit + bất biến #2). 'evaluation_template' added for future audit of template create/update.

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
    -- G11 HR attendance/leave
    'work_schedule',
    'attendance_record',
    'attendance_adjustment_request',
    'attendance_period',
    'leave_type',
    'leave_request',
    'leave_balance',
    -- G10 communication
    'chat_room',
    'chat_message',
    'notification',
    'notification_rule',
    'notification_preference',
    'meeting',
    'meeting_room',
    -- G13 finance
    'revenue_record',
    'cost_record',
    'cost_allocation',
    'profit_snapshot',
    'expense_request',
    -- G8 approval (multi-level rules)
    'approval_rule',
    -- G8-3 evaluation
    'evaluation_template',
    'evaluation_result'
  ));
