-- Migration 0088: G8-4 (KPI) — kpi_definitions (mutable, soft-delete) + kpi_results (SNAPSHOT APPEND-ONLY).
--
-- BAND 0080s (lane G8) — guard-migration-band ENFORCES range for feat/g8-kpi. 0086/0087 đã dùng cho
--   Defect (merged master 1a4094a) → KPI BẮT BUỘC dùng 0088/0089 (KHÔNG 0086).
-- KPI cá nhân/team (G8-4, TASKS): trọng số 5 thành phần → kết quả KPI snapshot bất biến theo kỳ.
--
-- GX-4 / CLAUDE §3: RLS policy + FORCE created BEFORE any row → no cross-tenant leak window (BẤT BIẾN #1).
-- company_id NOT NULL DEFAULT app.current_company_id + USING + WITH CHECK trên MỌI bảng.
--
-- BẤT BIẾN #2 (append-only): kpi_results GRANT SELECT,INSERT ONLY (no UPDATE/DELETE) → snapshot có vết.
--   "Sửa/xác nhận" = INSERT bản snapshot MỚI, KHÔNG mutate bản cũ. kpi_definitions mutable có kiểm soát
--   (soft-delete qua deleted_at, GRANT SELECT,INSERT,UPDATE — không hard-DELETE).
-- BR-007: kpi_results.confirmed_by/confirmed_at mặc định NULL = chưa xác nhận = THAM KHẢO. Chỉ user có
--   quyền confirm:kpi (HR/quản lý) mới set, qua snapshot mới. Compute KHÔNG tự đẩy vào lương.

-- ─── kpi_definitions (mutable: SELECT,INSERT,UPDATE — soft-delete, no DELETE) ──
-- weights jsonb: 5 thành phần (tasksDone/onTimeRate/evaluationScore/defectScore/firstPassApprovalRate),
--   tổng = 100 (ép ở Zod refine + service assertWeightSum + CHECK numeric dưới đây).
CREATE TABLE kpi_definitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies (id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  weights     jsonb NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  -- Tổng 5 trọng số = 100 (defense-in-depth song song service). Mỗi trọng số ∈ [0,100].
  CONSTRAINT kpi_definitions_weights_sum_chk CHECK (
    abs(
      (weights->>'tasksDone')::numeric +
      (weights->>'onTimeRate')::numeric +
      (weights->>'evaluationScore')::numeric +
      (weights->>'defectScore')::numeric +
      (weights->>'firstPassApprovalRate')::numeric - 100
    ) < 0.0001
  )
);
--> statement-breakpoint
CREATE INDEX kpi_definitions_company_idx ON kpi_definitions (company_id);
--> statement-breakpoint
ALTER TABLE kpi_definitions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE kpi_definitions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY kpi_definitions_tenant_isolation ON kpi_definitions
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON kpi_definitions TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON kpi_definitions TO mediaos_worker;
--> statement-breakpoint

-- ─── kpi_results (SNAPSHOT APPEND-ONLY: SELECT,INSERT only — bất biến #2) ──
-- Chủ thể = user XOR team (CHECK đúng-1-trong-2). confirmed_by/confirmed_at NULL = chưa xác nhận (BR-007).
CREATE TABLE kpi_results (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL
                              DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                              REFERENCES companies (id) ON DELETE CASCADE,
  definition_id             uuid NOT NULL REFERENCES kpi_definitions (id) ON DELETE CASCADE,
  -- Chủ thể: user HOẶC team (đúng 1). NOT NULL → NO ACTION (giữ chủ thể cho audit; users/teams soft-delete).
  subject_user_id           uuid REFERENCES users (id),
  subject_team_id           uuid REFERENCES teams (id),
  period_start              timestamptz NOT NULL,
  period_end                timestamptz NOT NULL,
  -- Điểm thành phần ĐÃ TÍNH (thang 0..100) — snapshot bất biến.
  tasks_done                numeric(6, 2) NOT NULL,
  on_time_rate              numeric(6, 2) NOT NULL,
  evaluation_score          numeric(6, 2) NOT NULL,
  defect_score              numeric(6, 2) NOT NULL,
  first_pass_approval_rate  numeric(6, 2) NOT NULL,
  -- Điểm KPI tổng có trọng số (clamp [0,100] ở service).
  total_score               numeric(6, 2) NOT NULL,
  -- BR-007: NULL = chưa xác nhận = THAM KHẢO. Set qua snapshot mới khi confirm:kpi.
  confirmed_by              uuid REFERENCES users (id),
  confirmed_at              timestamptz,
  computed_by               uuid NOT NULL REFERENCES users (id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  -- Đúng 1 chủ thể (user XOR team).
  CONSTRAINT kpi_results_subject_chk CHECK (
    (subject_user_id IS NOT NULL AND subject_team_id IS NULL)
    OR (subject_user_id IS NULL AND subject_team_id IS NOT NULL)
  ),
  -- period_end sau period_start.
  CONSTRAINT kpi_results_period_chk CHECK (period_end > period_start),
  -- Điểm/tỷ lệ trong [0,100].
  CONSTRAINT kpi_results_score_range_chk CHECK (
    tasks_done BETWEEN 0 AND 100 AND on_time_rate BETWEEN 0 AND 100
    AND evaluation_score BETWEEN 0 AND 100 AND defect_score BETWEEN 0 AND 100
    AND first_pass_approval_rate BETWEEN 0 AND 100 AND total_score BETWEEN 0 AND 100
  ),
  -- confirmed_by/confirmed_at đi cùng nhau (cùng NULL hoặc cùng có).
  CONSTRAINT kpi_results_confirmed_pair_chk CHECK (
    (confirmed_by IS NULL AND confirmed_at IS NULL)
    OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX kpi_results_company_idx ON kpi_results (company_id);
--> statement-breakpoint
CREATE INDEX kpi_results_company_period_idx ON kpi_results (company_id, period_start, period_end);
--> statement-breakpoint
CREATE INDEX kpi_results_company_subject_user_idx ON kpi_results (company_id, subject_user_id);
--> statement-breakpoint
CREATE INDEX kpi_results_company_subject_team_idx ON kpi_results (company_id, subject_team_id);
--> statement-breakpoint
ALTER TABLE kpi_results ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE kpi_results FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY kpi_results_tenant_isolation ON kpi_results
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- APPEND-ONLY (bất biến #2): snapshot có vết. NO UPDATE/DELETE cho app role.
GRANT SELECT, INSERT ON kpi_results TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON kpi_results TO mediaos_worker;
--> statement-breakpoint

-- ─── audit_logs object_type CHECK = UNION (HOT-FILE §5.3) ──
-- Nguồn UNION: 0086_g8_defect_columns_audit.sql (48 type, kết thúc ở 'defect'). KPI append 2 type:
--   'kpi_definition' (tạo/sửa định nghĩa) + 'kpi_result' (compute + confirm). KHÔNG drop type lane khác.
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
    'defect',
    -- G8-4 KPI (compute + confirm ghi 'kpi_result'; tạo/sửa định nghĩa ghi 'kpi_definition')
    'kpi_definition',
    'kpi_result'
  ));
