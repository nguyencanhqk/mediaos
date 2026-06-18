import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCan } from "@mediaos/web-core";
import type { BoardTaskDto, ProjectStateDto } from "@mediaos/contracts";
import { groupTasksByState, NO_STATE_COLUMN_ID } from "@/lib/board-group";
import { useEmployeeMap } from "@/lib/use-members";
import { IssueCard } from "./issue-card";
import { QuickAdd } from "./quick-add";

interface IssueBoardProps {
  projectId: string;
  states: ProjectStateDto[];
  tasks: BoardTaskDto[];
  onOpenIssue: (taskId: string) => void;
}

/**
 * Board Kanban kiểu Plane: cột = project_states theo sortOrder; header có chấm màu state + tên + đếm.
 * Mỗi cột có quick-add đầu cột (tạo task với state cột đó). Cột "Chưa có trạng thái" hiện khi có item
 * stateId null. Click card mở panel chi tiết. Server là sự thật cho mọi dữ liệu/quyền.
 */
export function IssueBoard({ projectId, states, tasks, onOpenIssue }: IssueBoardProps) {
  const { t } = useTranslation("projects");
  const canCreate = useCan("create", "task");
  const { labelFor } = useEmployeeMap();

  const columns = useMemo(() => groupTasksByState(states, tasks), [states, tasks]);

  return (
    <div className="flex h-full gap-3 overflow-x-auto pb-2">
      {columns.map((col) => (
        <section
          key={col.id}
          className="flex w-80 shrink-0 flex-col rounded-xl bg-muted/40"
          aria-label={col.name ?? t("board.noStateColumn")}
        >
          <header className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: col.color ?? "#94a3b8" }}
                aria-hidden
              />
              <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-foreground/70">
                {col.name ?? t("board.noStateColumn")}
              </h3>
            </div>
            <span className="rounded-full bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
              {col.items.length}
            </span>
          </header>

          <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
            {/* Quick-add chỉ cho cột state thật (không cho cột "Chưa có trạng thái") + có quyền tạo. */}
            {canCreate && col.id !== NO_STATE_COLUMN_ID && (
              <QuickAdd projectId={projectId} stateId={col.id} />
            )}

            {col.items.map((task) => (
              <IssueCard
                key={task.id}
                task={task}
                onClick={onOpenIssue}
                assigneeLabel={labelFor(task.assigneeUserId)}
              />
            ))}

            {col.items.length === 0 && (
              <p className="rounded-lg border border-dashed border-border/70 px-1 py-6 text-center text-[11px] text-muted-foreground/70">
                {t("board.emptyColumn")}
              </p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
