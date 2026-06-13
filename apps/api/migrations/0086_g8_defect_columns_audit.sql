-- Migration 0086: G8-2 — add defect_type + revision_task_id to defects table;
--   extend audit_logs_object_type_chk to include 'defect'.
--
-- BAND 0080s (lane G8). idx=62, when>1717500124000 (master max at time of write).
-- defects table created by 0008_workflow.sql (master). G8-2 EXTENDS it — never recreates.
-- HOT-FILE rule (TASKS §5.3): CHECK list = UNION(all prior lanes + 'defect').
--   Currently: 47 types (0084 is the last re-stamp). Adding 'defect' = 48 types.
-- defect_type column: text NOT NULL DEFAULT 'other' (safe backfill for rows pre-migration).
-- revision_task_id: nullable FK to tasks (BẤT BIẾN #4 unified task hub).
-- RLS already enabled on defects (0008). No new RLS needed here.
-- Append-only: GRANT SELECT,INSERT only (no UPDATE/DELETE) already set by 0008;
--   new columns inherit same row-level grants automatically.

-- 1. Add defect_type column.
ALTER TABLE defects
  ADD COLUMN IF NOT EXISTS defect_type text NOT NULL DEFAULT 'other';
--> statement-breakpoint

-- 2. Add CHECK on defect_type values.
ALTER TABLE defects
  ADD CONSTRAINT defects_defect_type_chk CHECK (defect_type IN (
    'missing_content',
    'wrong_format',
    'quality_issue',
    'policy_violation',
    'other'
  ));
--> statement-breakpoint

-- 3. Add revision_task_id (nullable FK to tasks — task created when defect is recorded).
ALTER TABLE defects
  ADD COLUMN IF NOT EXISTS revision_task_id uuid REFERENCES tasks (id) ON DELETE SET NULL;
--> statement-breakpoint

-- 4. Extend audit_logs_object_type_chk — UNION of all prior types + 'defect'.
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
    -- G8 approval
    'approval_rule',
    -- G12 payroll
    'salary_profile',
    -- G8-3 evaluation
    'evaluation_template',
    'evaluation_result',
    -- G8-2 defect/revision
    'defect'
  ));
