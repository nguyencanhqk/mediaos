import { useRef, useState } from "react";
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { RefreshCw, Pencil, Trash2, Plus, type LucideIcon } from "lucide-react";
import type { ZodType } from "zod";
import { useCan, PermissionGate, ApiError } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Dialog, Badge } from "@mediaos/ui";
import { useDirtyFormGuard } from "@/hooks/use-dirty-form-guard";
import "./master-data-i18n";

// ---------------------------------------------------------------------------
// Engine pair (action:resourceType) — khớp seed thật (PERMISSION_CODE_TO_PAIR).
// ---------------------------------------------------------------------------
export interface EnginePair {
  action: string;
  resourceType: string;
}

/** Bộ 4 cặp quyền của 1 màn. Với master-data (job-levels/contract-types) cả 4 = manage:master-data. */
export interface MasterDataPermissions {
  read: EnginePair;
  create: EnginePair;
  update: EnginePair;
  remove: EnginePair;
}

/** Cấu hình 1 màn CRUD dữ liệu gốc. TItem = DTO đọc, TValues = giá trị form. */
export interface MasterDataScreenConfig<TItem, TValues extends FieldValues> {
  /** Prefix i18n dưới hr.masterData (vd "departments"). */
  tKey: string;
  icon: LucideIcon;
  permissions: MasterDataPermissions;

  // ── Dữ liệu ────────────────────────────────────────────────────────────────
  listQueryKey: readonly unknown[];
  fetchList: () => Promise<TItem[]>;
  /** Danh sách query-key prefix cần invalidate sau mutation. */
  invalidationKeys: readonly (readonly unknown[])[];
  columns: ColumnDef<TItem>[];
  getId: (item: TItem) => string;
  /** Nhãn hiển thị trong hộp thoại xác nhận xoá. */
  getLabel: (item: TItem) => string;

  // ── Form ─────────────────────────────────────────────────────────────────────
  schema: ZodType<TValues>;
  emptyValues: TValues;
  toFormValues: (item: TItem) => TValues;
  toCreate: (values: TValues) => unknown;
  toUpdate: (values: TValues) => unknown;
  renderFields: (form: UseFormReturn<TValues>) => React.ReactNode;
  /** Trường bị set lỗi khi server trả 409/422 unique (mặc định "code"). */
  conflictField?: Path<TValues>;

  // ── API (soft-delete server-side; company_id do server resolve) ───────────────
  create: (payload: never) => Promise<TItem>;
  update: (id: string, payload: never) => Promise<TItem>;
  remove: (id: string) => Promise<void>;
}

type TItemBase = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Map lỗi submit → thông điệp người-đọc (i18n key). KHÔNG rò chi tiết nội bộ.
// ---------------------------------------------------------------------------
function submitErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "masterData.common.submitErrors.conflict";
    if (err.status === 403) return "masterData.common.submitErrors.forbidden";
    if (err.status === 422 || err.status === 400)
      return "masterData.common.submitErrors.validation";
    if (err.status >= 500) return "masterData.common.submitErrors.server";
  }
  return "masterData.common.submitErrors.generic";
}

/** 409/422 với ràng buộc unique → set lỗi field (thường là "code"). */
function isConflict(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 409 || err.status === 422);
}

// ---------------------------------------------------------------------------
// Status badge dùng chung
// ---------------------------------------------------------------------------
export function MasterDataStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("hr");
  const active = status === "active";
  return (
    <Badge variant={active ? "default" : "secondary"}>
      {active ? t("masterData.common.status.active") : t("masterData.common.status.inactive")}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Form dialog (create + edit)
// ---------------------------------------------------------------------------
interface FormDialogState<TItem> {
  mode: "create" | "edit";
  item?: TItem;
}

function MasterDataFormDialog<TItem extends TItemBase, TValues extends FieldValues>({
  config,
  state,
  onClose,
}: {
  config: MasterDataScreenConfig<TItem, TValues>;
  state: FormDialogState<TItem>;
  onClose: () => void;
}) {
  const { t } = useTranslation("hr");
  const queryClient = useQueryClient();
  const isEdit = state.mode === "edit";
  const entity = t(`masterData.${config.tKey}.entity`);

  const form = useForm<TValues>({
    resolver: zodResolver(config.schema),
    mode: "onSubmit",
    defaultValues: (isEdit && state.item
      ? config.toFormValues(state.item)
      : config.emptyValues) as DefaultValues<TValues>,
  });

  const {
    handleSubmit,
    setError,
    formState: { isDirty, isSubmitting },
  } = form;

  useDirtyFormGuard({ isDirty });

  const mutation = useMutation({
    mutationFn: async (values: TValues): Promise<TItem> => {
      if (isEdit && state.item) {
        return config.update(config.getId(state.item), config.toUpdate(values) as never);
      }
      return config.create(config.toCreate(values) as never);
    },
    onSuccess: async () => {
      await Promise.all(
        config.invalidationKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onClose();
    },
    onError: (err) => {
      if (isConflict(err)) {
        setError(config.conflictField ?? ("code" as Path<TValues>), {
          message: "masterData.common.submitErrors.conflict",
        });
      }
    },
  });

  const busy = isSubmitting || mutation.isPending;
  const noop = () => {};

  return (
    <Dialog
      open
      onClose={busy ? noop : onClose}
      title={t(isEdit ? "masterData.common.editTitle" : "masterData.common.createTitle", {
        entity,
      })}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("masterData.common.cancel")}
          </Button>
          <Button type="submit" form="master-data-form" disabled={busy}>
            {busy
              ? t("masterData.common.saving")
              : isEdit
                ? t("masterData.common.save")
                : t("masterData.common.create")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t(submitErrorKey(mutation.error))}
        </p>
      )}
      <form
        id="master-data-form"
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
      >
        {config.renderFields(form)}
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete confirm dialog
// ---------------------------------------------------------------------------
function DeleteConfirmDialog<TItem extends TItemBase, TValues extends FieldValues>({
  config,
  item,
  onClose,
}: {
  config: MasterDataScreenConfig<TItem, TValues>;
  item: TItem;
  onClose: () => void;
}) {
  const { t } = useTranslation("hr");
  const queryClient = useQueryClient();
  const entity = t(`masterData.${config.tKey}.entity`);
  const noop = () => {};

  const mutation = useMutation({
    mutationFn: () => config.remove(config.getId(item)),
    onSuccess: async () => {
      await Promise.all(
        config.invalidationKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={mutation.isPending ? noop : onClose}
      title={t("masterData.common.deleteTitle", { entity })}
      description={t("masterData.common.deleteDescription", { name: config.getLabel(item) })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("masterData.common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? t("masterData.common.deleting")
              : t("masterData.common.confirmDelete")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("masterData.common.submitErrors.deleteFailed")}
        </p>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Cột hành động (sửa/xoá) — nút ẩn qua PermissionGate theo cặp update/remove.
// ---------------------------------------------------------------------------
function buildActionsColumn<TItem extends TItemBase, TValues extends FieldValues>(
  config: MasterDataScreenConfig<TItem, TValues>,
  t: ReturnType<typeof useTranslation<"hr">>["t"],
  onEdit: (item: TItem) => void,
  onDelete: (item: TItem) => void,
): ColumnDef<TItem> {
  const { update, remove } = config.permissions;
  return {
    id: "actions",
    header: () => <span className="sr-only">{t("masterData.common.columns.actions")}</span>,
    cell: ({ row }) => (
      <div className="flex items-center justify-end gap-1">
        <PermissionGate action={update.action} resourceType={update.resourceType}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("masterData.common.edit")}
            onClick={() => onEdit(row.original)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </PermissionGate>
        <PermissionGate action={remove.action} resourceType={remove.resourceType}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("masterData.common.delete")}
            onClick={() => onDelete(row.original)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </PermissionGate>
      </div>
    ),
  };
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export function MasterDataCrudScreen<TItem extends TItemBase, TValues extends FieldValues>({
  config,
}: {
  config: MasterDataScreenConfig<TItem, TValues>;
}) {
  const { t } = useTranslation("hr");
  const { read, update, create, remove } = config.permissions;
  const canRead = useCan(read.action, read.resourceType);
  const canUpdate = useCan(update.action, update.resourceType);
  const canDelete = useCan(remove.action, remove.resourceType);

  const [formState, setFormState] = useState<FormDialogState<TItem> | null>(null);
  const [deleteItem, setDeleteItem] = useState<TItem | null>(null);

  const query = useQuery({
    queryKey: config.listQueryKey,
    queryFn: config.fetchList,
    enabled: canRead,
    staleTime: 30_000,
  });

  const prevItemsRef = useRef<TItem[]>([]);

  // ── Forbidden (direct URL / thiếu cặp đọc) ───────────────────────────────────
  if (!canRead) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("masterData.common.forbidden.title")}
          description={t("masterData.common.forbidden.description")}
        />
      </div>
    );
  }

  const title = t(`masterData.${config.tKey}.title`);
  const description = t(`masterData.${config.tKey}.description`);
  const addButton = t(`masterData.${config.tKey}.addButton`);

  // ── Error ────────────────────────────────────────────────────────────────────
  if (query.isError) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={title} description={description} icon={config.icon} />
        <EmptyState
          title={t("masterData.common.error.title")}
          description={t("masterData.common.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("masterData.common.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  // Cột hành động chỉ thêm khi user có quyền sửa hoặc xoá.
  const columns =
    canUpdate || canDelete
      ? [
          ...config.columns,
          buildActionsColumn(
            config,
            t,
            (item) => setFormState({ mode: "edit", item }),
            (item) => setDeleteItem(item),
          ),
        ]
      : config.columns;

  const items = query.data ?? prevItemsRef.current;
  if (query.data) prevItemsRef.current = query.data;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={title}
        description={description}
        icon={config.icon}
        actions={
          <PermissionGate action={create.action} resourceType={create.resourceType}>
            <Button size="sm" onClick={() => setFormState({ mode: "create" })}>
              <Plus className="mr-2 h-4 w-4" />
              {addButton}
            </Button>
          </PermissionGate>
        }
      />

      <DataTable
        columns={columns}
        data={items}
        isLoading={query.isLoading}
        emptyState={
          <EmptyState
            title={t("masterData.common.empty.title")}
            description={t("masterData.common.empty.description")}
          />
        }
        pageSize={20}
      />

      {formState && (
        <MasterDataFormDialog
          config={config}
          state={formState}
          onClose={() => setFormState(null)}
        />
      )}
      {deleteItem && (
        <DeleteConfirmDialog
          config={config}
          item={deleteItem}
          onClose={() => setDeleteItem(null)}
        />
      )}
    </div>
  );
}
