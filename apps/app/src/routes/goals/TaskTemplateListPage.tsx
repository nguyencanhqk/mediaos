import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList, ListChecks, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  ApiError,
  hrApi,
  hrKeys,
  taskTemplateApi,
  taskTemplateInvalidation,
  taskTemplateKeys,
  useCan,
} from "@mediaos/web-core";
import type { TaskTemplateResponseDto } from "@mediaos/contracts";
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Input,
  PageHeader,
  Select,
} from "@mediaos/ui";
import { TASK_TEMPLATE_MANAGE_PAIR } from "./constants";
import { TaskTemplateFormDialog } from "./components/TaskTemplateFormDialog";
import { TaskTemplateItemsDialog } from "./components/TaskTemplateItemsDialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

type ActiveFilter = "" | "true" | "false";

/**
 * GOAL-SCREEN-006 (S5-GOAL-TPL-1) — Danh mục việc mẫu: CRUD danh mục + việc mẫu (GOAL-API-012).
 *
 * MỘT cặp quyền cho cả màn: `manage:task-template` (SPEC-10 §11, seed mig 0527). Không có quyền ⇒ màn
 * này rỗng có giải thích (route đã gate `access:goal` nên người không thuộc GOAL không tới được đây).
 *
 * PHẠM VI DỮ LIỆU do SERVER quyết: `@Department` thấy danh mục của phòng mình + danh mục DÙNG CHUNG
 * (chỉ đọc); `@Company` thấy tất cả. FE KHÔNG đoán scope — bấm sửa danh mục dùng-chung khi không đủ
 * quyền sẽ nhận 403 kèm mã `GOAL-ERR-TPL-FORBIDDEN` và hiện nguyên văn thông điệp đó.
 */
export function TaskTemplateListPage() {
  const { t } = useTranslation("goals");
  const queryClient = useQueryClient();
  const canManage = useCan(
    TASK_TEMPLATE_MANAGE_PAIR.action,
    TASK_TEMPLATE_MANAGE_PAIR.resourceType,
  );

  const [searchInput, setSearchInput] = useState("");
  const q = useDebouncedValue(searchInput.trim(), 300);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("");
  const [departmentId, setDepartmentId] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TaskTemplateResponseDto | null>(null);
  const [itemsFor, setItemsFor] = useState<TaskTemplateResponseDto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TaskTemplateResponseDto | null>(null);

  const params = useMemo(
    () => ({
      ...(q ? { q } : {}),
      ...(activeFilter ? { isActive: activeFilter === "true" } : {}),
      ...(departmentId ? { departmentId } : {}),
    }),
    [q, activeFilter, departmentId],
  );

  const listQuery = useQuery({
    queryKey: taskTemplateKeys.list(params),
    queryFn: () => taskTemplateApi.listTemplates(params),
    enabled: canManage,
    staleTime: 30_000,
  });

  const { data: departments } = useQuery({
    queryKey: hrKeys.departments.list(),
    queryFn: () => hrApi.listDepartments(),
    enabled: canManage,
    staleTime: 300_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => taskTemplateApi.deleteTemplate(id),
    onSuccess: async () => {
      await Promise.all(
        taskTemplateInvalidation
          .remove()
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      setConfirmDelete(null);
    },
  });

  const columns = useMemo<ColumnDef<TaskTemplateResponseDto>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("templates.columns.name"),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-foreground">{row.original.name}</span>
            {row.original.description && (
              <span className="line-clamp-1 text-xs text-muted-foreground">
                {row.original.description}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "department",
        header: t("templates.columns.department"),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.departmentName ?? t("templates.sharedLabel")}
          </span>
        ),
      },
      {
        accessorKey: "itemCount",
        header: t("templates.columns.itemCount"),
        cell: ({ row }) => <span className="text-sm">{row.original.itemCount}</span>,
      },
      {
        accessorKey: "isActive",
        header: t("templates.columns.status"),
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? "default" : "secondary"}>
            {row.original.isActive ? t("templates.active") : t("templates.inactive")}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("templates.actions.items")}
              data-testid={`task-template-items-${row.original.id}`}
              onClick={() => setItemsFor(row.original)}
            >
              <ListChecks className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("templates.actions.edit")}
              onClick={() => {
                setEditing(row.original);
                setFormOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("templates.actions.delete")}
              onClick={() => setConfirmDelete(row.original)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ),
      },
    ],
    [t],
  );

  if (!canManage) {
    return (
      <div className="p-6">
        <EmptyState
          icon={ClipboardList}
          title={t("templates.forbidden.title")}
          description={t("templates.forbidden.description")}
        />
      </div>
    );
  }

  const deleteError =
    deleteMutation.error instanceof ApiError && deleteMutation.error.message
      ? deleteMutation.error.message
      : deleteMutation.isError
        ? t("templates.deleteError")
        : null;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        title={t("templates.title")}
        description={t("templates.description")}
        icon={ClipboardList}
        actions={
          <Button
            size="sm"
            data-testid="task-template-create"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("templates.create")}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <FilterField label={t("templates.filters.search")}>
            <Input
              type="search"
              data-testid="task-template-search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("templates.filters.searchPlaceholder")}
            />
          </FilterField>
          <FilterField label={t("templates.filters.department")}>
            <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">{t("templates.filters.allDepartments")}</option>
              {(departments ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label={t("templates.filters.status")}>
            <Select
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}
            >
              <option value="">{t("templates.filters.allStatuses")}</option>
              <option value="true">{t("templates.active")}</option>
              <option value="false">{t("templates.inactive")}</option>
            </Select>
          </FilterField>
        </div>
      </PageHeader>

      {listQuery.isError ? (
        <EmptyState
          icon={ClipboardList}
          title={t("templates.error.title")}
          description={t("templates.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void listQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={listQuery.data ?? []}
          isLoading={listQuery.isLoading}
          pageSize={20}
          emptyState={
            <EmptyState
              icon={ClipboardList}
              title={t("templates.empty.title")}
              description={t("templates.empty.description")}
            />
          }
        />
      )}

      {formOpen && (
        <TaskTemplateFormDialog
          {...(editing ? { template: editing } : {})}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      )}
      {itemsFor && (
        <TaskTemplateItemsDialog template={itemsFor} onClose={() => setItemsFor(null)} />
      )}

      <Dialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={t("templates.actions.delete")}
        description={t("templates.deleteConfirm", { name: confirmDelete?.name ?? "" })}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              data-testid="task-template-delete-confirm"
              disabled={deleteMutation.isPending}
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
            >
              {t("templates.actions.delete")}
            </Button>
          </div>
        }
      >
        {deleteError && (
          <p className="text-sm text-destructive" role="alert">
            {deleteError}
          </p>
        )}
      </Dialog>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-40 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
