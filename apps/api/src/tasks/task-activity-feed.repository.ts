import { Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { taskActivityLogs } from "../db/schema/task-activity";
import { tasks } from "../db/schema/workflow";
import { users } from "../db/schema/users";

/**
 * S4-TASK-BE-4 — read-only `task_activity_logs` cho 1 task (SPEC-06 §14.19, API-06 §16.7 · TASK-API-602).
 * Bảng NÀY ĐÃ typed trong Drizzle schema (`db/schema/task-activity.ts`, ghi bởi TaskActivityService ở mọi
 * S4-TASK-BE-*) ⇒ dùng query builder bình thường (KHÔNG cần raw sql như comments/checklists — 2 bảng đó
 * chưa typed). Append-only (BẤT BIẾN #2) — repo này CHỈ SELECT, KHÔNG UPDATE/DELETE (khớp GRANT mig 0478).
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

  async listByTaskTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
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
      .where(and(eq(taskActivityLogs.companyId, companyId), eq(taskActivityLogs.taskId, taskId)))
      .orderBy(desc(taskActivityLogs.createdAt))
      .limit(page.limit)
      .offset(page.offset);
    return rows;
  }
}
