import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  taskCoreApi,
  taskKeys,
  hrApi,
  hrKeys,
  useAuthStore,
  useCan,
  ApiError,
} from "@mediaos/web-core";
import { Select, Button } from "@mediaos/ui";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { useTaskActionMutation } from "./hooks/use-task-action-mutation";

function assignErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400 || err.status === 422) return "tasks.assign.errors.validation";
    if (err.status === 403) return "tasks.assign.errors.forbidden";
    if (err.status === 404) return "tasks.assign.errors.notFound";
    if (err.status >= 500) return "tasks.assign.errors.server";
  }
  return "tasks.assign.errors.generic";
}

/**
 * TaskAssignControl — đổi người phụ trách + theo dõi task (S4-FE-TASK-2, SPEC-06 §13.7 Hành động nhanh:
 * "Đổi assignee — TASK.TASK.ASSIGN"; §14 assign:task/watch:task).
 *
 * Assignee: danh sách chọn LẤY TỪ `hrApi.listEmployees` (read:employee) — CÙNG kỹ thuật ProjectFormDrawer
 * chọn owner dự án. Server đã lọc theo data-scope của actor trên read:employee (Own/Team/Company) ⇒
 * "chỉ hiện người trong phạm vi" là do SERVER quyết định, client không tự lọc thêm — mirror nguyên tắc
 * masking/scope là việc của server (CLAUDE.md §5). Optimistic update CÓ rollback qua useTaskActionMutation.
 *
 * Watcher (S5-TASK-DETAIL-1 GAP 4): GET /tasks/:id/watchers (gate watch:task) → list NGƯỜI LIÊN QUAN
 * đang theo dõi + nhận diện "watcher của mình" qua userId (useAuthStore) ⇒ nút Theo dõi/Bỏ theo dõi
 * (DELETE .../watchers/:id — server vẫn self-only, gỡ hộ người khác → 404). Trạng thái "đang theo dõi"
 * lấy từ SERVER (list), optimistic flag chỉ bắc cầu giữa add thành công ↔ list refetch.
 */
export function TaskAssignControl({ task }: { task: TaskCoreResponseDto }) {
  const { t } = useTranslation("tasks");
  const canAssign = useCan(
    TASK_CORE_ENGINE_PAIRS.ASSIGN.action,
    TASK_CORE_ENGINE_PAIRS.ASSIGN.resourceType,
  );
  const canWatch = useCan(
    TASK_CORE_ENGINE_PAIRS.WATCH.action,
    TASK_CORE_ENGINE_PAIRS.WATCH.resourceType,
  );
  const canReadEmployees = useCan("read", "employee");
  const myUserId = useAuthStore((s) => s.user?.id);
  const queryClient = useQueryClient();

  const [selectedEmployeeId, setSelectedEmployeeId] = useState(task.mainAssigneeEmployeeId ?? "");

  const { data: employeesPage } = useQuery({
    queryKey: hrKeys.employees.list({ pageSize: 100, status: "active" }),
    queryFn: () => hrApi.listEmployees({ pageSize: 100, status: "active" }),
    enabled: canAssign && canReadEmployees,
    staleTime: 60_000,
  });
  const employees = employeesPage?.items ?? [];

  const assignMutation = useTaskActionMutation<string>({
    taskId: task.id,
    mutationFn: (assigneeEmployeeId) => taskCoreApi.assign(task.id, { assigneeEmployeeId }),
    toPatch: (assigneeEmployeeId) => ({
      mainAssigneeEmployeeId: assigneeEmployeeId,
      assigneeName: employees.find((e) => e.id === assigneeEmployeeId)?.fullName ?? null,
    }),
  });

  // S5-TASK-DETAIL-1 (GAP 4) — danh sách người theo dõi (server lọc Active/Muted, kèm tên + userId).
  const watchersQuery = useQuery({
    queryKey: taskKeys.watchers(task.id),
    queryFn: () => taskCoreApi.listWatchers(task.id),
    enabled: canWatch,
    staleTime: 30_000,
  });
  const watchers = watchersQuery.data ?? [];
  // Trạng thái "đang theo dõi" derive THUẦN từ list server — không flag local song song (flag từng
  // gây kẹt nút khi add thành công mà list không chứa self). Khoảng trống add→refetch chỉ là 1 chớp
  // isFetching (nút disable), và bấm lặp cũng vô hại: add trùng → 409 (đối xử như thành công) → refetch.
  const myWatcher = myUserId ? watchers.find((w) => w.userId === myUserId) : undefined;
  const isWatching = myWatcher !== undefined;

  // Watch/unwatch GHI activity log server-side (TASK_WATCHER_ADDED/REMOVED) ⇒ invalidate CẢ timeline
  // cùng trang (taskKeys.activityOf — prefix mọi trang phân trang), không chỉ danh sách watcher.
  const invalidateWatchers = () => {
    void queryClient.invalidateQueries({ queryKey: taskKeys.watchers(task.id) });
    void queryClient.invalidateQueries({ queryKey: taskKeys.activityOf(task.id) });
  };

  const watchMutation = useTaskActionMutation<void>({
    taskId: task.id,
    mutationFn: () => taskCoreApi.addWatcher(task.id),
    toPatch: () => ({}),
  });

  const unwatchMutation = useMutation({
    mutationFn: (watcherId: string) => taskCoreApi.removeWatcher(task.id, watcherId),
    onSettled: invalidateWatchers,
  });

  const handleWatch = () => {
    watchMutation.mutate(undefined, {
      onSuccess: invalidateWatchers,
      onError: (err) => {
        // 409 = đã theo dõi trước đó (idempotent theo UX — refetch để list phản ánh, KHÔNG coi là lỗi).
        if (err instanceof ApiError && err.status === 409) invalidateWatchers();
      },
    });
  };

  const handleUnwatch = () => {
    if (myWatcher) unwatchMutation.mutate(myWatcher.id);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="task-assignee-select" className="text-xs font-medium text-muted-foreground">
          {t("tasks.assign.label")}
        </label>
        {canAssign ? (
          <div className="flex items-center gap-2">
            <Select
              id="task-assignee-select"
              value={selectedEmployeeId}
              disabled={assignMutation.isPending}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              className="max-w-xs"
            >
              <option value="">{t("tasks.form.placeholders.none")}</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                assignMutation.isPending ||
                !selectedEmployeeId ||
                selectedEmployeeId === task.mainAssigneeEmployeeId
              }
              onClick={() => assignMutation.mutate(selectedEmployeeId)}
            >
              {assignMutation.isPending ? t("tasks.assign.saving") : t("tasks.assign.changeButton")}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-foreground">{task.assigneeName ?? "—"}</p>
        )}
        {!canReadEmployees && canAssign && (
          <p className="text-xs text-muted-foreground">{t("tasks.assign.employeeReadHint")}</p>
        )}
        {assignMutation.isError && (
          <p role="alert" className="text-xs text-destructive">
            {t(assignErrorKey(assignMutation.error))}
          </p>
        )}
      </div>

      {canWatch && (
        <div className="space-y-1.5">
          {isWatching ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={unwatchMutation.isPending || watchersQuery.isFetching}
              onClick={handleUnwatch}
            >
              {t("tasks.assign.unwatchButton")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={watchMutation.isPending || watchersQuery.isFetching}
              onClick={handleWatch}
            >
              {t("tasks.assign.watchButton")}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{t("tasks.assign.watchHint")}</p>
          {watchMutation.isError && !isWatching && (
            <p role="alert" className="text-xs text-destructive">
              {t(assignErrorKey(watchMutation.error))}
            </p>
          )}
          {unwatchMutation.isError && (
            <p role="alert" className="text-xs text-destructive">
              {t(assignErrorKey(unwatchMutation.error))}
            </p>
          )}

          <div className="space-y-1 pt-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t("tasks.assign.watchersTitle", { count: watchers.length })}
            </p>
            {watchersQuery.isLoading ? (
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            ) : watchersQuery.isError ? (
              <p className="text-xs text-destructive">{t("tasks.assign.watchersError")}</p>
            ) : watchers.length > 0 ? (
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {watchers.map((w) => (
                  <li key={w.id} className="text-sm text-foreground">
                    {w.employeeName ?? "—"}
                    {w.id === myWatcher?.id && (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        {t("tasks.assign.watcherSelfSuffix")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">{t("tasks.assign.watchersEmpty")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
