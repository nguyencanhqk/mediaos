import type { DataScope, TaskAllowedActionKey, TaskAllowedActions } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import type { ScopeRequest } from "../permission/permission.decide";
import type { ProjectAccessService } from "./project-access.service";
import { coalesceTaskStatus } from "./task-fsm";

/**
 * S20-TASK-ALLOWEDACTIONS-1 — `allowedActions` của chi tiết việc (CHỈ để trình bày, KHÔNG phải cổng).
 *
 * MỘT bảng, MỘT hàm: mỗi khoá ↔ ĐÚNG cặp quyền + điều kiện hàng của route chuyên trách tương ứng
 * (`tasks.controller.ts` + service lớp 2). Không cặp mới, không biểu thức quyền thứ hai, KHÔNG suy từ
 * cổng `PATCH /tasks/:id`. Giá trị = cặp có (`scope != null`, so lỏng) ∧ việc nằm trong phạm vi GHI của
 * cặp (`checkTaskInScopeTx`, mode `write` cố định) ∧ không phải việc workflow ∧ điều kiện vòng đời.
 * Server vẫn 403/404 khi thao tác thật — FE không bao giờ tin trường này cho an ninh.
 */
const TASK_RESOURCE = "task";

interface Gate {
  key: TaskAllowedActionKey;
  action: string;
  isSensitive?: boolean;
  /** `change-priority` · `change-deadline` · `assign` trả 422 với việc đã huỷ; status/state/edit/delete thì không. */
  blockCancelled?: boolean;
  /** `move-state`: không dự án ⇒ 400, việc con ⇒ 400 (applyStateChangeTx) — không phụ thuộc đầu vào. */
  requiresProjectRoot?: boolean;
}

export const TASK_ALLOWED_ACTION_GATES: readonly Gate[] = [
  { key: "changeStatus", action: "update-status" },
  { key: "changeState", action: "update-state", requiresProjectRoot: true },
  { key: "changeDeadline", action: "update-deadline", blockCancelled: true },
  { key: "changePriority", action: "update-priority", blockCancelled: true },
  { key: "assign", action: "assign", blockCancelled: true },
  { key: "edit", action: "update" },
  { key: "delete", action: "delete", isSensitive: true },
];

/** Khoá chính của «chỉ theo dõi» (Q6). */
const LOCK_KEYS: readonly TaskAllowedActionKey[] = ["changeStatus", "changeDeadline", "assign"];

export interface AllowedActionsUser {
  id: string;
  companyId: string;
  viaApiKey?: boolean;
}

export interface AllowedActionsRow {
  id: string;
  taskStatus: string | null;
  projectId: string | null;
  parentTaskId?: string | null;
  /** `task_type` thuộc workflow (FSM làm chủ) — service tính bằng đúng tập `WORKFLOW_TASK_TYPES`. */
  isWorkflow: boolean;
}

export interface AllowedActionsDeps {
  projectAccess: Pick<ProjectAccessService, "checkTaskInScopeTx">;
  /** Người gọi đang theo dõi việc? Chỉ gọi khi cần lý do (3 khoá chính đều false). */
  isWatcher: (tx: TenantTx, user: AllowedActionsUser, taskId: string) => Promise<boolean>;
}

/** Yêu cầu quyền theo đúng thứ tự bảng — `resolveManyOrNull` trả mảng THEO CHỈ SỐ. */
export function allowedActionRequests(): ScopeRequest[] {
  return TASK_ALLOWED_ACTION_GATES.map((g) => ({
    action: g.action,
    resourceType: TASK_RESOURCE,
    ...(g.isSensitive ? { isSensitive: true } : {}),
  }));
}

/**
 * TRONG tx, SAU khi đã tìm thấy hàng (đã qua phạm vi ĐỌC ⇒ không lộ tồn tại). `scopes` = kết quả
 * `resolveManyOrNull(allowedActionRequests())` resolve TRƯỚC tx. `viaApiKey` ⇒ `undefined` (guard còn lọc
 * scopeKeys mà helper không mô phỏng).
 */
export async function computeTaskAllowedActions(
  deps: AllowedActionsDeps,
  tx: TenantTx,
  user: AllowedActionsUser,
  row: AllowedActionsRow,
  scopes: readonly (DataScope | null | undefined)[],
): Promise<TaskAllowedActions | undefined> {
  if (user.viaApiKey) return undefined;
  const cancelled = coalesceTaskStatus(row.taskStatus) === "Cancelled";
  // Memo theo GIÁ TRỊ phạm vi: `checkTaskInScopeTx` mở kết nối lồng (resolveContext) — ≤1 lần/phạm vi.
  const inScope = new Map<DataScope, Promise<boolean>>();
  const check = (scope: DataScope): Promise<boolean> => {
    const hit = inScope.get(scope);
    if (hit) return hit;
    const p = deps.projectAccess.checkTaskInScopeTx(tx, user, row.id, scope, "write");
    inScope.set(scope, p);
    return p;
  };
  const out: Partial<Record<TaskAllowedActionKey, boolean>> = {};
  // Tuần tự (cùng tx — không Promise.all).
  for (let i = 0; i < TASK_ALLOWED_ACTION_GATES.length; i++) {
    const g = TASK_ALLOWED_ACTION_GATES[i];
    const scope = scopes[i];
    const rowOk =
      !row.isWorkflow &&
      !(g.blockCancelled && cancelled) &&
      !(g.requiresProjectRoot && (row.projectId == null || row.parentTaskId != null));
    out[g.key] = scope != null && rowOk ? await check(scope) : false;
  }
  const locked = LOCK_KEYS.every((k) => out[k] === false);
  // Lười: 0 truy vấn thêm khi có ≥1 khoá chính true (trường hợp thường gặp).
  const lockReason = locked && (await deps.isWatcher(tx, user, row.id)) ? "watcher" : null;
  return { ...out, lockReason };
}
