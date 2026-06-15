-- G14-4: Tighten GRANT on mv_dashboard_* for mediaos_worker to SELECT only.
-- Migration 0102 (already applied) granted GRANT ALL, which is overly broad:
-- REFRESH MATERIALIZED VIEW requires the MV owner, not DML privileges.
-- mediaos_worker only needs SELECT to run queries on the MV.
-- Band 0100-0109 (G14). idx=66, when>1717500128000.

REVOKE ALL ON mv_dashboard_task_status FROM mediaos_worker;
--> statement-breakpoint
GRANT SELECT ON mv_dashboard_task_status TO mediaos_worker;
--> statement-breakpoint

REVOKE ALL ON mv_dashboard_output FROM mediaos_worker;
--> statement-breakpoint
GRANT SELECT ON mv_dashboard_output TO mediaos_worker;
