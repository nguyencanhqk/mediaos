-- Migration 0081: G8-1 — extend audit_logs_object_type_chk for the approval domain.
--
-- BAND 0080s (lane G8). Precedent: 0011/0014/0020/0033 (DROP+ADD CHECK via migration role / DIRECT_URL).
--   Append-only (BẤT BIẾN #2) applies to *app-role DML*, NOT to migration DDL → DROP/ADD CONSTRAINT valid.
-- HOT-FILE rule (TASKS §5.3): the CHECK list = UNION(all lanes). Here = 24 types from 0033 (byte-identical)
--   + 'approval_rule' appended. Re-merge across lanes = recompute the full union; never rewrite/shrink.
-- Sync with AUDIT_OBJECT_TYPES (db/schema/audit.ts) in the SAME commit (TS const + SQL CHECK move together).
--
-- ApprovalLevelApproved / ApprovalRejected (G8 multi-level) audit with object_type='approval_request'
--   (already allowed since 0011) → no new type needed for them. 'approval_rule' is added for future
--   audit of rule create/update; harmless to add now (keeps the union ready, no rewrite later).

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
    'approval_rule'
  ));
