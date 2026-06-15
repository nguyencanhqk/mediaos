-- Migration 0093: G12-2 — extend audit_logs_object_type_chk for payroll period/payslip/payslip_item.
--
-- BAND 0093-0099 (lane G12-period). idx=65, when>1717500127000 (master max idx 64 = 0052_g10_meeting).
-- HOT-FILE rule (TASKS §5.3): CHECK list = UNION(all prior lanes) + new types. NEVER drop a type.
--   Latest re-stamp in worktree = 0086 (48 types incl 'defect'/'evaluation_*'/'salary_profile').
--   0093 = SUPERSET of those 48 + 3 new = 51 types. Must be the LAST CHECK re-stamp (when > all prior).
--   Class-bug guard: 0095 append-only int-spec asserts INSERT of these 3 types via app role SUCCEEDS.
-- Append-only (BẤT BIẾN #2) applies to app-role DML, NOT migration DDL → DROP/ADD CONSTRAINT is valid.
--   Precedent: 0011/0014/0020/0033/0070/0084/0086 (DROP+ADD CHECK). Runs BEFORE any audit writes payroll.
-- Sync AUDIT_OBJECT_TYPES (db/schema/audit.ts) +3 in the SAME commit.

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
    -- G12 payroll (salary profile)
    'salary_profile',
    -- G8-3 evaluation
    'evaluation_template',
    'evaluation_result',
    -- G8-2 defect/revision
    'defect',
    -- G8-4 KPI (đã land master g8 trước g12 — giữ trong UNION khi 0093 re-stamp CHECK)
    'kpi_definition',
    'kpi_result',
    -- G12-2 payroll period + payslip snapshot (append-only) — NEW
    'payroll_period',
    'payslip',
    'payslip_item'
  ));
