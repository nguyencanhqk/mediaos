import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import type { PayrollBudgetDto } from "@mediaos/contracts";
import {
  Button,
  ColumnPicker,
  DataTable,
  DataToolbar,
  EmptyState,
  Input,
  PageHeader,
  useColumnVisibility,
  type ColumnOption,
} from "@mediaos/ui";
import { PAYROLL_ENGINE_PAIRS } from "./constants";
import { formatPayrollMoney, PAYROLL_NUMERIC_CELL_CLASS } from "./payroll-format";
import { UnitSelector } from "./components/UnitSelector";
import { BudgetFormDialog } from "./components/BudgetFormDialog";

const CURRENT_YEAR = new Date().getUTCFullYear();

/**
 * PAY-SCREEN-014 (S15-PAYROLL-FE-3) — ngân sách lương theo năm × đơn vị (PAYROLL-API-073,
 * `view:payroll-budget`, SENSITIVE — **CÓ audit lượt đọc**).
 *
 * 🔴 **`listPayrollBudgets` trả MẢNG TRẦN, KHÔNG phân trang** (D12 của plan — 073 không nhận
 * `page`/`per_page`, một công ty hiếm khi > vài chục hàng/năm). KHÔNG có `TableFooter`, KHÔNG có state
 * trang — bọc bằng `apiFetchPaginated` ở web-core sẽ Zod-parse đỏ ngay, và ở đây gắn `TableFooter` vào
 * là bịa ra một luồng phân trang không hề tồn tại.
 *
 * ⚠️ `variance` LUÔN đọc từ server, KHÔNG tự trừ `plannedAmount − actualAmount` ở FE — `actualAmount`
 * server tính LÚC GỌI (không lưu), gom theo đơn vị HIỆN TẠI của chủ phiếu.
 */
export function PayrollBudgetListPage() {
  const { t } = useTranslation("payroll");

  const canView = useCanExact(
    PAYROLL_ENGINE_PAIRS.budgetList.action,
    PAYROLL_ENGINE_PAIRS.budgetList.resourceType,
  );
  const canCreate = useCanExact(
    PAYROLL_ENGINE_PAIRS.budgetCreate.action,
    PAYROLL_ENGINE_PAIRS.budgetCreate.resourceType,
  );
  const canUpdate = useCanExact(
    PAYROLL_ENGINE_PAIRS.budgetUpdate.action,
    PAYROLL_ENGINE_PAIRS.budgetUpdate.resourceType,
  );

  const [fiscalYear, setFiscalYear] = useState(CURRENT_YEAR);
  const [orgUnitId, setOrgUnitId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PayrollBudgetDto | null>(null);

  const listParams = useMemo(
    () => ({ fiscalYear, ...(orgUnitId ? { orgUnitId } : {}) }),
    [fiscalYear, orgUnitId],
  );

  const listQuery = useQuery({
    queryKey: payrollKeys.budgets.list(listParams),
    queryFn: () => payrollApi.listPayrollBudgets(listParams),
    enabled: canView,
  });

  const rows = listQuery.data ?? [];
  // Mask fail-CLOSED (D10, khuôn `payroll-money-column-mask.spec.tsx`): trang RỖNG hoặc mọi hàng vắng
  // `plannedAmount` ⇒ không kết luận "được xem" ⇒ ba cột tiền vắng khỏi ⚙ chọn cột.
  const moneyMasked = rows.length === 0 || rows.every((r) => r.plannedAmount === undefined);

  const columns = useMemo<ColumnDef<PayrollBudgetDto>[]>(
    () => [
      {
        id: "orgUnitName",
        header: t("budgets.columns.unit"),
        cell: ({ row }) => row.original.orgUnitName ?? t("budgets.companyWide"),
      },
      {
        id: "plannedAmount",
        header: t("budgets.columns.planned"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollMoney(row.original.plannedAmount)}
          </span>
        ),
      },
      {
        id: "actualAmount",
        header: t("budgets.columns.actual"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollMoney(row.original.actualAmount)}
          </span>
        ),
      },
      {
        id: "variance",
        header: t("budgets.columns.variance"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollMoney(row.original.variance)}
          </span>
        ),
      },
      {
        id: "note",
        header: t("budgets.columns.note"),
        cell: ({ row }) => row.original.note ?? "—",
      },
      {
        id: "edit",
        header: "",
        cell: ({ row }) =>
          canUpdate ? (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setEditTarget(row.original)}>
                {t("budgets.edit")}
              </Button>
            </div>
          ) : null,
      },
    ],
    [t, canUpdate],
  );

  const columnOptions = useMemo<ColumnOption[]>(
    () => [
      { id: "orgUnitName", label: t("budgets.columns.unit"), locked: true },
      ...(moneyMasked ? [] : [{ id: "plannedAmount", label: t("budgets.columns.planned") }]),
      ...(moneyMasked ? [] : [{ id: "actualAmount", label: t("budgets.columns.actual") }]),
      ...(moneyMasked ? [] : [{ id: "variance", label: t("budgets.columns.variance") }]),
      { id: "note", label: t("budgets.columns.note") },
    ],
    [t, moneyMasked],
  );
  const columnPrefs = useColumnVisibility("payroll.budgets", columnOptions);

  if (!canView) return <EmptyState title={t("budgets.noPermission")} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("budgets.title")}
        description={t("budgets.description")}
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
            {canCreate && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 size-4" />
                {t("budgets.create")}
              </Button>
            )}
          </div>
        }
      />

      <DataToolbar
        actions={
          <ColumnPicker
            options={columnOptions}
            hiddenIds={columnPrefs.hiddenIds}
            onToggle={columnPrefs.toggle}
            onReset={columnPrefs.reset}
            isDefault={columnPrefs.isDefault}
          />
        }
      >
        <div className="w-32">
          <Input
            type="number"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(Number(e.target.value) || CURRENT_YEAR)}
            aria-label={t("budgets.yearLabel")}
          />
        </div>
        <UnitSelector value={orgUnitId} onChange={setOrgUnitId} className="w-56" />
      </DataToolbar>

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
          columnVisibility={columnPrefs.visibility}
          pinFirstColumn
          pinLastColumn
          emptyState={<EmptyState title={t("budgets.empty")} />}
        />
      )}

      <BudgetFormDialog
        open={createOpen || editTarget !== null}
        onClose={() => {
          setCreateOpen(false);
          setEditTarget(null);
        }}
        budget={editTarget}
        defaultFiscalYear={fiscalYear}
        defaultOrgUnitId={orgUnitId || null}
      />
    </div>
  );
}
