-- G7-4 (0035): evaluation-hook con-trỏ trên workflow_definition_steps (KHÔNG engine — engine ở G8)
-- + partial-unique ACTIVE lock guard trên workflow_step_instance_locks (bảng đã tạo từ 0008).
-- KHÔNG bảng mới → RLS không đổi (locks đã RLS+FORCE từ 0008; eval cols nằm trên bảng đã cô lập tenant).
-- CHECK/cột byte-identical với db/schema/workflow.ts.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ALTER workflow_definition_steps — evaluation hook (con trỏ, KHÔNG engine ở G7).
--    requires_evaluation: bước approved sẽ emit step.evaluation_required (consumer G8 tiêu thụ ở 4c).
--    evaluation_template_id: SOFT ref (bảng eval thật ở G8) → uuid trần, KHÔNG FK (pattern content_types G6-4).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE workflow_definition_steps
  ADD COLUMN requires_evaluation    boolean NOT NULL DEFAULT false,
  ADD COLUMN evaluation_template_id uuid;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. workflow_step_instance_locks — tối đa 1 lock ACTIVE / (locked_step, caused_by).
--    Chống replay revision tích row active trùng (BR-006/4a). Lock đã release (released_at set) KHÔNG tính.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX wf_step_locks_active_uq
  ON workflow_step_instance_locks (company_id, locked_step_id, caused_by_step_id)
  WHERE released_at IS NULL;
--> statement-breakpoint
