-- Migration 0071: G13-2 — cost_records (APPEND-ONLY) + cost_allocations (mutable có kiểm soát).
-- Journal: wire khi land (xem MERGE NOTE 0070). Bảng mới rỗng → RLS+FORCE TRƯỚC, không cửa sổ backfill.

-- ═══ cost_records — sổ cái chi phí APPEND-ONLY (GRANT SELECT,INSERT) ═══
-- Giống revenue: chain entry_kind + replaces_record_id; không updated_at/deleted_at; status suy ra từ chain.
-- expense_request_id (lineage cost↔đề xuất chi) ADD ở 0073 (sau khi expense_requests tồn tại).
CREATE TABLE cost_records (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  cost_type          text NOT NULL,
  amount             numeric(18,2) NOT NULL,
  currency           text NOT NULL DEFAULT 'VND',
  cost_date          date NOT NULL,
  org_unit_id        uuid REFERENCES org_units(id) ON DELETE SET NULL,
  team_id            uuid REFERENCES teams(id) ON DELETE SET NULL,
  project_id         uuid REFERENCES projects(id) ON DELETE SET NULL,
  channel_id         uuid REFERENCES channels(id) ON DELETE SET NULL,
  content_item_id    uuid REFERENCES content_items(id) ON DELETE SET NULL,
  user_id            uuid REFERENCES users(id) ON DELETE SET NULL,
  vendor_name        text,
  description        text,
  attachment_url     text,
  entered_by         uuid NOT NULL REFERENCES users(id),
  entry_kind         text NOT NULL DEFAULT 'original',
  replaces_record_id uuid REFERENCES cost_records(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_records_cost_type_check CHECK (cost_type IN
    ('salary','freelancer','software','equipment','ads','production','training','recruitment','operation','other')),
  CONSTRAINT cost_records_entry_kind_check CHECK (entry_kind IN ('original','adjustment','void')),
  CONSTRAINT cost_records_chain_check CHECK (
    (entry_kind = 'original' AND replaces_record_id IS NULL)
    OR (entry_kind IN ('adjustment','void') AND replaces_record_id IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE cost_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cost_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY cost_records_app_tenant_iso ON cost_records
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX cost_records_company_date_idx    ON cost_records (company_id, cost_date);
--> statement-breakpoint
CREATE INDEX cost_records_company_type_idx    ON cost_records (company_id, cost_type);
--> statement-breakpoint
CREATE INDEX cost_records_company_channel_idx ON cost_records (company_id, channel_id);
--> statement-breakpoint
CREATE INDEX cost_records_company_project_idx ON cost_records (company_id, project_id);
--> statement-breakpoint
CREATE INDEX cost_records_company_content_idx ON cost_records (company_id, content_item_id);
--> statement-breakpoint
CREATE INDEX cost_records_company_org_idx     ON cost_records (company_id, org_unit_id);
--> statement-breakpoint
CREATE INDEX cost_records_company_team_idx    ON cost_records (company_id, team_id);
--> statement-breakpoint
CREATE UNIQUE INDEX cost_records_replaces_uq
  ON cost_records (replaces_record_id) WHERE replaces_record_id IS NOT NULL;
--> statement-breakpoint
GRANT SELECT, INSERT ON cost_records TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON cost_records TO mediaos_worker;
--> statement-breakpoint

-- ═══ cost_allocations — phân bổ chi phí (FIN-003) — mutable có kiểm soát: GRANT SELECT,INSERT,UPDATE ═══
-- KHÔNG DELETE: re-allocate = soft-delete set cũ (deleted_at) + insert set mới cùng tx + audit CostReallocated.
-- allocation_target_id polymorphic (channel/project/content_item/team/org_unit/employee) — KHÔNG FK; service
-- validate target tồn tại trong tenant. Tiền tính bằng cents integer (money.ts), dồn dư target cuối.
CREATE TABLE cost_allocations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL
                           DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                           REFERENCES companies(id) ON DELETE CASCADE,
  cost_record_id         uuid NOT NULL REFERENCES cost_records(id) ON DELETE CASCADE,
  allocation_run_id      uuid NOT NULL,
  allocation_target_type text NOT NULL,
  allocation_target_id   uuid NOT NULL,
  allocation_method      text NOT NULL,
  allocated_amount       numeric(18,2) NOT NULL,
  allocation_percent     numeric(7,4),
  calculated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,
  CONSTRAINT cost_allocations_target_type_check CHECK (allocation_target_type IN
    ('channel','project','content_item','team','org_unit','employee')),
  CONSTRAINT cost_allocations_method_check CHECK (allocation_method IN
    ('equal_split','manual_percent','by_video_count','by_task_count','by_work_hours','by_revenue_ratio'))
);
--> statement-breakpoint
ALTER TABLE cost_allocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cost_allocations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY cost_allocations_app_tenant_iso ON cost_allocations
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX cost_allocations_company_cost_idx ON cost_allocations (company_id, cost_record_id);
--> statement-breakpoint
CREATE INDEX cost_allocations_company_run_idx  ON cost_allocations (company_id, allocation_run_id);
--> statement-breakpoint
CREATE INDEX cost_allocations_company_target_idx
  ON cost_allocations (company_id, allocation_target_type, allocation_target_id);
--> statement-breakpoint
-- 1 cost chỉ phân bổ ĐANG hiệu lực 1 lần tới mỗi target (chặn double-allocate); soft-delete cho phép re-run.
CREATE UNIQUE INDEX cost_allocations_active_uq
  ON cost_allocations (cost_record_id, allocation_target_type, allocation_target_id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON cost_allocations TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON cost_allocations TO mediaos_worker;

-- Down: DROP TABLE cost_allocations; DROP TABLE cost_records;
