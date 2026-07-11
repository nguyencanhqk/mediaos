import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { ListChecks, RefreshCw, Trash2, Pencil, Plus } from "lucide-react";
import {
  taskCoreApi,
  taskProjectApi,
  hrApi,
  hrKeys,
  taskKeys,
  useCan,
  useCanExact,
  PermissionGate,
} from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Input, Select } from "@mediaos/ui";
import type {
  TaskCoreResponseDto,
  TaskCoreStatusDto,
  TaskCorePriorityDto,
  ListTaskCoreQueryRequest,
} from "@mediaos/contracts";
import {
  TASK_CORE_ENGINE_PAIRS,
  TASK_CORE_STATUS_OPTIONS,
  TASK_CORE_PRIORITY_OPTIONS,
} from "./constants";
import { TaskStatusBadge, TaskPriorityBadge, TaskOverdueBadge } from "./TaskStatusBadge";
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
 */
const PAGE_SIZE = 20;

export function TaskListPage() {
  const { t } = useTranslation("tasks");
  const navigate = useNavigate();
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
  const canReadEmployees = useCan("read", "employee");
  const canReadProjects = useCan("read", "project");

  const [status, setStatus] = useState<TaskCoreStatusDto | "">("");
  const [priority, setPriority] = useState<TaskCorePriorityDto | "">("");
  const [assigneeEmployeeId, setAssigneeEmployeeId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<TaskCoreResponseDto | null>(null);
  const [deleteItem, setDeleteItem] = useState<TaskCoreResponseDto | null>(null);

  const { data: employeesPage } = useQuery({
    queryKey: hrKeys.employees.list({ pageSize: 100, status: "active" }),
    queryFn: () => hrApi.listEmployees({ pageSize: 100, status: "active" }),
    enabled: canReadEmployees,
    staleTime: 60_000,
  });
  const employees = employeesPage?.items ?? [];

  const { data: projects } = useQuery({
    queryKey: taskKeys.projects.list({ limit: 100 }),
    queryFn: () => taskProjectApi.listProjects({ limit: 100 }),
    enabled: canReadProjects,
    staleTime: 60_000,
  });

  const queryParams: Partial<ListTaskCoreQueryRequest> = {
    status: status || undefined,
    priority: priority || undefined,
    assigneeEmployeeId: assigneeEmployeeId || undefined,
    projectId: projectId || undefined,
    dueFrom: dueFrom ? new Date(dueFrom).toISOString() : undefined,
    dueTo: dueTo ? new Date(dueTo).toISOString() : undefined,
    overdue: overdueOnly || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: taskKeys.list(queryParams),
    queryFn: () => taskCoreApi.listTasks(queryParams),
    enabled: canView,
    staleTime: 30_000,
  });

  const resetToPage1 =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
    };

  const columns: ColumnDef<TaskCoreResponseDto>[] = [
    {
      accessorKey: "title",
      header: t("tasks.list.columns.title"),
      cell: ({ row }) => (
        <button
          type="button"
          className="font-medium text-foreground underline-offset-2 hover:underline"
          onClick={() =>
            void navigate({ to: "/tasks/$taskId", params: { taskId: row.original.id } })
          }
        >
          {row.original.title}
        </button>
      ),
    },
    {
      accessorKey: "projectName",
      header: t("tasks.list.columns.project"),
      cell: ({ row }) => <span className="text-sm">{row.original.projectName ?? "—"}</span>,
    },
    {
      accessorKey: "assigneeName",
      header: t("tasks.list.columns.assignee"),
      cell: ({ row }) => <span className="text-sm">{row.original.assigneeName ?? "—"}</span>,
    },
    {
      accessorKey: "priority",
      header: t("tasks.list.columns.priority"),
      cell: ({ row }) => <TaskPriorityBadge priority={row.original.priority} />,
    },
    {
      accessorKey: "status",
      header: t("tasks.list.columns.status"),
      cell: ({ row }) => <TaskStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "dueAt",
      header: t("tasks.list.columns.dueAt"),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="text-sm">
            {row.original.dueAt ? new Date(row.original.dueAt).toLocaleString("vi-VN") : "—"}
          </span>
          <TaskOverdueBadge isOverdue={row.original.isOverdue} />
        </div>
      ),
    },
    {
      accessorKey: "creatorName",
      header: t("tasks.list.columns.creator"),
      cell: ({ row }) => <span className="text-sm">{row.original.creatorName ?? "—"}</span>,
    },
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
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {t("tasks.list.filters.status")}
            </label>
            <Select
              value={status}
              onChange={(e) => resetToPage1(setStatus)(e.target.value as TaskCoreStatusDto | "")}
              className="w-40"
            >
              <option value="">{t("tasks.list.allStatuses")}</option>
              {TASK_CORE_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(`tasks.status.${s}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {t("tasks.list.filters.priority")}
            </label>
            <Select
              value={priority}
              onChange={(e) =>
                resetToPage1(setPriority)(e.target.value as TaskCorePriorityDto | "")
              }
              className="w-36"
            >
              <option value="">{t("tasks.list.allPriorities")}</option>
              {TASK_CORE_PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {t(`tasks.priority.${p}`)}
                </option>
              ))}
            </Select>
          </div>
          {canReadEmployees && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {t("tasks.list.filters.assignee")}
              </label>
              <Select
                value={assigneeEmployeeId}
                onChange={(e) => resetToPage1(setAssigneeEmployeeId)(e.target.value)}
                className="w-44"
              >
                <option value="">{t("tasks.list.filters.allAssignees")}</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.fullName}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {canReadProjects && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {t("tasks.list.filters.project")}
              </label>
              <Select
                value={projectId}
                onChange={(e) => resetToPage1(setProjectId)(e.target.value)}
                className="w-44"
              >
                <option value="">{t("tasks.list.filters.allProjects")}</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {t("tasks.list.filters.dueFrom")}
            </label>
            <Input
              type="date"
              value={dueFrom}
              onChange={(e) => resetToPage1(setDueFrom)(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("tasks.list.filters.dueTo")}</label>
            <Input
              type="date"
              value={dueTo}
              onChange={(e) => resetToPage1(setDueTo)(e.target.value)}
              className="w-40"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => resetToPage1(setOverdueOnly)(e.target.checked)}
            />
            {t("tasks.list.filters.overdue")}
          </label>
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("tasks.list.empty.title")}
            description={t("tasks.list.empty.description")}
          />
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
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("pagination.prev", { ns: "common" })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
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
