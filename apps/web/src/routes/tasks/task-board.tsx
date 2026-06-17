import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Calendar, KanbanSquare, ListChecks, Table2 } from "lucide-react";
import type { ListTasksQueryRequest, TaskDto } from "@mediaos/contracts";
import { tasksApi } from "@/lib/tasks-api";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskKanban } from "@/components/tasks/task-kanban";
import { TaskTable } from "@/components/tasks/task-table";
import { TaskCalendar } from "@/components/tasks/task-calendar";
import { TaskTypeFilter, type TaskTypeFilterValue } from "@/components/tasks/task-type-filter";
import {
  TaskStatusFilter,
  type TaskStatusFilterValue,
} from "@/components/tasks/task-status-filter";

/**
 * Task Board (PHASE 2 — MISA AMIS): PageHeader + toolbar (lọc loại/trạng thái + chuyển view) → board
 * Kanban/Bảng/Lịch → loading (Skeleton) / empty (EmptyState có icon) / error (card).
 *
 * Server là nguồn sự thật: GET /tasks/board gated read:task. Filter task_type chuyển XUỐNG server
 * (mirror BE listAll); filter status lọc PHÍA CLIENT trên danh sách đã fetch (không đổi query gốc).
 * KHÔNG đổi hook/permission — chỉ layout/UI.
 */
type BoardView = "kanban" | "table" | "calendar";

const VIEW_ICON: Record<BoardView, typeof KanbanSquare> = {
  kanban: KanbanSquare,
  table: Table2,
  calendar: Calendar,
};

export function TaskBoardPage() {
  const { t } = useTranslation("tasks");
  const [view, setView] = useState<BoardView>("kanban");
  const [typeFilter, setTypeFilter] = useState<TaskTypeFilterValue>(null);
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilterValue>(null);

  const VIEW_LABELS: Record<BoardView, string> = {
    kanban: t("board.viewKanban"),
    table: t("board.viewTable"),
    calendar: t("board.viewCalendar"),
  };

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

  // Lọc status phía client (UI thu hẹp hiển thị, không phải lớp bảo mật — server vẫn gate read:task).
  const visibleTasks = useMemo<TaskDto[]>(
    () => (statusFilter ? tasks.filter((task) => task.status === statusFilter) : tasks),
    [tasks, statusFilter],
  );

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <PageHeader
        title={t("board.pageTitle")}
        description={t("board.pageDescription")}
        icon={ListChecks}
        actions={
          <div className="flex gap-1 rounded-lg border border-border p-0.5">
            {(Object.keys(VIEW_LABELS) as BoardView[]).map((v) => {
              const Icon = VIEW_ICON[v];
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                    view === v
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.9} />
                  {VIEW_LABELS[v]}
                </button>
              );
            })}
          </div>
        }
      >
        <div className="space-y-2.5">
          <TaskTypeFilter value={typeFilter} onChange={setTypeFilter} />
          <TaskStatusFilter value={statusFilter} onChange={setStatusFilter} />
          {/* Sub-view nhanh "Office Tasks" = filter office (BĐ §filesToTouch). */}
          <button
            type="button"
            onClick={() => setTypeFilter((cur) => (cur === "office" ? null : "office"))}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            {typeFilter === "office" ? t("board.clearOfficeFilter") : t("board.showOfficeOnly")}
          </button>
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading && <BoardSkeleton />}

        {isError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
            <p className="text-sm font-medium text-destructive">{t("board.loadError")}</p>
          </div>
        )}

        {!isLoading && !isError && visibleTasks.length === 0 && (
          <EmptyState
            icon={ListChecks}
            title={t("board.emptyTitle")}
            description={t("board.emptyDescription")}
          />
        )}

        {!isLoading && !isError && visibleTasks.length > 0 && (
          <>
            {view === "kanban" && <TaskKanban tasks={visibleTasks} />}
            {view === "table" && <TaskTable tasks={visibleTasks} />}
            {view === "calendar" && <TaskCalendar tasks={visibleTasks} />}
          </>
        )}
      </div>
    </div>
  );
}

/** Skeleton dạng cột Kanban (3 cột × vài card) — dùng Skeleton dùng chung. */
function BoardSkeleton() {
  return (
    <div className="flex gap-3" aria-hidden>
      {[0, 1, 2].map((col) => (
        <div key={col} className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/40 p-2">
          <Skeleton className="h-5 w-24" />
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ))}
    </div>
  );
}
