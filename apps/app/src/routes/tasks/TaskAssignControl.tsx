import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { taskCoreApi, hrApi, hrKeys, useCan, ApiError } from "@mediaos/web-core";
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
 * Watcher: SELF-ONLY MVP (BE-3) — CHỈ có nút "Theo dõi" (POST /watchers, idempotent qua 409 DUPLICATE).
 * BE-3 KHÔNG có endpoint GET liệt kê watchers ⇒ client không có watcherId để gọi DELETE .../watchers/:id
 * ⇒ CHƯA có nút "Bỏ theo dõi" ở đây — backend gap, cần WO nối tiếp bổ sung GET watchers trước khi làm tiếp.
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

  const [selectedEmployeeId, setSelectedEmployeeId] = useState(task.mainAssigneeEmployeeId ?? "");
  const [watchState, setWatchState] = useState<"idle" | "watching">("idle");

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

  const watchMutation = useTaskActionMutation<void>({
    taskId: task.id,
    mutationFn: () => taskCoreApi.addWatcher(task.id),
    toPatch: () => ({}),
  });

  const handleWatch = () => {
    watchMutation.mutate(undefined, {
      onSuccess: () => setWatchState("watching"),
      onError: (err) => {
        // 409 = đã theo dõi trước đó (idempotent theo UX — hiển thị như đã theo dõi, KHÔNG coi là lỗi).
        if (err instanceof ApiError && err.status === 409) setWatchState("watching");
      },
    });
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={watchState === "watching" || watchMutation.isPending}
            onClick={handleWatch}
          >
            {watchState === "watching" ? t("tasks.assign.watching") : t("tasks.assign.watchButton")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("tasks.assign.watchHint")}</p>
          {watchMutation.isError && watchState !== "watching" && (
            <p role="alert" className="text-xs text-destructive">
              {t(assignErrorKey(watchMutation.error))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
