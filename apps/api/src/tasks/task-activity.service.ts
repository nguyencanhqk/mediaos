import { Injectable } from "@nestjs/common";
import type { TenantTx } from "../db/db.service";
import { taskActivityLogs } from "../db/schema";

/**
 * S4-TASK-BE-1 — TaskActivityService: helper ghi `task_activity_logs` (DB-06 §7.12, mig 0478 §5).
 *
 * BẤT BIẾN #2 (append-only): bảng CHỈ có GRANT SELECT,INSERT cho mediaos_app (0478:238) — KHÔNG
 * UPDATE/DELETE, KHÔNG deleted_at. Mọi lần ghi PHẢI đi trong CÙNG transaction nghiệp vụ (`withTenant`)
 * để log và thay đổi cùng commit/rollback (không ghi nửa vời). company_id KHÔNG truyền — lấy từ DEFAULT
 * `NULLIF(current_setting('app.current_company_id'),'')::uuid` (0478) khớp GUC do withTenant set.
 *
 * target_type PHẢI ∈ CHECK chk_task_activity_target_type (0478): Project/Task/Member/Comment/File/…
 */

/** Action canonical cho project/member (SPEC-06 §16.3 activity feed). S4-TASK-BE-2 (additive): TASK_*. */
export type TaskActivityAction =
  | "PROJECT_CREATED"
  | "PROJECT_UPDATED"
  | "PROJECT_CLOSED"
  | "PROJECT_DELETED"
  | "MEMBER_ADDED"
  | "MEMBER_ROLE_CHANGED"
  | "MEMBER_REMOVED"
  // S4-TASK-BE-2 — task core lifecycle (SPEC-06 §7.12).
  | "TASK_CREATED"
  | "TASK_UPDATED"
  | "TASK_DELETED"
  // S4-TASK-BE-3 (additive) — task actions crown-FSM (SPEC-06 §16.3 activity feed).
  | "TASK_ASSIGNED"
  | "TASK_ASSIGNEE_CHANGED"
  | "TASK_STATUS_CHANGED"
  | "TASK_PRIORITY_CHANGED"
  | "TASK_DUE_DATE_CHANGED"
  | "TASK_WATCHER_ADDED"
  | "TASK_WATCHER_REMOVED"
  // S4-TASK-BE-4 (additive) — comment/checklist (SPEC-06 §14.14/§14.16, done_when literal — KHÔNG tiền
  // tố "TASK_" như API-06 §17 (TASK_CHECKLIST_*): backlog.mjs done_when chốt COMMENT_*/CHECKLIST_* trần).
  | "COMMENT_CREATED"
  | "COMMENT_UPDATED"
  | "COMMENT_DELETED"
  | "CHECKLIST_CREATED"
  | "CHECKLIST_UPDATED"
  | "CHECKLIST_DELETED"
  | "CHECKLIST_ITEM_CREATED"
  | "CHECKLIST_ITEM_UPDATED"
  | "CHECKLIST_ITEM_DONE"
  | "CHECKLIST_ITEM_DELETED";

/**
 * target_type — tập con của CHECK chk_task_activity_target_type (0478:217-219). S4-TASK-BE-2 (additive):
 * Task. S4-TASK-BE-3 (additive): Watcher / Assignee. S4-TASK-BE-4 (additive): Comment / Checklist /
 * ChecklistItem (CHECK 0478 ĐÃ cho phép cả 3 — KHÔNG cần đổi DDL, chỉ mở khoá phía TS union).
 */
export type TaskActivityTargetType =
  | "Project"
  | "Member"
  | "Task"
  | "Watcher"
  | "Assignee"
  | "Comment"
  | "Checklist"
  | "ChecklistItem";

export interface TaskActivityEntry {
  action: TaskActivityAction;
  targetType: TaskActivityTargetType;
  targetId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  actorUserId?: string | null;
  actorEmployeeId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  message?: string | null;
}

@Injectable()
export class TaskActivityService {
  /**
   * Ghi 1 dòng activity (append-only) trong tx nghiệp vụ. Nhận `tx` từ withTenant của caller — KHÔNG
   * mở transaction riêng (nếu tách tx, một rollback nghiệp vụ sẽ để lại log rác ⇒ vỡ tính nhất quán).
   */
  async record(tx: TenantTx, entry: TaskActivityEntry): Promise<void> {
    await tx.insert(taskActivityLogs).values({
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      projectId: entry.projectId ?? null,
      taskId: entry.taskId ?? null,
      actorUserId: entry.actorUserId ?? null,
      actorEmployeeId: entry.actorEmployeeId ?? null,
      oldValues: entry.oldValues ?? null,
      newValues: entry.newValues ?? null,
      message: entry.message ?? null,
    });
  }
}
