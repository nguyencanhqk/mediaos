import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { VisibilityState } from "@tanstack/react-table";
import { RefreshCw, Settings2 } from "lucide-react";
import { taskCoreApi, taskKeys, useCan } from "@mediaos/web-core";
import { Button, Checkbox, DataTable, EmptyState, Popover } from "@mediaos/ui";
import { TASK_CORE_PAGE_LIMIT_MAX } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { useTaskReadColumns } from "./task-columns";
import { AssigneeRail } from "./AssigneeRail";
import {
  buildAssigneeSummary,
  matchesAssigneeSelection,
  matchesWorkspaceFilters,
  pinSelectedInSummary,
  sortWorkspaceTasks,
  type WorkspaceTaskFilters,
} from "./workspace-constants";

const PAGE_SIZE = 20;

/**
 * ProjectTaskListTab — tab "Danh sách" của workspace dự án (S5-TASK-WORKSPACE-1, SPEC-06 §13.3 tab
 * "Task"). KHÁC TaskListPage (/tasks — danh sách TOÀN CÔNG TY, filter server-side): tab này cố định
 * 1 dự án, tải 1 trang lớn (limit = TASK_CORE_PAGE_LIMIT_MAX, cùng bậc trần 500/cột của board) rồi
 * lọc/sắp/tìm CLIENT-SIDE qua CÙNG helper với tab Bảng (workspace-constants) ⇒ đổi filter ở tab này
 * giữ nguyên khi sang tab kia (done_when #2), rail avatar đếm nhất quán. Dự án >200 task sẽ chỉ thấy
 * 200 task đầu — chấp nhận ở MVP (board cũng có trần), KHÔNG âm thầm: bảng vẫn phân trang client.
 *
 * Gate `read:task` (TASK.TASK.VIEW) — mirror TaskListPage; cột "Dự án" ẩn mặc định (thừa trong
 * workspace 1 dự án), bật lại được qua menu "Hiển thị" (tuỳ chỉnh hiển thị — benchmark MISA).
 */
export function ProjectTaskListTab({
  projectId,
  filters,
  assigneeSelection,
  onToggleAssignee,
  onClearAssignees,
}: {
  projectId: string;
  filters: WorkspaceTaskFilters;
  assigneeSelection: ReadonlySet<string>;
  onToggleAssignee: (value: string) => void;
  onClearAssignees: () => void;
}) {
  const { t } = useTranslation("tasks");
  const canView = useCan(
    TASK_CORE_ENGINE_PAIRS.READ.action,
    TASK_CORE_ENGINE_PAIRS.READ.resourceType,
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(new Set(["projectName"]));

  const queryParams = { projectId, limit: TASK_CORE_PAGE_LIMIT_MAX, offset: 0 };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: taskKeys.list(queryParams),
    queryFn: () => taskCoreApi.listTasks(queryParams),
    enabled: canView,
    staleTime: 30_000,
  });

  const items = useMemo(() => data ?? [], [data]);
  // Thứ tự áp: toolbar → (summary rail tính TẠI ĐÂY — trước lọc assignee, GHIM người đang chọn) →
  // assignee → sort.
  const toolbarFiltered = useMemo(
    () => items.filter((task) => matchesWorkspaceFilters(task, filters)),
    [items, filters],
  );
  const railSummary = useMemo(
    () => pinSelectedInSummary(buildAssigneeSummary(toolbarFiltered), assigneeSelection, items),
    [toolbarFiltered, assigneeSelection, items],
  );
  const visibleTasks = useMemo(
    () =>
      sortWorkspaceTasks(
        toolbarFiltered.filter((task) => matchesAssigneeSelection(task, assigneeSelection)),
        filters.sort,
      ),
    [toolbarFiltered, assigneeSelection, filters.sort],
  );

  const columns = useTaskReadColumns();
  const columnVisibility: VisibilityState = Object.fromEntries(
    Array.from(hiddenColumns, (key) => [key, false]),
  );
  const toggleColumn = (key: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  // Nhãn lấy từ CHÍNH header của column def (useTaskReadColumns đã t() sẵn) — một nguồn danh tính
  // cột duy nhất, thêm/đổi cột ở task-columns.tsx tự đúng ở menu này.
  const toggleableColumns = columns.flatMap((col) =>
    "accessorKey" in col && col.accessorKey !== "title"
      ? [
          {
            key: String(col.accessorKey),
            label: typeof col.header === "string" ? col.header : String(col.accessorKey),
          },
        ]
      : [],
  );

  if (!canView) {
    return (
      <EmptyState
        title={t("tasks.list.forbidden.title")}
        description={t("tasks.list.forbidden.description")}
      />
    );
  }

  if (isError) {
    return (
      <EmptyState
        title={t("tasks.list.error.title")}
        description={t("tasks.list.error.description")}
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("actions.retry", { ns: "common" })}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center justify-end">
          <Popover
            open={columnsOpen}
            onOpenChange={setColumnsOpen}
            trigger={
              <Button
                variant="outline"
                size="sm"
                onClick={() => setColumnsOpen((v) => !v)}
                data-testid="list-columns-toggle"
              >
                <Settings2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                {t("workspace.toolbar.columns")}
              </Button>
            }
          >
            <p className="pb-2 text-xs font-semibold uppercase text-muted-foreground">
              {t("workspace.toolbar.columnsTitle")}
            </p>
            <div className="space-y-1.5">
              {toggleableColumns.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={!hiddenColumns.has(key)}
                    onChange={() => toggleColumn(key)}
                    data-testid={`list-column-checkbox-${key}`}
                  />
                  {label}
                </label>
              ))}
            </div>
          </Popover>
        </div>
        <DataTable
          columns={columns}
          data={visibleTasks}
          isLoading={isLoading}
          columnVisibility={columnVisibility}
          emptyState={
            <EmptyState
              title={t("workspace.list.empty.title")}
              description={t("workspace.list.empty.description")}
            />
          }
          pageSize={PAGE_SIZE}
        />
        {/* Chạm trần 1-trang-lớn: nói THẲNG là đang cắt (không im lặng như thể đã đủ). */}
        {items.length === TASK_CORE_PAGE_LIMIT_MAX && (
          <p className="text-xs text-muted-foreground" data-testid="list-truncated-hint">
            {t("workspace.list.truncated", { count: TASK_CORE_PAGE_LIMIT_MAX })}
          </p>
        )}
      </div>
      <AssigneeRail
        summary={railSummary}
        selection={assigneeSelection}
        onToggle={onToggleAssignee}
        onClear={onClearAssignees}
      />
    </div>
  );
}
