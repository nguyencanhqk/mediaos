-- Migration 0083: G8-3 (EVAL) — evaluation_templates + evaluation_criteria + evaluation_results + evaluation_scores.
--
-- BAND 0080s (lane G8) — guard-migration-band ENFORCES this number range for feat/g8-approval.
-- Đánh giá: template + tiêu chí (trọng số) + chấm điểm gắn vào workflow step (G8-3, TASKS).
--
-- GX-4 / CLAUDE §3: RLS policy + FORCE created BEFORE any row → no cross-tenant leak window (BẤT BIẾN #1).
-- company_id NOT NULL DEFAULT app.current_company_id + USING + WITH CHECK trên MỌI bảng.
--
-- BẤT BIẾN #2 (append-only): evaluation_results + evaluation_scores GRANT SELECT,INSERT ONLY (no UPDATE/DELETE)
--   → chấm điểm bất biến, có vết. templates/criteria mutable có kiểm soát (soft-delete qua deleted_at, no DELETE).
-- uq(result_id, criteria_id) trên scores → idempotent: chấm lại trùng (result,criteria) bị DB chặn (23505→409).

-- ─── evaluation_templates (mutable: SELECT,INSERT,UPDATE — soft-delete, no DELETE) ──
CREATE TABLE evaluation_templates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies (id) ON DELETE CASCADE,
  name               text NOT NULL,
  description        text,
  -- Gắn template với 1 loại bước workflow (advisory; nullable).
  workflow_step_code text,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
--> statement-breakpoint
CREATE INDEX evaluation_templates_company_idx ON evaluation_templates (company_id);
--> statement-breakpoint
ALTER TABLE evaluation_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE evaluation_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY evaluation_templates_tenant_isolation ON evaluation_templates
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON evaluation_templates TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON evaluation_templates TO mediaos_worker;
--> statement-breakpoint

-- ─── evaluation_criteria (mutable: SELECT,INSERT,UPDATE — soft-delete, no DELETE) ──
CREATE TABLE evaluation_criteria (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies (id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES evaluation_templates (id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  -- Trọng số phần trăm — dương, tối đa 100. Tổng tiêu chí ACTIVE của 1 template = 100 (ép ở service).
  weight      numeric(6, 2) NOT NULL CHECK (weight > 0 AND weight <= 100),
  min_score   numeric(8, 2) NOT NULL DEFAULT 0,
  max_score   numeric(8, 2) NOT NULL DEFAULT 10,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CHECK (max_score > min_score)
);
--> statement-breakpoint
CREATE INDEX evaluation_criteria_company_idx ON evaluation_criteria (company_id);
--> statement-breakpoint
CREATE INDEX evaluation_criteria_template_idx ON evaluation_criteria (company_id, template_id);
--> statement-breakpoint
ALTER TABLE evaluation_criteria ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE evaluation_criteria FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY evaluation_criteria_tenant_isolation ON evaluation_criteria
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON evaluation_criteria TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON evaluation_criteria TO mediaos_worker;
--> statement-breakpoint

-- ─── evaluation_results (APPEND-ONLY: SELECT,INSERT only — bất biến #2) ──
CREATE TABLE evaluation_results (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL
                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies (id) ON DELETE CASCADE,
  template_id       uuid NOT NULL REFERENCES evaluation_templates (id) ON DELETE CASCADE,
  -- Bước workflow được chấm (gắn evaluation vào workflow step — FK đọc, không sửa shape workflow).
  workflow_step_id  uuid NOT NULL REFERENCES workflow_steps (id) ON DELETE CASCADE,
  -- Người được đánh giá (chủ thể) — NOT NULL → NO ACTION (giữ tác giả/đối tượng cho audit, users soft-delete).
  subject_user_id   uuid REFERENCES users (id),
  evaluator_user_id uuid NOT NULL REFERENCES users (id),
  total_score       numeric(10, 2) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX evaluation_results_company_idx ON evaluation_results (company_id);
--> statement-breakpoint
CREATE INDEX evaluation_results_company_step_idx ON evaluation_results (company_id, workflow_step_id);
--> statement-breakpoint
CREATE INDEX evaluation_results_company_template_idx ON evaluation_results (company_id, template_id);
--> statement-breakpoint
ALTER TABLE evaluation_results ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE evaluation_results FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY evaluation_results_tenant_isolation ON evaluation_results
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- APPEND-ONLY (bất biến #2): chấm điểm bất biến, có vết. NO UPDATE/DELETE cho app role.
GRANT SELECT, INSERT ON evaluation_results TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON evaluation_results TO mediaos_worker;
--> statement-breakpoint

-- ─── evaluation_scores (APPEND-ONLY: SELECT,INSERT only — bất biến #2) ──
CREATE TABLE evaluation_scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies (id) ON DELETE CASCADE,
  result_id   uuid NOT NULL REFERENCES evaluation_results (id) ON DELETE CASCADE,
  criteria_id uuid NOT NULL REFERENCES evaluation_criteria (id) ON DELETE CASCADE,
  score       numeric(8, 2) NOT NULL,
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX evaluation_scores_company_idx ON evaluation_scores (company_id);
--> statement-breakpoint
CREATE INDEX evaluation_scores_result_idx ON evaluation_scores (company_id, result_id);
--> statement-breakpoint
-- Idempotent/append-only: 1 điểm cho mỗi (result, criteria). Chấm lại trùng → 23505 → 409.
CREATE UNIQUE INDEX evaluation_scores_result_criteria_uq ON evaluation_scores (result_id, criteria_id);
--> statement-breakpoint
ALTER TABLE evaluation_scores ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE evaluation_scores FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY evaluation_scores_tenant_isolation ON evaluation_scores
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- APPEND-ONLY (bất biến #2): NO UPDATE/DELETE cho app role.
GRANT SELECT, INSERT ON evaluation_scores TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON evaluation_scores TO mediaos_worker;
