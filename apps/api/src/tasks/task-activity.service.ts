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

/** Action canonical cho project/member (SPEC-06 §16.3 activity feed). */
export type TaskActivityAction =
  | "PROJECT_CREATED"
  | "PROJECT_UPDATED"
  | "PROJECT_CLOSED"
  | "PROJECT_DELETED"
  | "MEMBER_ADDED"
  | "MEMBER_ROLE_CHANGED"
  | "MEMBER_REMOVED";

/** target_type — tập con của CHECK 0478 dùng ở WO này (Project/Member). */
export type TaskActivityTargetType = "Project" | "Member";

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
