import { Injectable } from "@nestjs/common";
import { and, eq, isNull, lt, notInArray, sql } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import { defects, tasks } from "../db/schema/workflow";

/** Percentage threshold above which a channel is considered "at-risk" (high overdue rate). */
export const CHANNEL_RISK_OVERDUE_THRESHOLD = 0.3; // 30%

/** Minimum number of tasks in a channel before risk calculation is meaningful. */
export const CHANNEL_RISK_MIN_TASKS = 3;

/** Defect types treated as "severe" — triggers a defect_severity alert. */
export const SEVERE_DEFECT_TYPES = ["quality_issue", "policy_violation"] as const;

export interface OverdueAlert {
  type: "overdue_task";
  taskId: string;
  title: string;
  dueDate: string;
  status: string;
  assigneeUserId: string | null;
}

export interface DefectSeverityAlert {
  type: "defect_severity";
  defectId: string;
  description: string;
  workflowStepId: string;
  responsibleUserId: string | null;
  createdAt: string;
}

export interface ChannelRiskAlert {
  type: "channel_risk";
  channelId: string;
  overdueRate: number;
  overdueCount: number;
  totalCount: number;
}

export type DashboardAlert = OverdueAlert | DefectSeverityAlert | ChannelRiskAlert;

const NON_TERMINAL_STATUSES = ["not_started", "in_progress", "waiting_review", "revision"] as const;

/**
 * AlertsService — computes live dashboard alerts.
 * Alerts are computed from live tables (not MV) so overdue flags are never stale.
 * All queries MUST include company_id filter (RLS via withTenant + explicit eq).
 */
@Injectable()
export class AlertsService {
  constructor(private readonly db: DatabaseService) {}

  async getAlerts(companyId: string): Promise<DashboardAlert[]> {
    const [overdue, defectSeverity, channelRisk] = await Promise.all([
      this.getOverdueTasks(companyId),
      this.getDefectSeverityAlerts(companyId),
      this.getChannelRiskAlerts(companyId),
    ]);

    return [...overdue, ...defectSeverity, ...channelRisk];
  }

  /**
   * Overdue tasks: dueDate < NOW() AND status NOT IN (completed, approved).
   * Only non-deleted tasks for the given company.
   */
  async getOverdueTasks(companyId: string): Promise<OverdueAlert[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx
        .select({
          id: tasks.id,
          title: tasks.title,
          dueDate: tasks.dueDate,
          status: tasks.status,
          assigneeUserId: tasks.assigneeUserId,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.companyId, companyId),
            isNull(tasks.deletedAt),
            lt(tasks.dueDate, sql`NOW()`),
            notInArray(tasks.status, ["completed", "approved"]),
          ),
        )
        .limit(50);

      return rows.map((r) => ({
        type: "overdue_task" as const,
        taskId: r.id,
        title: r.title,
        dueDate: r.dueDate?.toISOString() ?? "",
        status: r.status,
        assigneeUserId: r.assigneeUserId,
      }));
    });
  }

  /**
   * Defect severity alerts: recent defects with severe defect_type (quality_issue, policy_violation).
   * Only defects from the last 30 days are considered to keep the alert list actionable.
   */
  async getDefectSeverityAlerts(companyId: string): Promise<DefectSeverityAlert[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx
        .select({
          id: defects.id,
          description: defects.description,
          workflowStepId: defects.workflowStepId,
          responsibleUserId: defects.responsibleUserId,
          createdAt: defects.createdAt,
        })
        .from(defects)
        .where(
          and(
            eq(defects.companyId, companyId),
            sql`${defects.createdAt} >= NOW() - INTERVAL '30 days'`,
          ),
        )
        .limit(50);

      return rows.map((r) => ({
        type: "defect_severity" as const,
        defectId: r.id,
        description: r.description,
        workflowStepId: r.workflowStepId,
        responsibleUserId: r.responsibleUserId,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  /**
   * Channel risk: channels where overdue rate > CHANNEL_RISK_OVERDUE_THRESHOLD.
   * Computed live from tasks joined to project_channels.
   * Only channels with at least CHANNEL_RISK_MIN_TASKS are considered.
   */
  async getChannelRiskAlerts(companyId: string): Promise<ChannelRiskAlert[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx.execute(
        sql`
          SELECT
            pc.channel_id,
            COUNT(*)::int                                                          AS total_count,
            SUM(CASE
              WHEN t.due_date < NOW()
               AND t.status NOT IN ('completed', 'approved')
              THEN 1 ELSE 0
            END)::int                                                              AS overdue_count
          FROM tasks t
          JOIN projects p   ON p.id = t.project_id AND p.deleted_at IS NULL
          JOIN project_channels pc ON pc.project_id = p.id
          WHERE t.company_id = ${companyId}
            AND t.deleted_at IS NULL
            AND t.due_date IS NOT NULL
          GROUP BY pc.channel_id
          HAVING COUNT(*) >= ${CHANNEL_RISK_MIN_TASKS}
        `,
      );

      if (!rows.rows.length) return [];

      return rows.rows
        .map((r) => ({
          channelId: r.channel_id as string,
          totalCount: Number(r.total_count),
          overdueCount: Number(r.overdue_count),
          overdueRate: Number(r.overdue_count) / Number(r.total_count),
        }))
        .filter((r) => r.overdueRate > CHANNEL_RISK_OVERDUE_THRESHOLD)
        .map((r) => ({
          type: "channel_risk" as const,
          channelId: r.channelId,
          overdueRate: r.overdueRate,
          overdueCount: r.overdueCount,
          totalCount: r.totalCount,
        }));
    });
  }
}
