import { Injectable } from "@nestjs/common";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { taskActivityLogs } from "../db/schema/task-activity";
import { projects } from "../db/schema/media";
import { tasks } from "../db/schema/workflow";
import { users } from "../db/schema/users";

/**
 * S4-TASK-BE-4 — read-only `task_activity_logs` cho 1 task (SPEC-06 §14.19, API-06 §16.7 · TASK-API-602).
 * Bảng NÀY ĐÃ typed trong Drizzle schema (`db/schema/task-activity.ts`, ghi bởi TaskActivityService ở mọi
 * S4-TASK-BE-*) ⇒ dùng query builder bình thường (KHÔNG cần raw sql như comments/checklists — 2 bảng đó
 * chưa typed). Append-only (BẤT BIẾN #2) — repo này CHỈ SELECT, KHÔNG UPDATE/DELETE (khớp GRANT mig 0478).
 *
 * S5-TASK-WORKSPACE-1 (đợt D1, additive) — thêm chiều đọc theo DỰ ÁN (TASK-API-601): cùng bảng, lọc
 * `project_id` thay vì `task_id` — feed dự án gộp CẢ sự kiện cấp project (task_id NULL) lẫn task con.
 * Projection + join + order dùng CHUNG `listRowsTx` — 2 chiều đọc chỉ khác đúng vế where.
 */

export interface TaskActivityLogRow {
  id: string;
  taskId: string | null;
  projectId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  oldValues: unknown;
  newValues: unknown;
  message: string | null;
  createdAt: Date;
}

@Injectable()
export class TaskActivityFeedRepository {
  /**
   * Task có thể bị soft-delete (deleted_at) nhưng activity log VẪN phải đọc được (ledger durability —
   * xem lịch sử của task đã xoá) ⇒ CHỈ kiểm task tồn tại + cùng tenant, KHÔNG lọc deleted_at is null.
   */
  async taskExistsTx(tx: TenantTx, companyId: string, taskId: string): Promise<boolean> {
    const rows = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.companyId, companyId), eq(tasks.id, taskId)))
      .limit(1);
    return rows.length > 0;
  }

  /** Mirror taskExistsTx cho dự án — cùng lý do ledger durability: KHÔNG lọc deleted_at. */
  async projectExistsTx(tx: TenantTx, companyId: string, projectId: string): Promise<boolean> {
    const rows = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.companyId, companyId), eq(projects.id, projectId)))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * S5-TASK-DETAIL-1 (GAP 2, D-29) — actor có phải NGƯỜI LIÊN QUAN của task: main-assignee · creator
   * (creator_user_id/created_by/assignee_user_id) · reporter · watcher Active/Muted. KHÔNG lọc
   * tasks.deleted_at (đồng bộ taskExistsTx — người liên quan vẫn xem lịch sử task đã soft-delete).
   * Raw sql: task_watchers/employee_profiles chưa typed trong repo này (mirror task-actions.repository).
   */
  async isUserInvolvedTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    userId: string,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      select 1 as ok
        from tasks t
       where t.id = ${taskId} and t.company_id = ${companyId}
         and (
           t.creator_user_id = ${userId} or t.created_by = ${userId} or t.assignee_user_id = ${userId}
           or exists (
             select 1 from employee_profiles ep
              where ep.user_id = ${userId} and ep.company_id = t.company_id and ep.deleted_at is null
                and (ep.id = t.main_assignee_employee_id or ep.id = t.reporter_employee_id)
           )
           or exists (
             select 1 from task_watchers w
             join employee_profiles ew on ew.id = w.employee_id
              where w.task_id = t.id and w.company_id = t.company_id
                and w.status in ('Active','Muted') and w.deleted_at is null
                and ew.user_id = ${userId} and ew.deleted_at is null
           )
         )
       limit 1
    `);
    return res.rows.length > 0;
  }

  /**
   * S5-TASK-DETAIL-1 (GAP 1) — batch tên nhân viên cho enrich assigneeName vào old/new values
   * (1 query IN cho cả trang, KHÔNG N+1). Trả map id → full_name (null khi employee không gắn user).
   */
  async findEmployeeNamesTx(
    tx: TenantTx,
    companyId: string,
    employeeIds: string[],
  ): Promise<Map<string, string | null>> {
    if (employeeIds.length === 0) return new Map();
    const idList = sql.join(
      employeeIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const res = await tx.execute(sql`
      select ep.id, u.full_name as "fullName"
        from employee_profiles ep
        left join users u on u.id = ep.user_id
       where ep.company_id = ${companyId} and ep.id in (${idList})
    `);
    const rows = res.rows as unknown as { id: string; fullName: string | null }[];
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }

  async listByTaskTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    page: { limit: number; offset: number },
  ): Promise<TaskActivityLogRow[]> {
    return this.listRowsTx(tx, companyId, eq(taskActivityLogs.taskId, taskId), page);
  }

  /** S5-TASK-WORKSPACE-1 — feed theo dự án (TASK-API-601): shape/order y hệt, chỉ khác vế where. */
  async listByProjectTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
    page: { limit: number; offset: number },
  ): Promise<TaskActivityLogRow[]> {
    return this.listRowsTx(tx, companyId, eq(taskActivityLogs.projectId, projectId), page);
  }

  /** Projection + join actor + order desc dùng chung cho cả 2 chiều đọc (1 nguồn shape duy nhất). */
  private async listRowsTx(
    tx: TenantTx,
    companyId: string,
    scopeCondition: SQL,
    page: { limit: number; offset: number },
  ): Promise<TaskActivityLogRow[]> {
    const rows = await tx
      .select({
        id: taskActivityLogs.id,
        taskId: taskActivityLogs.taskId,
        projectId: taskActivityLogs.projectId,
        action: taskActivityLogs.action,
        targetType: taskActivityLogs.targetType,
        targetId: taskActivityLogs.targetId,
        actorUserId: taskActivityLogs.actorUserId,
        actorName: users.fullName,
        oldValues: taskActivityLogs.oldValues,
        newValues: taskActivityLogs.newValues,
        message: taskActivityLogs.message,
        createdAt: taskActivityLogs.createdAt,
      })
      .from(taskActivityLogs)
      .leftJoin(users, eq(users.id, taskActivityLogs.actorUserId))
      .where(and(eq(taskActivityLogs.companyId, companyId), scopeCondition))
      .orderBy(desc(taskActivityLogs.createdAt))
      .limit(page.limit)
      .offset(page.offset);
    return rows;
  }
}
