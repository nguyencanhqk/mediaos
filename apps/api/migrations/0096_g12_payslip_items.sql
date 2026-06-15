-- Migration 0096: G12-2 — payslip_items (dòng chi tiết lương, APPEND-ONLY) + RLS + FORCE + GRANT.
--
-- BAND 0093-0099 (lane G12-period). Mirror 0095 payslips (append-only line items).
-- BẤT BIẾN #2 (append-only): GRANT cho mediaos_app SELECT,INSERT ONLY (KHÔNG UPDATE/DELETE);
--   worker SELECT. company_id NOT NULL DEFAULT + RLS ENABLE/FORCE + policy USING+WITH CHECK (BẤT BIẾN #1).
-- item_type 'kpi'/'bonus'/'penalty' = SLOT cho lane A G8-4 — service KHÔNG sinh các loại này lượt này.
-- payslip_id ON DELETE CASCADE: payslips append-only (không xoá) nên CASCADE chỉ kích hoạt khi DROP TABLE.

CREATE TABLE payslip_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies(id) ON DELETE CASCADE,
  payslip_id  uuid NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
  item_type   text NOT NULL,
  label       text NOT NULL,
  amount      numeric(18,2) NOT NULL,
  meta        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payslip_items_type_check CHECK (item_type IN (
    'earning','deduction','allowance','attendance','kpi','bonus','penalty'
  ))
);
--> statement-breakpoint
ALTER TABLE payslip_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payslip_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payslip_items
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX payslip_items_company_payslip_idx ON payslip_items(company_id, payslip_id);
--> statement-breakpoint
-- APPEND-ONLY: app role chỉ SELECT + INSERT. KHÔNG UPDATE/DELETE (BẤT BIẾN #2). worker chỉ đọc.
GRANT SELECT, INSERT ON payslip_items TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON payslip_items TO mediaos_worker;
