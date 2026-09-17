import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import {
  salaryComponentKindEnum,
  type SalaryComponentDto,
  type SalaryComponentKind,
} from "@mediaos/contracts";
import {
  Button,
  DataTable,
  DataToolbar,
  EmptyState,
  PageHeader,
  Select,
  StatusPill,
  TableFooter,
} from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PAYROLL_ENGINE_PAIRS, PAYROLL_PAGE_SIZE } from "./constants";
import { formatPayrollMoney, PAYROLL_NUMERIC_CELL_CLASS } from "./payroll-format";
import { parsePayrollError, payrollErrorText } from "./payroll-errors";
import { useSalaryComponentsFullCatalog } from "./use-salary-components-catalog";
import { SalaryComponentFormDialog } from "./components/SalaryComponentFormDialog";

type BoolFilter = "" | "true" | "false";

/**
 * PAY-SCREEN-009 «Thành phần lương» (S15-PAYROLL-FE-2) — catalog (044) + tạo/sửa (045/047) + editor công
 * thức kiểm tại chỗ (048). Cả bốn cặp SENSITIVE ⇒ `useCanExact`.
 *
 * ⚠️ **Hàng hệ thống (D4):** huy hiệu «Hệ thống», nút Ngưng/Xoá **ẩn** (trigger 0570 ⇒ 409
 * `system-component-immutable`); nút Sửa vẫn có — chỉ mở tên + thứ tự.
 *
 * ⚠️ `fixedAmount` là cấu hình cấp công ty gác cùng cặp đọc — hiện nguyên, không phải lương per-người.
 */
export function SalaryComponentListPage() {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();

  const canView = useCanExact(
    PAYROLL_ENGINE_PAIRS.componentList.action,
    PAYROLL_ENGINE_PAIRS.componentList.resourceType,
  );
  const canManage = useCanExact(
    PAYROLL_ENGINE_PAIRS.componentUpdate.action,
    PAYROLL_ENGINE_PAIRS.componentUpdate.resourceType,
  );

  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<"" | SalaryComponentKind>("");
  const [isSystem, setIsSystem] = useState<BoolFilter>("");
  const [isActive, setIsActive] = useState<BoolFilter>("");
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SalaryComponentDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SalaryComponentDto | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const params = useMemo(
    () => ({
      page,
      per_page: PAYROLL_PAGE_SIZE,
      ...(kind ? { kind } : {}),
      ...(isSystem ? { isSystem: isSystem === "true" } : {}),
      ...(isActive ? { isActive: isActive === "true" } : {}),
    }),
    [page, kind, isSystem, isActive],
  );

  const listQuery = useQuery({
    queryKey: payrollKeys.catalog.components(params),
    queryFn: () => payrollApi.listSalaryComponents(params),
    enabled: canView,
  });
  const catalog = useSalaryComponentsFullCatalog(canView && canManage);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: payrollKeys.catalog.allOf() });

  const patchMutation = useMutation({
    mutationFn: (input: { id: string; body: { isActive: boolean } | { delete: true } }) =>
      payrollApi.updateSalaryComponent(input.id, input.body),
    onSuccess: () => {
      setDeleteTarget(null);
      setFeedback(null);
      invalidate();
    },
    onError: (e) => {
      setDeleteTarget(null);
      setFeedback(payrollErrorText(t, parsePayrollError(e)));
    },
  });

  const rows = listQuery.data?.data ?? [];

  const columns = useMemo<ColumnDef<SalaryComponentDto>[]>(
    () => [
      {
        id: "code",
        header: t("components.columns.code"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        id: "name",
        header: t("components.columns.name"),
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-2">
            <span>{row.original.name}</span>
            {row.original.isSystem && (
              <StatusPill tone="brand" hideDot label={t("components.systemBadge")} />
            )}
          </div>
        ),
      },
      {
        id: "kind",
        header: t("components.columns.kind"),
        cell: ({ row }) => t(`componentKind.${row.original.kind}`),
      },
      {
        id: "value",
        header: t("components.columns.value"),
        cell: ({ row }) => {
          const c = row.original;
          if (c.valueType === "formula") {
            return (
              <code className="line-clamp-2 max-w-md break-all font-mono text-xs">{c.formula}</code>
            );
          }
          if (c.valueType === "fixed") {
            return (
              <span className={PAYROLL_NUMERIC_CELL_CLASS}>
                {formatPayrollMoney(c.fixedAmount ?? undefined)}
              </span>
            );
          }
          return (
            <span className="text-muted-foreground">{t(`componentValueType.${c.valueType}`)}</span>
          );
        },
      },
      {
        id: "status",
        header: t("components.columns.status"),
        cell: ({ row }) => (
          <StatusPill
            tone={row.original.isActive ? "success" : "muted"}
            label={t(row.original.isActive ? "components.active" : "components.inactive")}
          />
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const c = row.original;
          if (!canManage) return null;
          return (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditTarget(c)}>
                {t("components.edit")}
              </Button>
              {!c.isSystem && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={patchMutation.isPending}
                    onClick={() =>
                      patchMutation.mutate({ id: c.id, body: { isActive: !c.isActive } })
                    }
                  >
                    {t(c.isActive ? "components.deactivate" : "components.activate")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(c)}>
                    {t("components.delete")}
                  </Button>
                </>
              )}
            </div>
          );
        },
      },
    ],
    [t, canManage, patchMutation],
  );

  if (!canView) return <EmptyState title={t("components.noPermission")} />;

  const boolOptions = (prefix: string) => (
    <>
      <option value="">{t(`${prefix}.all`)}</option>
      <option value="true">{t(`${prefix}.yes`)}</option>
      <option value="false">{t(`${prefix}.no`)}</option>
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("components.title")}
        description={t("components.description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void listQuery.refetch()}
              disabled={listQuery.isFetching}
            >
              <RefreshCw className="mr-2 size-4" />
              {t("states.retry")}
            </Button>
            {canManage && (
              <Button size="sm" onClick={() => setFormOpen(true)}>
                <Plus className="mr-2 size-4" />
                {t("components.create")}
              </Button>
            )}
          </div>
        }
      />

      <DataToolbar>
        <Select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as "" | SalaryComponentKind);
            setPage(1);
          }}
          className="w-48"
          aria-label={t("components.filterKind")}
        >
          <option value="">{t("components.allKinds")}</option>
          {salaryComponentKindEnum.options.map((k) => (
            <option key={k} value={k}>
              {t(`componentKind.${k}`)}
            </option>
          ))}
        </Select>
        <Select
          value={isSystem}
          onChange={(e) => {
            setIsSystem(e.target.value as BoolFilter);
            setPage(1);
          }}
          className="w-44"
          aria-label={t("components.filterSystem")}
        >
          {boolOptions("components.systemFilter")}
        </Select>
        <Select
          value={isActive}
          onChange={(e) => {
            setIsActive(e.target.value as BoolFilter);
            setPage(1);
          }}
          className="w-44"
          aria-label={t("components.filterActive")}
        >
          {boolOptions("components.activeFilter")}
        </Select>
      </DataToolbar>

      {feedback && (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger-muted/40 px-4 py-3 text-sm"
        >
          {feedback}
        </div>
      )}

      {listQuery.isError ? (
        <EmptyState
          title={t("states.error")}
          action={
            <Button variant="outline" onClick={() => void listQuery.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={listQuery.isLoading}
          pageSize={PAYROLL_PAGE_SIZE}
          pinFirstColumn
          pinLastColumn
          emptyState={<EmptyState title={t("components.empty")} />}
          footer={
            <TableFooter
              page={page}
              pageSize={PAYROLL_PAGE_SIZE}
              total={listQuery.data?.pagination?.total}
              disabled={listQuery.isFetching}
              onPageChange={setPage}
            />
          }
        />
      )}

      {canManage && (
        <SalaryComponentFormDialog
          open={formOpen || editTarget !== null}
          onClose={() => {
            setFormOpen(false);
            setEditTarget(null);
          }}
          component={editTarget}
          knownCodes={catalog.codes}
          canValidate={canManage}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("components.deleteTitle", { code: deleteTarget?.code ?? "" })}
        description={t("components.deleteDescription")}
        confirmLabel={t("components.delete")}
        cancelLabel={t("actions.cancel")}
        destructive
        busy={patchMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) patchMutation.mutate({ id: deleteTarget.id, body: { delete: true } });
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
