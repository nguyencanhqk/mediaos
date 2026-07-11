import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

export interface TaskAudience {
  assigneeUserId: string | null;
  creatorUserId: string | null;
  /** user_id của watcher ACTIVE/MUTED, profile chưa xoá + status='active' + có tài khoản — DUY NHẤT. */
  watcherUserIds: string[];
}

interface TaskAudienceRow {
  assigneeUserId: string | null;
  creatorUserId: string | null;
}

interface WatcherRow {
  userId: string | null;
}

/**
 * S4-INT-1 — TaskAudienceReader: đọc audience HIỆN TẠI của 1 task (assignee/creator/watcher active) để
 * `TaskNotiBridgeRegistrar` resolve recipient cho 6/8 mapping TASK (§9.4) — 2 mapping còn lại
 * (TASK_MENTIONED/PROJECT_MEMBER_ADDED) đọc thẳng từ payload, KHÔNG cần reader này.
 *
 * Raw SQL (mirror `task-actions.repository.ts`) vì cột 0478 (`assignee_user_id`/`creator_user_id`) CHƯA
 * typed trong Drizzle schema `tasks` (workflow.ts:387) — `task_watchers` cũng raw-SQL-only (không có bảng
 * Drizzle, mirror `task-actions.repository.ts` block "task_watchers (self-only)").
 *
 * BẤT BIẾN #1: chạy TRONG `db.withTenant(companyId)` do caller (registrar) mở + `company_id` BIND TƯỜNG
 * MINH mọi câu (defense-in-depth trên RLS+FORCE) — KHÔNG query trần.
 */
@Injectable()
export class TaskAudienceReader {
  async resolve(tx: TenantTx, companyId: string, taskId: string): Promise<TaskAudience> {
    const taskRes = await tx.execute(sql`
      select assignee_user_id as "assigneeUserId", creator_user_id as "creatorUserId"
        from tasks
       where id = ${taskId} and company_id = ${companyId} and deleted_at is null
       limit 1
    `);
    const taskRow = (taskRes.rows as unknown as TaskAudienceRow[])[0];

    const watcherRes = await tx.execute(sql`
      select ep.user_id as "userId"
        from task_watchers tw
        join employee_profiles ep
          on ep.id = tw.employee_id and ep.company_id = ${companyId}
       where tw.company_id = ${companyId}
         and tw.task_id = ${taskId}
         and tw.status in ('Active', 'Muted')
         and tw.deleted_at is null
         and ep.deleted_at is null
         and ep.status = 'active'
         and ep.user_id is not null
    `);
    const watcherUserIds = (watcherRes.rows as unknown as WatcherRow[])
      .map((r) => r.userId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    return {
      assigneeUserId: taskRow?.assigneeUserId ?? null,
      creatorUserId: taskRow?.creatorUserId ?? null,
      watcherUserIds,
    };
  }
}
