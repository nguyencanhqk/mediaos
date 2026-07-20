import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taskCoreApi, taskKeys, useAuthStore, useCan, ApiError } from "@mediaos/web-core";
import { Card, Button } from "@mediaos/ui";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { useTaskActionMutation } from "./hooks/use-task-action-mutation";

/**
 * TaskWatchersPanel — người theo dõi / người liên quan của task (S5-TASK-DETAIL-1 GAP 4; tách khỏi
 * TaskAssignControl cũ ở S5-TASK-INLINE-1 để "người phụ trách" xuống được lưới thông tin còn khối
 * theo dõi đứng thành mục riêng — trước đây hai thứ dính nhau nên không đặt rời chỗ được).
 *
 * GET /tasks/:id/watchers (gate watch:task) → list người đang theo dõi + nhận diện "watcher của mình"
 * qua userId (useAuthStore) ⇒ nút Theo dõi/Bỏ theo dõi (DELETE .../watchers/:id — server vẫn self-only,
 * gỡ hộ người khác → 404). Trạng thái "đang theo dõi" lấy từ SERVER (list), KHÔNG giữ flag local song
 * song: flag từng gây kẹt nút khi add thành công mà list chưa chứa self.
 */
function watcherErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400 || err.status === 422) return "tasks.assign.errors.validation";
    if (err.status === 403) return "tasks.assign.errors.forbidden";
    if (err.status === 404) return "tasks.assign.errors.notFound";
    if (err.status >= 500) return "tasks.assign.errors.server";
  }
  return "tasks.assign.errors.generic";
}

export function TaskWatchersPanel({ task }: { task: TaskCoreResponseDto }) {
  const { t } = useTranslation("tasks");
  const canWatch = useCan(
    TASK_CORE_ENGINE_PAIRS.WATCH.action,
    TASK_CORE_ENGINE_PAIRS.WATCH.resourceType,
  );
  const myUserId = useAuthStore((s) => s.user?.id);
  const queryClient = useQueryClient();

  const watchersQuery = useQuery({
    queryKey: taskKeys.watchers(task.id),
    queryFn: () => taskCoreApi.listWatchers(task.id),
    enabled: canWatch,
    staleTime: 30_000,
  });
  const watchers = watchersQuery.data ?? [];
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

  if (!canWatch) return null;

  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {t("tasks.assign.watchersTitle", { count: watchers.length })}
        </h3>
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
      </div>

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

      <p className="text-xs text-muted-foreground">{t("tasks.assign.watchHint")}</p>

      {watchMutation.isError && !isWatching && (
        <p role="alert" className="text-xs text-destructive">
          {t(watcherErrorKey(watchMutation.error))}
        </p>
      )}
      {unwatchMutation.isError && (
        <p role="alert" className="text-xs text-destructive">
          {t(watcherErrorKey(unwatchMutation.error))}
        </p>
      )}
    </Card>
  );
}
