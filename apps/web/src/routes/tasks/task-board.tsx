import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ListTasksQueryRequest } from "@mediaos/contracts";
import { tasksApi } from "@/lib/tasks-api";
import { TaskKanban } from "@/components/tasks/task-kanban";
import { TaskTable } from "@/components/tasks/task-table";
import { TaskCalendar } from "@/components/tasks/task-calendar";
import { TaskTypeFilter, type TaskTypeFilterValue } from "@/components/tasks/task-type-filter";

/**
 * Task Board tổng (G9-3) — đủ 7 task_type, 3 view Kanban/Table/Calendar + filter task_type +
 * sub-view "Office Tasks" (= filter office). Office task đi luồng rút gọn (3-status) ngay trên card.
 *
 * Server là nguồn sự thật: GET /tasks/board gated read:task. Filter task_type chuyển xuống server
 * (mirror BE listAll) — client không nhận row thì không render được (mask theo quyền là việc server).
 */
type BoardView = "kanban" | "table" | "calendar";

const VIEW_LABELS: Record<BoardView, string> = {
  kanban: "Kanban",
  table: "Bảng",
  calendar: "Lịch",
};

export function TaskBoardPage() {
  const [view, setView] = useState<BoardView>("kanban");
  const [typeFilter, setTypeFilter] = useState<TaskTypeFilterValue>(null);

  const filter = useMemo<ListTasksQueryRequest | undefined>(
    () => (typeFilter ? { taskType: typeFilter } : undefined),
    [typeFilter],
  );

  const {
    data: tasks = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["tasks", "board", typeFilter],
    queryFn: () => tasksApi.getBoard(filter),
    // Giữ kết quả cũ khi đổi filter → tránh nháy "Đang tải…" mỗi lần lọc (chỉ first-load mới isLoading).
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Bảng công việc</h1>
          <div className="flex gap-1 rounded-lg border border-border p-0.5">
            {(Object.keys(VIEW_LABELS) as BoardView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  view === v ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
        </div>

        <TaskTypeFilter value={typeFilter} onChange={setTypeFilter} />

        {/* Sub-view nhanh "Office Tasks" = filter office (BĐ §filesToTouch). */}
        <div>
          <button
            type="button"
            onClick={() => setTypeFilter((cur) => (cur === "office" ? null : "office"))}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            {typeFilter === "office" ? "Bỏ lọc Office Tasks" : "Chỉ xem Office Tasks"}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Đang tải…</p>}
        {isError && (
          <p className="py-8 text-center text-sm text-destructive">
            Không tải được công việc (có thể thiếu quyền xem).
          </p>
        )}
        {!isLoading && !isError && (
          <>
            {view === "kanban" && <TaskKanban tasks={tasks} />}
            {view === "table" && <TaskTable tasks={tasks} />}
            {view === "calendar" && <TaskCalendar tasks={tasks} />}
          </>
        )}
      </div>
    </div>
  );
}
