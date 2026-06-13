import { Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
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
 * SECURITY: PostgreSQL MV does NOT enforce RLS. Every query MUST include WHERE company_id = companyId.
 * withTenant sets app.current_company_id but MV ignores it — explicit eq(companyId) is mandatory.
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
          FROM mv_dashboard_task_status
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
      // Build WHERE clauses — company_id is mandatory, others are optional.
      const conditions: string[] = [`company_id = '${companyId}'`];

      if (filter.channelId) {
        conditions.push(`channel_id = '${filter.channelId}'`);
      }
      if (filter.projectId) {
        conditions.push(`project_id = '${filter.projectId}'`);
      }
      if (filter.departmentId) {
        conditions.push(`department_id = '${filter.departmentId}'`);
      }
      if (filter.month) {
        // month is YYYY-MM; match DATE_TRUNC result stored as YYYY-MM-01
        const monthDate = `${filter.month}-01`;
        conditions.push(`month = '${monthDate}'::date`);
      }

      const whereClause = conditions.join(" AND ");

      const rows = await tx.execute(
        sql.raw(`
          SELECT
            status,
            project_id,
            department_id,
            channel_id,
            month::text AS month,
            task_count
          FROM mv_dashboard_output
          WHERE ${whereClause}
          ORDER BY month DESC, channel_id, project_id, department_id, status
        `),
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
