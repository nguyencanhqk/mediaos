import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";

export interface MvStatsFilter {
  month?: string; // YYYY-MM
  channelId?: string;
  projectId?: string;
  departmentId?: string;
}

export interface TaskStatusStat {
  status: string;
  taskCount: number;
}

export interface OutputStat {
  status: string;
  projectId: string | null;
  departmentId: string | null;
  channelId: string | null;
  month: string | null;
  taskCount: number;
}

/**
 * MvDashboardService — reads from materialized views mv_dashboard_task_status and mv_dashboard_output.
 *
 * SECURITY (S6-SEC-MV-1, mig 0534 — KI-041): PostgreSQL MV does NOT enforce RLS, so the app role used
 * to be able to read EVERY tenant's rows straight off the MV (measured on a lane DB 2026-07-29:
 * `mediaos_app` → 56 rows across 38 tenants with no filter). The boundary was one hand-written
 * `WHERE company_id = $1` per query — i.e. developer discipline, exactly what BẤT BIẾN #1 forbids.
 *
 * The boundary now lives in the DB: `SELECT` on both MVs is REVOKED from `mediaos_app`, and reads go
 * through the `security_barrier` views `v_dashboard_task_status` / `v_dashboard_output`, which filter
 * on `current_setting('app.current_company_id')` — the same variable `withTenant()` sets. Outside a
 * tenant context the views yield 0 rows (fail-closed), and a query that forgets the filter can no
 * longer leak because the view applies it.
 *
 * ⚠️ The explicit `WHERE company_id = ${companyId}` below STAYS — deliberately. It is now the SECOND
 * belt (defence in depth), not the only one. Do not "simplify" it away: it is what keeps the read
 * correct if someone ever re-points these queries at the MV directly.
 *
 * ⚠️ Read from `v_*`, never `mv_*`. Pointing back at `mv_*` will fail loudly (permission denied) for
 * the app role rather than silently leak — regression locked by
 * `test/integration/dashboard-mv-tenant-barrier.int-spec.ts`.
 *
 * S5-DASH-TASKSTATUS-FIX-1 (DECISIONS-03 D-30, mig 0502): mv_dashboard_task_status đếm theo trạng thái
 * CANONICAL = COALESCE(task_status, map(status legacy)) — tập giá trị TitleCase hiện đại (Todo ·
 * In Progress · In Review · Done · Cancelled; giá trị legacy lạ giữ raw, fail-visible).
 * ⚠️ HAI TAXONOMY TRONG MỘT RESPONSE mv-stats: taskStatus[] = canonical TitleCase, NHƯNG output[]
 * (mv_dashboard_output — media-era PARKED, 0 consumer) VẪN lowercase legacy — FE tương lai đừng
 * render lẫn hai bộ giá trị; hợp nhất thuộc WO dọn de-media-fy.
 */
@Injectable()
export class MvDashboardService {
  private readonly logger = new Logger(MvDashboardService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Returns task count by status for the given company.
   * Returns [] when MV has no data yet (not populated / empty tenant).
   */
  async getTaskStatusStats(companyId: string): Promise<TaskStatusStat[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx.execute(
        sql`
          SELECT status, task_count
          FROM v_dashboard_task_status
          WHERE company_id = ${companyId}
          ORDER BY status
        `,
      );
      if (!rows.rows.length) return [];
      return rows.rows.map((r) => ({
        status: r.status as string,
        taskCount: Number(r.task_count),
      }));
    });
  }

  /**
   * Returns output stats (task counts) broken down by channel/project/department/month.
   * All filter params are optional — omitting them returns the full breakdown for the tenant.
   * Returns [] when MV has no data (loading/empty state).
   *
   * INVARIANT: company_id filter is ALWAYS applied regardless of other filters.
   */
  async getOutputStats(companyId: string, filter: MvStatsFilter = {}): Promise<OutputStat[]> {
    return this.db.withTenant(companyId, async (tx) => {
      // All filter values are passed as Drizzle sql template parameters — NEVER interpolated as
      // raw strings. Since mig 0534 the tenant boundary is the security_barrier view; the
      // parameterized company_id below is the second belt, not the only one.
      const channelFilter = filter.channelId ? sql` AND channel_id = ${filter.channelId}` : sql``;
      const projectFilter = filter.projectId ? sql` AND project_id = ${filter.projectId}` : sql``;
      const departmentFilter = filter.departmentId
        ? sql` AND department_id = ${filter.departmentId}`
        : sql``;
      const monthFilter = filter.month ? sql` AND month = ${filter.month + "-01"}::date` : sql``;

      const rows = await tx.execute(
        sql`
          SELECT
            status,
            project_id,
            department_id,
            channel_id,
            month::text AS month,
            task_count
          FROM v_dashboard_output
          WHERE company_id = ${companyId}
          ${channelFilter}${projectFilter}${departmentFilter}${monthFilter}
          ORDER BY month DESC, channel_id, project_id, department_id, status
        `,
      );

      if (!rows.rows.length) return [];

      return rows.rows.map((r) => ({
        status: r.status as string,
        projectId: (r.project_id as string | null) ?? null,
        departmentId: (r.department_id as string | null) ?? null,
        channelId: (r.channel_id as string | null) ?? null,
        month: (r.month as string | null) ?? null,
        taskCount: Number(r.task_count),
      }));
    });
  }
}
