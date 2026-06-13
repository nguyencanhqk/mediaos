-- Migration 0072: G13-3 — profit_snapshots (APPEND-ONLY, bất biến #2).
-- Journal: wire khi land (xem MERGE NOTE 0070). Mỗi lần tính = 1 snapshot mới (calculated_at); "latest" =
-- mới nhất theo thời gian. KHÔNG chain, KHÔNG updated_at/deleted_at. GRANT SELECT,INSERT.
--
-- Công thức: profit = total_revenue − total_direct_cost − total_allocated_cost (total_cost giữ lại = tổng);
-- profit_margin = profit/total_revenue (NULL khi revenue=0). target IN 7 giá trị ERD (MVP compute 4:
-- company/channel/project/content_item; còn lại app trả 400 "chưa hỗ trợ").
CREATE TABLE profit_snapshots (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL
                         DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                         REFERENCES companies(id) ON DELETE CASCADE,
  target_type          text NOT NULL,
  target_id            uuid,
  period_start         date NOT NULL,
  period_end           date NOT NULL,
  total_revenue        numeric(18,2) NOT NULL,
  total_direct_cost    numeric(18,2) NOT NULL,
  total_allocated_cost numeric(18,2) NOT NULL,
  total_cost           numeric(18,2) NOT NULL,
  profit               numeric(18,2) NOT NULL,
  profit_margin        numeric(9,4),
  calculated_at        timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT profit_snapshots_target_type_check CHECK (target_type IN
    ('company','platform','channel','project','content_item','org_unit','team')),
  -- company scope ⇒ target_id NULL (toàn công ty); scope con ⇒ target_id NOT NULL.
  CONSTRAINT profit_snapshots_target_id_check CHECK (
    (target_type = 'company' AND target_id IS NULL)
    OR (target_type <> 'company' AND target_id IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE profit_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE profit_snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY profit_snapshots_app_tenant_iso ON profit_snapshots
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX profit_snapshots_company_target_idx
  ON profit_snapshots (company_id, target_type, target_id, calculated_at);
--> statement-breakpoint
CREATE INDEX profit_snapshots_company_period_idx
  ON profit_snapshots (company_id, period_start, period_end);
--> statement-breakpoint
GRANT SELECT, INSERT ON profit_snapshots TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON profit_snapshots TO mediaos_worker;

-- Down: DROP TABLE profit_snapshots;
