import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { KanbanSquare, RefreshCw, Trash2, Plus } from "lucide-react";
import {
  taskProjectApi,
  taskKeys,
  taskProjectInvalidation,
  useCan,
  PermissionGate,
} from "@mediaos/web-core";
import {
  PageHeader,
  DataTable,
  EmptyState,
  Button,
  Input,
  Select,
  Badge,
  Dialog,
} from "@mediaos/ui";
import type { TaskProjectListItemDto, TaskProjectStatusDto } from "@mediaos/contracts";
import { TASK_ENGINE_PAIRS } from "./constants";
import { ProjectFormDrawer } from "./ProjectFormDrawer";

/**
 * ProjectListPage — S4-FE-TASK-1 (SPEC-06 §13.1, TASK-SCREEN-001).
 *
 * Cổng đọc = TASK.PROJECT.VIEW (route-level, ProtectedRoute) + useCan lặp lại ở component (deny-path khi
 * mount trực tiếp trong test/link ngoài route guard). Create/Edit/Delete gate qua PermissionGate/useCan
 * (TASK.PROJECT.CREATE/UPDATE/DELETE) — KHÔNG hard-code role. Server là cổng thật (owner-check khi scope
 * < Company cho delete — 403 nếu FE cho hiện nút nhưng actor không phải owner @Team).
 *
 * List /projects trả MẢNG TRẦN không kèm `total` (xem projects.service.ts listProjects) → phân trang FE
 * dùng offset "tải thêm" (heuristic: còn trang kế khi số dòng trả về == PAGE_SIZE).
 */
const PAGE_SIZE = 20;

const STATUS_OPTIONS: readonly TaskProjectStatusDto[] = [
  "Planning",
  "Active",
  "On Hold",
  "Completed",
  "Cancelled",
  "Archived",
];

function ProjectStatusBadge({ status }: { status: string | null }) {
  const { t } = useTranslation("tasks");
  if (!status) return <span className="text-sm text-muted-foreground">—</span>;
  const variant =
    status === "Active" ? "default" : status === "Cancelled" ? "destructive" : "secondary";
  return <Badge variant={variant}>{t(`projects.status.${status}`)}</Badge>;
}

function DeleteProjectDialog({
  project,
  onClose,
}: {
  project: TaskProjectListItemDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => taskProjectApi.deleteProject(project.id),
    onSuccess: async () => {
      await Promise.all(
        taskProjectInvalidation
          .list()
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onClose();
    },
  });
  const noop = () => {};

  return (
    <Dialog
      open
      onClose={mutation.isPending ? noop : onClose}
      title={t("projects.detail.deleteDialog.title")}
      description={t("projects.detail.deleteDialog.description", { name: project.name })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("projects.detail.deleteDialog.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {t("projects.detail.deleteDialog.confirm")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("projects.list.error.description")}
        </p>
      )}
    </Dialog>
  );
}

export function ProjectListPage() {
  const { t } = useTranslation("tasks");
  const navigate = useNavigate();
  const canView = useCan(
    TASK_ENGINE_PAIRS.READ_PROJECT.action,
    TASK_ENGINE_PAIRS.READ_PROJECT.resourceType,
  );
  const canDelete = useCan(
    TASK_ENGINE_PAIRS.DELETE_PROJECT.action,
    TASK_ENGINE_PAIRS.DELETE_PROJECT.resourceType,
  );

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TaskProjectStatusDto | "">("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<TaskProjectListItemDto | null>(null);

  const queryParams = {
    search: search || undefined,
    status: status || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: taskKeys.projects.list(queryParams),
    queryFn: () => taskProjectApi.listProjects(queryParams),
    enabled: canView,
    staleTime: 30_000,
  });

  const columns: ColumnDef<TaskProjectListItemDto>[] = [
    {
      accessorKey: "code",
      header: t("projects.list.columns.code"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.code ?? "—"}</span>
      ),
    },
    {
      accessorKey: "name",
      header: t("projects.list.columns.name"),
      cell: ({ row }) => (
        <button
          type="button"
          className="font-medium text-foreground underline-offset-2 hover:underline"
          onClick={() =>
            void navigate({
              to: "/tasks/projects/$projectId",
              params: { projectId: row.original.id },
            })
          }
        >
          {row.original.name}
        </button>
      ),
    },
    {
      accessorKey: "ownerName",
      header: t("projects.list.columns.owner"),
      cell: ({ row }) => <span className="text-sm">{row.original.ownerName ?? "—"}</span>,
    },
    {
      accessorKey: "departmentName",
      header: t("projects.list.columns.department"),
      cell: ({ row }) => <span className="text-sm">{row.original.departmentName ?? "—"}</span>,
    },
    {
      accessorKey: "memberCount",
      header: t("projects.list.columns.members"),
      cell: ({ row }) => <span className="text-sm">{row.original.memberCount}</span>,
    },
    {
      accessorKey: "priority",
      header: t("projects.list.columns.priority"),
      cell: ({ row }) =>
        row.original.priority ? (
          <span className="text-sm">{t(`projects.priority.${row.original.priority}`)}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: "status",
      header: t("projects.list.columns.status"),
      cell: ({ row }) => <ProjectStatusBadge status={row.original.status} />,
    },
    ...(canDelete
      ? [
          {
            id: "actions",
            header: () => <span className="sr-only">{t("projects.list.columns.actions")}</span>,
            cell: ({ row }: { row: { original: TaskProjectListItemDto } }) => (
              <div className="flex items-center justify-end gap-1">
                <PermissionGate
                  action={TASK_ENGINE_PAIRS.DELETE_PROJECT.action}
                  resourceType={TASK_ENGINE_PAIRS.DELETE_PROJECT.resourceType}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("projects.detail.actions.delete")}
                    onClick={() => setDeleteItem(row.original)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </PermissionGate>
              </div>
            ),
          } satisfies ColumnDef<TaskProjectListItemDto>,
        ]
      : []),
  ];

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("projects.list.forbidden.title")}
          description={t("projects.list.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("projects.list.error.title")}
          description={t("projects.list.error.description")}
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
        title={t("projects.list.title")}
        description={t("projects.list.description")}
        icon={KanbanSquare}
        actions={
          <PermissionGate
            action={TASK_ENGINE_PAIRS.CREATE_PROJECT.action}
            resourceType={TASK_ENGINE_PAIRS.CREATE_PROJECT.resourceType}
          >
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("projects.list.addButton")}
            </Button>
          </PermissionGate>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder={t("projects.list.searchPlaceholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-64"
          />
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as TaskProjectStatusDto | "");
              setPage(1);
            }}
            className="w-44"
          >
            <option value="">{t("projects.list.allStatuses")}</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`projects.status.${s}`)}
              </option>
            ))}
          </Select>
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("projects.list.empty.title")}
            description={t("projects.list.empty.description")}
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
        <ProjectFormDrawer
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSuccess={() => setCreateOpen(false)}
        />
      )}
      {deleteItem && (
        <DeleteProjectDialog project={deleteItem} onClose={() => setDeleteItem(null)} />
      )}
    </div>
  );
}
