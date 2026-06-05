-- Seed MVP-0 workflow definition cho một company cụ thể.
-- Chạy BÊN TRONG transaction có app.current_company_id đã set (qua withTenant).
-- Idempotent: ON CONFLICT DO NOTHING.
--
-- Cách dùng (ví dụ qua psql):
--   SET LOCAL "app.current_company_id" = '<company-uuid>';
--   \i scripts/seed-workflow-definition.sql
--
-- Hoặc qua NestJS seeder: WorkflowSeedService.seedForCompany(companyId)

-- 1. Workflow definition
INSERT INTO workflow_definitions (code, name, applies_to, max_approval_level, allow_parallel_steps)
VALUES ('video_standard_v0', 'Video chuẩn MVP-0', 'content_item', 1, false)
ON CONFLICT DO NOTHING;

-- 2. Definition steps (bước theo thứ tự)
WITH def AS (
  SELECT id FROM workflow_definitions
  WHERE code = 'video_standard_v0'
    AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
  LIMIT 1
)
INSERT INTO workflow_definition_steps
  (workflow_definition_id, step_order, code, name, assignee_role_code, reviewer_role_code, default_task_title)
SELECT
  def.id,
  s.step_order,
  s.code,
  s.name,
  s.assignee_role_code,
  s.reviewer_role_code,
  s.default_task_title
FROM def, (VALUES
  (1, 'script', 'Viết kịch bản',  'script_writer',  'project_manager', 'Viết kịch bản'),
  (2, 'edit',   'Dựng video',      'video_editor',   'project_manager', 'Dựng video'),
  (3, 'qa',     'Kiểm tra chất lượng', 'qa_reviewer', 'project_manager', 'QA nội dung'),
  (4, 'upload', 'Upload lên kênh', 'uploader',       'project_manager', 'Upload video')
) AS s(step_order, code, name, assignee_role_code, reviewer_role_code, default_task_title)
ON CONFLICT DO NOTHING;

-- 3. Step transitions (FSM data-driven)
-- T1: not_started + start → in_progress (service writes)
-- T2: in_progress + submit → waiting_review (service writes)
-- T3: waiting_review + approve → approved (consumer writes)
-- T4: waiting_review + request_revision → revision (consumer writes)
-- T5: revision + start → in_progress (service writes)
-- T6: approved + open_next → (consumer writes next step in_progress)
-- T7: approved[step=upload] + complete_workflow → (consumer marks instance completed)
WITH def AS (
  SELECT id FROM workflow_definitions
  WHERE code = 'video_standard_v0'
    AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
  LIMIT 1
)
INSERT INTO step_transitions
  (workflow_definition_id, from_state, event, to_state, applies_to_step_code, written_by)
SELECT
  def.id,
  t.from_state,
  t.event,
  t.to_state,
  t.applies_to_step_code,
  t.written_by
FROM def, (VALUES
  ('not_started',    'start',            'in_progress',     NULL,     'service'),
  ('in_progress',    'submit',           'waiting_review',  NULL,     'service'),
  ('waiting_review', 'approve',          'approved',        NULL,     'consumer'),
  ('waiting_review', 'request_revision', 'revision',        NULL,     'consumer'),
  ('revision',       'start',            'in_progress',     NULL,     'service'),
  ('approved',       'open_next',        'in_progress',     NULL,     'consumer'),
  ('approved',       'complete_workflow','completed',       'upload', 'consumer')
) AS t(from_state, event, to_state, applies_to_step_code, written_by)
ON CONFLICT DO NOTHING;
