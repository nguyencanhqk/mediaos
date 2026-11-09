import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OnChangeFn, RowSelectionState } from "@tanstack/react-table";
import { useQueryClient } from "@tanstack/react-query";
import {
  taskCollabApi,
  taskCoreApi,
  taskCoreInvalidation,
  taskKeys,
  useCan,
} from "@mediaos/web-core";
import { TASK_CORE_ENGINE_PAIRS } from "../constants";
import type {
  TaskActionResponseDto,
  TaskCoreResponseDto,
  TaskCoreStatusDto,
} from "@mediaos/contracts";
import {
  normalizeTaskActionWarnings,
  type TaskAssigneeWarningKind,
} from "./use-task-action-mutation-warnings";
import { patchTaskRows } from "./optimistic-task-rows";

/**
 * S20-TASK-BULKACTIONS-1 (US-TASK-QL-03) — thao tác HÀNG LOẠT trên các việc đã chọn.
 *
 * KHÔNG có endpoint bulk: mỗi việc đi qua ĐÚNG route action chuyên trách (assign · change-deadline ·
 * change-status · move-state) nên mỗi việc có activity + audit + thông báo riêng và server kiểm đúng
 * cặp quyền cho TỪNG phần tử. Các lời gọi chạy theo lô {@link TASK_BULK_CONCURRENCY} bằng
 * `Promise.allSettled` — một dòng lỗi không làm hỏng dòng khác. FE không phân biệt «không tồn tại» với
 * «không có quyền» (cả hai là «Không thực hiện được»).
 */

/** Trần số việc cho MỘT lệnh hàng loạt; vượt ⇒ nút xác nhận khoá kèm lời giải thích. */
export const TASK_BULK_MAX = 50;

/** Số lời gọi route action chạy đồng thời. */
export const TASK_BULK_CONCURRENCY = 5;

export type TaskBulkAction =
  | { readonly kind: "assign"; readonly employeeId: string; readonly employeeName: string | null }
  | { readonly kind: "deadline"; readonly dueAt: string | null }
  | { readonly kind: "status"; readonly status: TaskCoreStatusDto }
  | { readonly kind: "moveState"; readonly stateId: string };

export interface TaskBulkOutcome {
  readonly total: number;
  readonly succeeded: readonly TaskCoreResponseDto[];
  /** id các việc KHÔNG thực hiện được (đúng thứ tự đã chọn). */
  readonly failedIds: readonly string[];
  /** Số việc có từng loại cảnh báo (gộp thành MỘT cảnh báo tổng ở phía hiển thị). */
  readonly warningCounts: Readonly<Record<TaskAssigneeWarningKind, number>>;
}

interface Settled {
  readonly task: TaskCoreResponseDto;
  readonly warnings: ReadonlySet<TaskAssigneeWarningKind>;
}

/** Gọi đúng route action chuyên trách cho MỘT việc. */
async function callRoute(taskId: string, action: TaskBulkAction): Promise<Settled> {
  if (action.kind === "moveState") {
    const task = await taskCollabApi.moveTaskState(taskId, { stateId: action.stateId });
    return { task, warnings: new Set() };
  }
  const response: TaskActionResponseDto =
    action.kind === "assign"
      ? await taskCoreApi.assign(taskId, { assigneeEmployeeId: action.employeeId })
      : action.kind === "deadline"
        ? await taskCoreApi.changeDeadline(taskId, { dueAt: action.dueAt })
        : await taskCoreApi.changeStatus(taskId, { status: action.status });
  const raw: unknown = (response as { readonly warnings?: unknown }).warnings;
  const kinds = normalizeTaskActionWarnings(raw).map((w) => w.kind);
  return { task: response.task, warnings: new Set(kinds) };
}

/** Hàm thuần: chạy `action` trên `taskIds` theo lô; không ném — lỗi từng việc nằm trong `failedIds`. */
export async function runTaskBulk(
  taskIds: readonly string[],
  action: TaskBulkAction,
  concurrency: number = TASK_BULK_CONCURRENCY,
): Promise<TaskBulkOutcome> {
  const settled: PromiseSettledResult<Settled>[] = [];
  for (let start = 0; start < taskIds.length; start += concurrency) {
    const batch = taskIds.slice(start, start + concurrency);
    settled.push(...(await Promise.allSettled(batch.map((id) => callRoute(id, action)))));
  }
  const succeeded: TaskCoreResponseDto[] = [];
  const failedIds: string[] = [];
  const warningCounts: Record<TaskAssigneeWarningKind, number> = { onLeave: 0, notMember: 0 };
  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      failedIds.push(taskIds[index] ?? "");
      return;
    }
    succeeded.push(result.value.task);
    for (const kind of result.value.warnings) warningCounts[kind] += 1;
  });
  return { total: taskIds.length, succeeded, failedIds, warningCounts };
}

/** Chạy hàng loạt + làm tươi cache: dòng thành công đổi ngay (không cần F5), rồi refetch danh sách. */
export function useTaskBulkAction() {
  const queryClient = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (taskIds: readonly string[], action: TaskBulkAction): Promise<TaskBulkOutcome> => {
      setIsRunning(true);
      try {
        const outcome = await runTaskBulk(taskIds, action);
        for (const task of outcome.succeeded) {
          await patchTaskRows(queryClient, task.id, { ...task });
        }
        for (const key of [...taskCoreInvalidation.list(), ...taskCoreInvalidation.my()]) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
        const projectIds = new Set(
          outcome.succeeded.flatMap((task) => (task.projectId ? [task.projectId] : [])),
        );
        for (const projectId of projectIds) {
          void queryClient.invalidateQueries({ queryKey: taskKeys.kanban(projectId) });
        }
        return outcome;
      } finally {
        if (mounted.current) setIsRunning(false);
      }
    },
    [queryClient],
  );

  return { run, isRunning };
}

/**
 * Trạng thái chọn dòng theo id. Id không còn trong danh sách hiện tại (đổi bộ lọc / sang trang khác)
 * bị tỉa (đổi trang/lọc trong DataTable cũng tỉa qua `rowSelection.onChange`) — thanh hành động chỉ bao giờ
 * tác động lên việc ĐANG thấy trên màn.
 */
export function useTaskRowSelection(items: readonly TaskCoreResponseDto[]) {
  const [selection, setSelection] = useState<RowSelectionState>({});

  useEffect(() => {
    const present = new Set(items.map((task) => task.id));
    setSelection((prev) => {
      const stale = Object.keys(prev).some((id) => !present.has(id));
      if (!stale) return prev;
      return Object.fromEntries(Object.entries(prev).filter(([id]) => present.has(id)));
    });
  }, [items]);

  const onChange: OnChangeFn<RowSelectionState> = useCallback((updater) => {
    setSelection((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  const selectedTasks = useMemo(
    () => items.filter((task) => selection[task.id] === true),
    [items, selection],
  );

  /**
   * Chỉ giữ chọn các id này (dòng lỗi vẫn được chọn để thử lại) — GIAO với lựa chọn HIỆN TẠI: dòng người dùng
   * vừa bỏ chọn trong lúc lệnh chạy không bị chọn lại, và dòng họ chọn thêm không bị ghi đè bằng tập cũ.
   */
  const retainOnly = useCallback((ids: readonly string[]) => {
    const keep = new Set(ids);
    setSelection((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([id, on]) => on && keep.has(id))),
    );
  }, []);

  const clear = useCallback(() => setSelection({}), []);

  return { selection, onChange, selectedTasks, retainOnly, clear };
}

/** Quyền từng hành động hàng loạt — mỗi nút chỉ hiện khi có đúng cặp quyền của route action tương ứng. */
export function useTaskBulkPermissions() {
  const canAssign = useCan(
    TASK_CORE_ENGINE_PAIRS.ASSIGN.action,
    TASK_CORE_ENGINE_PAIRS.ASSIGN.resourceType,
  );
  const canDeadline = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_DEADLINE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_DEADLINE.resourceType,
  );
  const canStatus = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATUS.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATUS.resourceType,
  );
  const canMoveState = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATE.resourceType,
  );
  return { canAssign, canDeadline, canStatus, canMoveState };
}
