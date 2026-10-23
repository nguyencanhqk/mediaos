import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { ListChecks, RefreshCw, Trash2, Pencil, Plus } from "lucide-react";
import { taskCoreApi, taskKeys, useCan, useCanExact, PermissionGate } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button } from "@mediaos/ui";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { useTaskReadColumns } from "./task-columns";
import { TaskListToolbar } from "./TaskListToolbar";
import { hasActiveTaskListFilters, toTaskListQuery } from "./task-list-search";
import { useTaskListSearch } from "./use-task-list-search";
import { TaskFormDrawer } from "./TaskFormDrawer";
import { DeleteTaskDialog } from "./DeleteTaskDialog";

/**
 * TaskListPage — S4-FE-TASK-2 (SPEC-06 §13.5, TASK-SCREEN-005).
 *
 * Cổng đọc = TASK.TASK.VIEW (route-level, ProtectedRoute — resolve → read:task) + useCan lặp lại ở
 * component (deny-path khi mount trực tiếp ngoài route guard). Create/Edit gate qua PermissionGate/useCan
 * (create:task/update:task, non-sensitive). Delete gate qua useCanExact (delete:task LÀ sensitive, seed
 * 0485 bước (b)) — KHÔNG wildcard fallback, tránh FE cho hiện nút mà BE luôn 403.
 *
 * GET /tasks trả MẢNG TRẦN (KHÔNG kèm `total` — xem task-core.service.ts listTasks) → phân trang FE dùng
 * offset "tải thêm" (heuristic: còn trang kế khi số dòng trả == PAGE_SIZE), mirror ProjectListPage.
 *
 * S20-TASK-DRAWER-1 (US-TASK-QL-05): bộ lọc + trang sống trên URL (`validateTaskListSearch`, route
 * `/tasks`) thay cho `useState` — mở việc (drawer `?task=`) rồi đóng, tải lại, Back từ trang chi
 * tiết hay gửi link đều giữ bộ lọc; server vẫn ép phạm vi dữ liệu của người xem.
 */
const PAGE_SIZE = 20;

export function TaskListPage() {
  const { t } = useTranslation("tasks");
  const canView = useCan(
    TASK_CORE_ENGINE_PAIRS.READ.action,
    TASK_CORE_ENGINE_PAIRS.READ.resourceType,
  );
  const canUpdate = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE.resourceType,
  );
  const canDelete = useCanExact(
    TASK_CORE_ENGINE_PAIRS.DELETE.action,
    TASK_CORE_ENGINE_PAIRS.DELETE.resourceType,
  );
  const { search, update, clearFilters } = useTaskListSearch();
  const page = search.page ?? 1;
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<TaskCoreResponseDto | null>(null);
  const [deleteItem, setDeleteItem] = useState<TaskCoreResponseDto | null>(null);

  const queryParams = toTaskListQuery(search, PAGE_SIZE);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: taskKeys.list(queryParams),
    queryFn: () => taskCoreApi.listTasks(queryParams),
    enabled: canView,
    staleTime: 30_000,
  });

  const readColumns = useTaskReadColumns();
  const columns: ColumnDef<TaskCoreResponseDto>[] = [
    ...readColumns,
    {
      id: "actions",
      header: () => <span className="sr-only">{t("tasks.list.columns.actions")}</span>,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          {canUpdate && (
            <PermissionGate
              action={TASK_CORE_ENGINE_PAIRS.UPDATE.action}
              resourceType={TASK_CORE_ENGINE_PAIRS.UPDATE.resourceType}
            >
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("tasks.detail.actions.edit")}
                onClick={() => setEditItem(row.original)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </PermissionGate>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("tasks.detail.actions.delete")}
              onClick={() => setDeleteItem(row.original)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("tasks.list.forbidden.title")}
          description={t("tasks.list.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
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
      </div>
    );
  }

  const items = data ?? [];
  const hasNext = items.length === PAGE_SIZE;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("tasks.list.title")}
        description={t("tasks.list.description")}
        icon={ListChecks}
        actions={
          <PermissionGate
            action={TASK_CORE_ENGINE_PAIRS.CREATE.action}
            resourceType={TASK_CORE_ENGINE_PAIRS.CREATE.resourceType}
          >
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("tasks.list.addButton")}
            </Button>
          </PermissionGate>
        }
      >
        <TaskListToolbar search={search} update={update} />
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          hasActiveTaskListFilters(search) ? (
            <EmptyState
              title={t("listFilters.emptyFiltered.title")}
              description={t("listFilters.emptyFiltered.description")}
              action={
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  {t("listFilters.clear")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              title={t("tasks.list.empty.title")}
              description={t("tasks.list.empty.description")}
            />
          )
        }
        pageSize={PAGE_SIZE}
      />

      {!isLoading && (page > 1 || hasNext) && (
        <div className="flex items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
          <span>{page}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => update({ page: page - 1 > 1 ? page - 1 : undefined })}
            >
              {t("pagination.prev", { ns: "common" })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext}
              onClick={() => update({ page: page + 1 })}
            >
              {t("pagination.next", { ns: "common" })}
            </Button>
          </div>
        </div>
      )}

      {createOpen && (
        <TaskFormDrawer
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSuccess={() => setCreateOpen(false)}
        />
      )}
      {editItem && (
        <TaskFormDrawer
          mode="edit"
          task={editItem}
          onClose={() => setEditItem(null)}
          onSuccess={() => setEditItem(null)}
        />
      )}
      {deleteItem && <DeleteTaskDialog task={deleteItem} onClose={() => setDeleteItem(null)} />}
    </div>
  );
}
