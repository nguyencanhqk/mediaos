-- Migration 0220: G16-2 perf — hot-path covering indexes for task board, dashboard aggregates,
--   and notification list. idx 85, when 1717500220000 (> master max 1717500200000, monotonic).
--
-- BAND 0220-0229 (lane C2 / G16-2). Index-ONLY migration: no RLS/permission/policy/audit changes,
--   no schema-shape change. Same query results — these only change ACCESS PATHS.
--
-- Evidence (EXPLAIN ANALYZE on 6000 synthetic tasks / 8000 notifications, single tenant):
--   • Task Board listAll  (WHERE company_id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50)
--       BEFORE: Seq Scan tasks (5700 rows) + top-N heapsort, 113 shared buffers.
--       AFTER:  Index Scan tasks_company_created_active_idx, 0 sort, ~3 buffers.
--   • Dashboard task summary (WHERE company_id AND deleted_at IS NULL GROUP BY status)
--       BEFORE: Seq Scan tasks (5700 rows), 113 buffers.
--       AFTER:  Index-only/Index Scan on tasks_company_status_active_idx.
--   • Dashboard overdue (… AND due_date < now() AND status NOT IN (...))
--       BEFORE: Seq Scan tasks (5700 rows), 113 buffers.
--       AFTER:  tasks_company_status_active_idx — company_id-leading scan on the PARTIAL index
--               (drops soft-deleted). NOTE: `status NOT IN (...)` is a negation → the planner does
--               NOT index-scan the status column; it scans the company_id prefix + filters status/
--               due_date. Still far cheaper than the full Seq Scan (partial index, no soft-deleted rows).
--   • My Tasks findByAssignee (WHERE company_id AND assignee_user_id AND deleted_at IS NULL ORDER BY created_at DESC)
--       BEFORE: Bitmap on tasks_assignee_user_id_idx + heap filter (company/deleted) + sort.
--       AFTER:  Index Scan tasks_company_assignee_active_idx, 0 sort.
--   • Notifications findByUser (WHERE company_id AND user_id ORDER BY created_at DESC LIMIT 50)
--       BEFORE: Bitmap on notifications_user_unread_idx + heap filter (company) + top-N heapsort.
--       AFTER:  Index Scan notifications_company_user_created_idx, 0 sort.
--   notifications countUnread already served by notifications_user_unread_idx — left unchanged.
--
-- OPS NOTE (CONCURRENTLY): drizzle wraps each migration in a transaction, and
--   CREATE INDEX CONCURRENTLY cannot run inside a transaction. These use plain
--   CREATE INDEX IF NOT EXISTS (idempotent). On the current (empty/small) tables the
--   ACCESS EXCLUSIVE lock is negligible. For a LARGE production table, run the equivalent
--   `CREATE INDEX CONCURRENTLY` out-of-band (psql, autocommit) BEFORE deploying this file,
--   so the IF NOT EXISTS here becomes a no-op and no blocking lock is taken at deploy time.
--   See docs/ops/backup-restore-drill.md "CONCURRENTLY for prod" for the runbook.

-- ── tasks: board list + My Tasks ordered by created_at DESC; dashboard status/overdue aggregates ──
-- Partial (deleted_at IS NULL): all hot reads filter out soft-deleted rows; smaller, hotter index.
CREATE INDEX IF NOT EXISTS tasks_company_created_active_idx
  ON tasks (company_id, created_at DESC)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tasks_company_assignee_active_idx
  ON tasks (company_id, assignee_user_id, created_at DESC)
  WHERE deleted_at IS NULL;
-- FOLLOW-UP (post-land, separate migration): the existing single-column tasks_assignee_user_id_idx is
-- now subsumed by this partial composite for every app query (all run inside withTenant → company_id is
-- always present), so it becomes dead write-weight. NOT dropped here — it is shared with master; track a
-- DROP INDEX in a follow-up once this lane lands.
--> statement-breakpoint
-- Dashboard getTaskSummary GROUP BY status uses the (company_id, status) prefix (index-only).
-- The overdue query (status NOT IN + due_date) can't index-scan on status (negation) → it uses the
-- company_id-leading partial scan + filter; due_date is included to keep the row check off-heap.
CREATE INDEX IF NOT EXISTS tasks_company_status_active_idx
  ON tasks (company_id, status, due_date)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
-- ── notifications: per-user inbox list ordered by created_at DESC ──
CREATE INDEX IF NOT EXISTS notifications_company_user_created_idx
  ON notifications (company_id, user_id, created_at DESC);
