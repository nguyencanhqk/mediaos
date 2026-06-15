-- G14-3: Dashboard Materialized Views
-- Band 0102 (G14 band: 0100-0109)
-- SECURITY NOTE: PostgreSQL MV does NOT enforce RLS at query time.
-- Data for ALL tenants is stored in the MV.
-- Service MUST always filter WHERE company_id = $current when reading.
-- cột ĐẦU = company_id cho mọi MV.

-- ─── mv_dashboard_task_status ─────────────────────────────────────────────────
-- Aggregate: task count per company × status.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dashboard_task_status AS
SELECT
  company_id,
  status,
  COUNT(*)::bigint AS task_count
FROM tasks
WHERE deleted_at IS NULL
GROUP BY company_id, status
WITH NO DATA;

-- UNIQUE INDEX required for REFRESH CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS mv_dashboard_task_status_uq
  ON mv_dashboard_task_status (company_id, status);

-- filter index
CREATE INDEX IF NOT EXISTS mv_dashboard_task_status_company_idx
  ON mv_dashboard_task_status (company_id);

-- ─── mv_dashboard_output ──────────────────────────────────────────────────────
-- Aggregate: task count per company × channel × project × org_unit × month.
-- "Sản lượng" = number of completed/approved tasks grouped by dimensions.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dashboard_output AS
SELECT
  t.company_id,
  t.status,
  p.id          AS project_id,
  p.org_unit_id AS department_id,
  pc.channel_id,
  DATE_TRUNC('month', t.created_at AT TIME ZONE 'UTC')::date AS month,
  COUNT(*)::bigint AS task_count
FROM tasks t
LEFT JOIN projects p      ON p.id = t.project_id AND p.deleted_at IS NULL
LEFT JOIN project_channels pc ON pc.project_id = p.id
WHERE t.deleted_at IS NULL
GROUP BY
  t.company_id,
  t.status,
  p.id,
  p.org_unit_id,
  pc.channel_id,
  DATE_TRUNC('month', t.created_at AT TIME ZONE 'UTC')::date
WITH NO DATA;

-- UNIQUE INDEX required for REFRESH CONCURRENTLY
-- Use a hash of (company_id, status, month) + surrogate because NULLs break unique constraints.
-- Approach: coalesce nulls to sentinel UUID and fixed date.
CREATE UNIQUE INDEX IF NOT EXISTS mv_dashboard_output_uq
  ON mv_dashboard_output (
    company_id,
    status,
    COALESCE(project_id,    '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(channel_id,    '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(month,         '1970-01-01'::date)
  );

-- filter indexes
CREATE INDEX IF NOT EXISTS mv_dashboard_output_company_month_idx
  ON mv_dashboard_output (company_id, month);

CREATE INDEX IF NOT EXISTS mv_dashboard_output_company_channel_idx
  ON mv_dashboard_output (company_id, channel_id);

CREATE INDEX IF NOT EXISTS mv_dashboard_output_company_project_idx
  ON mv_dashboard_output (company_id, project_id);

CREATE INDEX IF NOT EXISTS mv_dashboard_output_company_dept_idx
  ON mv_dashboard_output (company_id, department_id);

-- ─── Grants ──────────────────────────────────────────────────────────────────
-- mediaos_app reads MV (app-pool, RLS-forced on regular tables, not on MV).
-- mediaos_worker refreshes MV (direct/worker pool, not subject to PgBouncer).
GRANT SELECT ON mv_dashboard_task_status TO mediaos_app;
GRANT SELECT ON mv_dashboard_task_status TO mediaos_worker;

GRANT SELECT ON mv_dashboard_output TO mediaos_app;
GRANT SELECT ON mv_dashboard_output TO mediaos_worker;

-- Note: REFRESH MATERIALIZED VIEW requires the role to own the MV or be superuser.
-- mediaos_worker is granted USAGE; actual refresh runs via directPool/workerPool
-- which connects as the MV owner (postgres or mediaos_owner).
-- If running as non-owner, grant: GRANT ALL ON mv_dashboard_task_status TO mediaos_worker;
GRANT ALL ON mv_dashboard_task_status TO mediaos_worker;
GRANT ALL ON mv_dashboard_output TO mediaos_worker;
