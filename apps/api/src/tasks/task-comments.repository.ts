import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

/**
 * S4-TASK-BE-4 — persistence `task_comments` (DB-06 §7.6, mig 0012 GRANT + mig 0478 §9 ALTER-ADD
 * soft-delete/created_by additive). Cột `deleted_at`/`deleted_by`/`created_by` CHƯA typed trong Drizzle
 * schema (`schema/workflow.ts` chỉ có id/companyId/taskId/userId/body/createdAt) ⇒ raw `sql`` qua
 * tx.execute (mirror task-core.repository.ts / task-actions.repository.ts — TRÁNH chạm `db/schema/**`,
 * NGOÀI paths cho phép của lane này). company_id BIND tường minh MỌI câu (BẤT BIẾN #1 defense-in-depth).
 *
 * BẤT BIẾN #2: xoá = UPDATE deleted_at/deleted_by (soft) — KHÔNG BAO GIỜ phát câu SQL DELETE dù
 * mig 0012 grant còn quyền DELETE (grant lịch sử, app tự kỷ luật soft-delete-only ở tầng repo).
 */

export interface TaskCommentRow {
  id: string;
  taskId: string;
  userId: string;
  userName: string | null;
  body: string;
  createdAt: string | Date;
  deletedAt: string | Date | null;
}

// LƯU Ý: task_comments KHÔNG có cột `updated_at` (mig 0478 §9 chỉ ADD created_by/deleted_at/deleted_by,
// KHÔNG ADD updated_at — debt cho lane db-migration). Sửa comment (PATCH) KHÔNG có mốc "đã sửa lúc nào"
// lưu trên row; thời điểm sửa nằm ở `task_activity_logs` (action COMMENT_UPDATED, append-only).
const COMMENT_SELECT = sql`
  c.id          AS id,
  c.task_id     AS "taskId",
  c.user_id     AS "userId",
  u.full_name   AS "userName",
  c.body        AS body,
  c.created_at  AS "createdAt",
  c.deleted_at  AS "deletedAt"`;

@Injectable()
export class TaskCommentsRepository {
  /** Danh sách comment CÒN SỐNG của 1 task, cũ→mới. */
  async listByTaskTx(tx: TenantTx, companyId: string, taskId: string): Promise<TaskCommentRow[]> {
    const res = await tx.execute(sql`
      select ${COMMENT_SELECT}
        from task_comments c
        left join users u on u.id = c.user_id
       where c.company_id = ${companyId} and c.task_id = ${taskId} and c.deleted_at is null
       order by c.created_at asc
    `);
    return res.rows as unknown as TaskCommentRow[];
  }

  /** 1 comment (BẤT KỂ đã xoá hay chưa — service tự phân biệt 404 vs "đã xoá"). */
  async findByIdTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    commentId: string,
  ): Promise<TaskCommentRow | undefined> {
    const res = await tx.execute(sql`
      select ${COMMENT_SELECT}
        from task_comments c
        left join users u on u.id = c.user_id
       where c.company_id = ${companyId} and c.task_id = ${taskId} and c.id = ${commentId}
       limit 1
    `);
    return (res.rows as unknown as TaskCommentRow[])[0];
  }

  async insertTx(
    tx: TenantTx,
    companyId: string,
    v: { taskId: string; userId: string; body: string },
  ): Promise<{ id: string }> {
    const res = await tx.execute(sql`
      insert into task_comments (company_id, task_id, user_id, body, created_by)
      values (${companyId}, ${v.taskId}, ${v.userId}, ${v.body}, ${v.userId})
      returning id
    `);
    const row = (res.rows as unknown as { id: string }[])[0];
    if (!row) throw new Error("insertTx: insert task_comments returned no row");
    return row;
  }

  /** Sửa nội dung — guard chưa xoá (đã xoá ⇒ 0 row, service map 409/404). */
  async updateBodyTx(
    tx: TenantTx,
    companyId: string,
    commentId: string,
    body: string,
  ): Promise<{ id: string } | undefined> {
    const res = await tx.execute(sql`
      update task_comments
         set body = ${body}
       where id = ${commentId} and company_id = ${companyId} and deleted_at is null
       returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  /** Soft-delete (BẤT BIẾN #2) — KHÔNG hard DELETE. */
  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    commentId: string,
    deletedBy: string,
  ): Promise<{ id: string } | undefined> {
    const res = await tx.execute(sql`
      update task_comments
         set deleted_at = now(), deleted_by = ${deletedBy}
       where id = ${commentId} and company_id = ${companyId} and deleted_at is null
       returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }
}
