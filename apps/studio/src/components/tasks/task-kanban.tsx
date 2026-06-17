import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TaskDto } from "@mediaos/contracts";
import { TaskBoardCard } from "./task-card";
import {
  KANBAN_STATUS_ORDER,
  TASK_STATUS_DOT,
  TASK_STATUS_LABELS,
} from "./task-status-constants";

/**
 * Kanban view (PHASE 2 — MISA AMIS): cột theo status (luồng đầy đủ; cột rỗng vẫn hiện để layout ổn
 * định). Header cột có chấm màu trạng thái + đếm số việc. Office/non-workflow card có control luồng
 * rút gọn ngay trên card (TaskBoardCard). KHÔNG đổi dữ liệu/permission — chỉ layout.
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
    <div className="flex h-full gap-3 overflow-x-auto pb-2">
      {KANBAN_STATUS_ORDER.map((status) => {
        const items = byStatus.get(status) ?? [];
        return (
          <section
            key={status}
            className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/40"
            aria-label={TASK_STATUS_LABELS[status]}
          >
            <header className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${TASK_STATUS_DOT[status]}`} aria-hidden />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
                  {TASK_STATUS_LABELS[status]}
                </h3>
              </div>
              <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
                {items.length}
              </span>
            </header>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {items.map((task) => (
                <TaskBoardCard key={task.id} task={task} />
              ))}
              {items.length === 0 && (
                <p className="rounded-lg border border-dashed border-border/70 px-1 py-6 text-center text-[11px] text-muted-foreground/70">
                  {t("kanban.emptyColumn")}
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
