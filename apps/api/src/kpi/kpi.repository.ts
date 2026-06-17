import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { KpiResultDto } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { type KpiResult, kpiDefinitions, kpiResults } from "../db/schema";
import type { KpiRawMetrics } from "./kpi.formula";

/**
 * G8-4 — Repository KPI. withTenant mọi query nghiệp vụ (RLS ép company_id ở DB, bất biến #1).
 * kpi_definitions: CRUD soft-delete. kpi_results: SNAPSHOT APPEND-ONLY insert (bất biến #2) — no update/delete.
 * Aggregate đọc tasks/evaluation_results/defects/approval_requests — company_id pin 2 phía (chống rò chéo tenant).
 * Write methods nhận `tx` để chạy CÙNG transaction với audit/outbox.
 */

export interface InsertDefinitionData {
  name: string;
  description?: string | null;
  weights: unknown; // jsonb (KpiComponentWeights) — service validate trước.
}

export interface InsertResultData {
  definitionId: string;
  subjectUserId?: string | null;
  subjectTeamId?: string | null;
  periodStart: string;
  periodEnd: string;
  tasksDone: string;
  onTimeRate: string;
  evaluationScore: string;
  defectScore: string;
  firstPassApprovalRate: string;
  totalScore: string;
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  computedBy: string;
}

/** Phạm vi chủ thể + kỳ để aggregate số liệu thô. teamUserIds rỗng ⇒ chủ thể là user đơn. */
export interface AggregateScope {
  companyId: string;
  userIds: string[]; // 1 user, hoặc nhiều user (members của team)
  periodStart: string;
  periodEnd: string;
}

/**
 * Scope quyền cho list lịch sử KPI (server-driven, không tin client):
 *  - own  → CHỈ kết quả của chính user (subject_user_id = userId) HOẶC team user thuộc về.
 *  - all  → mọi chủ thể trong tenant; người có quyền rộng có thể lọc thêm theo subjectUserId/Team.
 */
export type ListResultsScope =
  | { kind: "own"; userId: string }
  | { kind: "all"; subjectUserId?: string; subjectTeamId?: string };

/** Tham số list lịch sử KPI. Scope do SERVICE quyết theo quyền (repo chỉ ép câu truy vấn). */
export interface ListResultsOptions {
  scope: ListResultsScope;
  definitionId?: string;
  periodFrom?: Date;
  periodTo?: Date;
  confirmedOnly?: boolean;
  limit: number;
}

@Injectable()
export class KpiRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Liệt kê định nghĩa KPI active (chưa soft-delete) của tenant. */
  listDefinitions(companyId: string, opts: { includeInactive?: boolean } = {}) {
    return this.db.withTenant(companyId, async (tx) => {
      const conds = [
        eq(kpiDefinitions.companyId, companyId),
        isNull(kpiDefinitions.deletedAt),
      ];
      if (!opts.includeInactive) {
        conds.push(eq(kpiDefinitions.isActive, true));
      }
      return tx
        .select()
        .from(kpiDefinitions)
        .where(and(...conds))
        .orderBy(kpiDefinitions.createdAt);
    });
  }

  /** Định nghĩa theo id (cùng tenant, chưa soft-delete). null nếu không có. */
  async findDefinitionByIdTx(tx: TenantTx, companyId: string, id: string) {
    const [row] = await tx
      .select()
      .from(kpiDefinitions)
      .where(
        and(
          eq(kpiDefinitions.companyId, companyId),
          eq(kpiDefinitions.id, id),
          isNull(kpiDefinitions.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async insertDefinitionTx(tx: TenantTx, data: InsertDefinitionData) {
    const [row] = await tx
      .insert(kpiDefinitions)
      .values({
        name: data.name,
        description: data.description ?? null,
        weights: data.weights,
      })
      .returning();
    return row;
  }

  /**
   * Map 1 row kpi_results (Drizzle: numeric→string, timestamp→Date) → KpiResultDto (nguồn sự thật
   * contracts: components LỒNG NHAU + số + ISO string). Tái dùng cho compute/confirm/list → BE trả
   * ĐÚNG hình dạng kpiResultSchema mà FE parse (tránh lệch hợp đồng: string numeric / thiếu components).
   */
  mapResultRow(row: KpiResult): KpiResultDto {
    return {
      id: row.id,
      companyId: row.companyId,
      definitionId: row.definitionId,
      subjectUserId: row.subjectUserId,
      subjectTeamId: row.subjectTeamId,
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
      components: {
        tasksDone: Number(row.tasksDone),
        onTimeRate: Number(row.onTimeRate),
        evaluationScore: Number(row.evaluationScore),
        defectScore: Number(row.defectScore),
        firstPassApprovalRate: Number(row.firstPassApprovalRate),
      },
      totalScore: Number(row.totalScore),
      confirmedBy: row.confirmedBy,
      confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
      computedBy: row.computedBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Danh sách team_id mà 1 user ĐANG thuộc về (cùng tenant, membership chưa soft-delete) — cho phép
   * xem KPI team của-mình. `deleted_at IS NULL`: user đã rời team KHÔNG còn thấy KPI team đó nữa.
   */
  async findUserTeamIdsTx(tx: TenantTx, companyId: string, userId: string): Promise<string[]> {
    const rows = await tx.execute<{ team_id: string }>(sql`
      SELECT team_id FROM team_members
      WHERE company_id = ${companyId} AND user_id = ${userId} AND deleted_at IS NULL
    `);
    return rows.rows.map((r) => r.team_id);
  }

  /**
   * Lịch sử kết quả KPI (APPEND-ONLY → CHỈ đọc, no UPDATE/DELETE). withTenant ép RLS company_id
   * (bất biến #1). Scope quyền ép Ở DB qua WHERE (subject của-mình cho employee thường). Mới nhất
   * trước (ORDER BY created_at DESC), LIMIT chống quét toàn bảng. Trả KpiResultDto[] (đã map).
   */
  async listResults(companyId: string, opts: ListResultsOptions): Promise<KpiResultDto[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const conds = [eq(kpiResults.companyId, companyId)];

      if (opts.definitionId) {
        conds.push(eq(kpiResults.definitionId, opts.definitionId));
      }

      if (opts.scope.kind === "own") {
        // Employee thường: CHỈ subject = chính mình HOẶC team mình thuộc về (fail-closed).
        const teamIds = await this.findUserTeamIdsTx(tx, companyId, opts.scope.userId);
        const ownConds = [eq(kpiResults.subjectUserId, opts.scope.userId)];
        if (teamIds.length > 0) {
          ownConds.push(inArray(kpiResults.subjectTeamId, teamIds));
        }
        const ownScope = or(...ownConds);
        if (ownScope) conds.push(ownScope);
      } else {
        // Quyền rộng (HR/quản lý): có thể lọc theo chủ thể cụ thể (tuỳ chọn).
        if (opts.scope.subjectUserId) {
          conds.push(eq(kpiResults.subjectUserId, opts.scope.subjectUserId));
        }
        if (opts.scope.subjectTeamId) {
          conds.push(eq(kpiResults.subjectTeamId, opts.scope.subjectTeamId));
        }
      }

      if (opts.periodFrom) conds.push(gte(kpiResults.periodStart, opts.periodFrom));
      if (opts.periodTo) conds.push(lte(kpiResults.periodStart, opts.periodTo));
      if (opts.confirmedOnly) conds.push(isNotNull(kpiResults.confirmedAt));

      const rows = await tx
        .select()
        .from(kpiResults)
        .where(and(...conds))
        .orderBy(desc(kpiResults.createdAt))
        .limit(opts.limit);

      return rows.map((row) => this.mapResultRow(row));
    });
  }

  /** Kết quả KPI theo id (cùng tenant). null nếu không có. */
  async findResultByIdTx(tx: TenantTx, companyId: string, id: string) {
    const [row] = await tx
      .select()
      .from(kpiResults)
      .where(and(eq(kpiResults.companyId, companyId), eq(kpiResults.id, id)))
      .limit(1);
    return row ?? null;
  }

  /** INSERT 1 snapshot kpi_results (APPEND-ONLY). Không update bản cũ. */
  async insertResultTx(tx: TenantTx, data: InsertResultData) {
    const [row] = await tx
      .insert(kpiResults)
      .values({
        definitionId: data.definitionId,
        subjectUserId: data.subjectUserId ?? null,
        subjectTeamId: data.subjectTeamId ?? null,
        periodStart: new Date(data.periodStart),
        periodEnd: new Date(data.periodEnd),
        tasksDone: data.tasksDone,
        onTimeRate: data.onTimeRate,
        evaluationScore: data.evaluationScore,
        defectScore: data.defectScore,
        firstPassApprovalRate: data.firstPassApprovalRate,
        totalScore: data.totalScore,
        confirmedBy: data.confirmedBy ?? null,
        confirmedAt: data.confirmedAt ? new Date(data.confirmedAt) : null,
        computedBy: data.computedBy,
      })
      .returning();
    return row;
  }

  /** Danh sách user_id thành viên ĐANG hoạt động của 1 team (membership chưa soft-delete) — gộp KPI team. */
  async findTeamMemberUserIdsTx(tx: TenantTx, companyId: string, teamId: string): Promise<string[]> {
    const rows = await tx.execute<{ user_id: string }>(sql`
      SELECT user_id FROM team_members
      WHERE company_id = ${companyId} AND team_id = ${teamId} AND deleted_at IS NULL
    `);
    return rows.rows.map((r) => r.user_id);
  }

  /**
   * Aggregate số liệu THÔ cho chủ thể (1+ user) trong kỳ. Mọi truy vấn pin company_id (bất biến #1)
   * + lọc theo period. Trả KpiRawMetrics (service áp công thức). Chủ thể không có dữ liệu → 0/null.
   */
  async aggregateRawMetricsTx(tx: TenantTx, scope: AggregateScope): Promise<KpiRawMetrics> {
    const { companyId, userIds, periodStart, periodEnd } = scope;
    if (userIds.length === 0) {
      return {
        tasksDue: 0,
        tasksDone: 0,
        tasksOnTime: 0,
        evaluationAvg: null,
        defectsType1: 0,
        defectsType2: 0,
        approvalsTotal: 0,
        approvalsFirstPass: 0,
      };
    }
    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    // Bind tập user_id như 1 PG array uuid[] qua 1 tham số DUY NHẤT (drizzle `sql` template làm phẳng
    // JS array thành nhiều param → "malformed array literal"). join CSV (UUID đã validate Zod/FK) →
    // string_to_array(...)::uuid[] = 1 param an toàn (không nội suy chuỗi vào SQL).
    const userIdCsv = userIds.join(",");
    const userIdArray = sql`string_to_array(${userIdCsv}, ',')::uuid[]`;

    // Tasks: đến hạn trong kỳ (due_date ∈ [start,end]); xong = status approved/completed;
    // đúng hạn = xong và updated_at <= due_date (proxy completed_at). company_id pin.
    const taskRows = await tx.execute<{
      tasks_due: number;
      tasks_done: number;
      tasks_on_time: number;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE due_date IS NOT NULL)::int AS tasks_due,
        count(*) FILTER (WHERE status IN ('approved','completed'))::int AS tasks_done,
        count(*) FILTER (
          WHERE status IN ('approved','completed')
            AND due_date IS NOT NULL AND updated_at <= due_date
        )::int AS tasks_on_time
      FROM tasks
      WHERE company_id = ${companyId}
        AND deleted_at IS NULL
        AND assignee_user_id = ANY(${userIdArray})
        AND due_date >= ${start} AND due_date <= ${end}
    `);
    const t = taskRows.rows[0] ?? { tasks_due: 0, tasks_done: 0, tasks_on_time: 0 };

    // Evaluation trung bình: G8-3 evaluation_results theo subject + kỳ (created_at). NULL nếu không có.
    const evalRows = await tx.execute<{ avg_score: string | null }>(sql`
      SELECT avg(total_score)::numeric AS avg_score
      FROM evaluation_results
      WHERE company_id = ${companyId}
        AND subject_user_id = ANY(${userIdArray})
        AND created_at >= ${start} AND created_at < ${end}
    `);
    const avgRaw = evalRows.rows[0]?.avg_score ?? null;

    // Defects loại 1/loại 2: G8-2 defects gắn workflow_step của task chủ thể trong kỳ.
    // defect_type 'quality_issue'/'policy_violation' = loại 1 (nặng); còn lại = loại 2 (nhẹ).
    const defectRows = await tx.execute<{ type1: number; type2: number }>(sql`
      SELECT
        count(*) FILTER (WHERE d.defect_type IN ('quality_issue','policy_violation'))::int AS type1,
        count(*) FILTER (WHERE d.defect_type NOT IN ('quality_issue','policy_violation'))::int AS type2
      FROM defects d
      JOIN workflow_steps ws ON ws.id = d.workflow_step_id AND ws.company_id = d.company_id
      JOIN tasks tk ON tk.workflow_step_id = ws.id AND tk.company_id = d.company_id
      WHERE d.company_id = ${companyId}
        AND tk.assignee_user_id = ANY(${userIdArray})
        AND d.created_at >= ${start} AND d.created_at < ${end}
    `);
    const def = defectRows.rows[0] ?? { type1: 0, type2: 0 };

    // First-pass approval: approval_requests gắn workflow_step của task chủ thể, kết thúc trong kỳ.
    // first-pass = approved và workflow_step không bị revision (task.revision_round = 0 cho step đó).
    const apprRows = await tx.execute<{ total: number; first_pass: number }>(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (
          WHERE ar.status = 'approved' AND COALESCE(tk.revision_round, 0) = 0
        )::int AS first_pass
      FROM approval_requests ar
      JOIN workflow_steps ws ON ws.id = ar.workflow_step_id AND ws.company_id = ar.company_id
      JOIN tasks tk ON tk.workflow_step_id = ws.id AND tk.company_id = ar.company_id
      WHERE ar.company_id = ${companyId}
        AND tk.assignee_user_id = ANY(${userIdArray})
        AND ar.created_at >= ${start} AND ar.created_at < ${end}
    `);
    const appr = apprRows.rows[0] ?? { total: 0, first_pass: 0 };

    return {
      tasksDue: Number(t.tasks_due) || 0,
      tasksDone: Number(t.tasks_done) || 0,
      tasksOnTime: Number(t.tasks_on_time) || 0,
      evaluationAvg: avgRaw === null ? null : Number(avgRaw),
      defectsType1: Number(def.type1) || 0,
      defectsType2: Number(def.type2) || 0,
      approvalsTotal: Number(appr.total) || 0,
      approvalsFirstPass: Number(appr.first_pass) || 0,
    };
  }

  /** Filter expression dùng chung (chưa dùng trực tiếp — giữ cho list theo kỳ tương lai). */
  periodOverlap(start: Date, end: Date) {
    return and(gte(kpiResults.periodEnd, start), lte(kpiResults.periodStart, end));
  }
}
