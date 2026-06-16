import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TaskDto } from "@mediaos/contracts";
import { TaskBoardCard } from "./task-card";
import { KANBAN_STATUS_ORDER, TASK_STATUS_LABELS } from "./task-status-constants";

/**
 * Kanban view (G9-3) — cột theo status (luồng đầy đủ; cột rỗng vẫn hiện để layout ổn định).
 * Office/non-workflow card có control luồng rút gọn ngay trên card (TaskBoardCard).
 */
interface TaskKanbanProps {
  tasks: TaskDto[];
}

export function TaskKanban({ tasks }: TaskKanbanProps) {
  const { t } = useTranslation("tasks");
  const byStatus = useMemo(() => {
    const map = new Map<TaskDto["status"], TaskDto[]>();
    for (const status of KANBAN_STATUS_ORDER) map.set(status, []);
    for (const task of tasks) {
      const bucket = map.get(task.status);
      if (bucket) bucket.push(task);
    }
    return map;
  }, [tasks]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {KANBAN_STATUS_ORDER.map((status) => {
        const items = byStatus.get(status) ?? [];
        return (
          <div key={status} className="flex w-64 shrink-0 flex-col">
            <div className="mb-2 flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {TASK_STATUS_LABELS[status]}
              </h3>
              <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                {items.length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2 rounded-lg bg-muted/30 p-2">
              {items.map((task) => (
                <TaskBoardCard key={task.id} task={task} />
              ))}
              {items.length === 0 && (
                <p className="px-1 py-3 text-center text-[11px] text-muted-foreground/70">
                  {t("kanban.emptyColumn")}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
