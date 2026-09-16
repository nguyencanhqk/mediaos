import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import type { PaymentBatchDto, PaymentBatchMethod, PaymentBatchStatus } from "@mediaos/contracts";
import {
  Button,
  ColumnPicker,
  DataTable,
  DataToolbar,
  EmptyState,
  PageHeader,
  Select,
  TableFooter,
  useColumnVisibility,
  type ColumnOption,
} from "@mediaos/ui";
import {
  PAYMENT_BATCH_METHODS,
  PAYMENT_BATCH_STATUSES,
  PAYROLL_ENGINE_PAIRS,
  PAYROLL_PAGE_SIZE,
} from "./constants";
import { formatPayrollMoney, PAYROLL_NUMERIC_CELL_CLASS } from "./payroll-format";
import { PaymentBatchStatusBadge } from "./components/StatusBadges";
import { PaymentBatchFormDialog } from "./components/PaymentBatchFormDialog";

interface Filters {
  status: PaymentBatchStatus | "";
  method: PaymentBatchMethod | "";
}
const EMPTY_FILTERS: Filters = { status: "", method: "" };

/**
 * PAY-SCREEN-013 (S15-PAYROLL-FE-3) — danh sách đợt chi trả (PAYROLL-API-066, `view:payment-batch`,
 * SENSITIVE — **CÓ audit lượt đọc**, SPEC-11 §18.1 B).
 *
 * Khuôn `BonusPenaltyListPage`: toolbar lọc + `ColumnPicker` + `DataTable` + `TableFooter`.
 *
 * ⚠️ `totalNet` là tiền ⇒ `.optional()` — mask fail-CLOSED (D10 của plan): trang RỖNG không có hàng để
 * đo ⇒ không được kết luận «được xem», cột vắng khỏi `⚙` chọn cột.
 */
export function PaymentBatchListPage({ onOpenBatch }: { onOpenBatch: (id: string) => void }) {
  const { t } = useTranslation("payroll");

  const canView = useCanExact(
    PAYROLL_ENGINE_PAIRS.batchList.action,
    PAYROLL_ENGINE_PAIRS.batchList.resourceType,
  );
  const canCreate = useCanExact(
    PAYROLL_ENGINE_PAIRS.batchCreate.action,
    PAYROLL_ENGINE_PAIRS.batchCreate.resourceType,
  );

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAYROLL_PAGE_SIZE);
  const [createOpen, setCreateOpen] = useState(false);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };
  const hasFilters = filters.status !== "" || filters.method !== "";

  const listParams = useMemo(
    () => ({
      ...(filters.status ? { status: [filters.status] } : {}),
      ...(filters.method ? { method: filters.method } : {}),
      page,
      per_page: pageSize,
    }),
    [filters, page, pageSize],
  );

  const listQuery = useQuery({
    queryKey: payrollKeys.paymentBatches.list(listParams),
    queryFn: () => payrollApi.listPaymentBatches(listParams),
    enabled: canView,
  });

  const rows = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination?.total;
  // Mask fail-CLOSED (D10): trang RỖNG hoặc mọi hàng vắng `totalNet` ⇒ cột tiền vắng khỏi ⚙ chọn cột.
  const moneyMasked = rows.length === 0 || rows.every((r) => r.totalNet === undefined);

  const columns = useMemo<ColumnDef<PaymentBatchDto>[]>(
    () => [
      { id: "code", accessorKey: "code", header: t("paymentBatches.columns.code") },
      {
        id: "periodMonth",
        accessorKey: "periodMonth",
        header: t("paymentBatches.columns.period"),
      },
      {
        id: "method",
        header: t("paymentBatches.columns.method"),
        cell: ({ row }) => t(`paymentBatchMethod.${row.original.method}`),
      },
      {
        id: "status",
        header: t("paymentBatches.columns.status"),
        cell: ({ row }) => <PaymentBatchStatusBadge status={row.original.status} />,
      },
      {
        id: "lineCount",
        header: t("paymentBatches.columns.lineCount"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>{row.original.lineCount}</span>
        ),
      },
      {
        id: "paidLineCount",
        header: t("paymentBatches.columns.paidLineCount"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>{row.original.paidLineCount}</span>
        ),
      },
      {
        id: "totalNet",
        header: t("paymentBatches.columns.totalNet"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollMoney(row.original.totalNet)}
          </span>
        ),
      },
      {
        id: "payDate",
        header: t("paymentBatches.columns.payDate"),
        cell: ({ row }) => row.original.payDate ?? "—",
      },
    ],
    [t],
  );

  const columnOptions = useMemo<ColumnOption[]>(
    () => [
      { id: "code", label: t("paymentBatches.columns.code"), locked: true },
      { id: "periodMonth", label: t("paymentBatches.columns.period") },
      { id: "method", label: t("paymentBatches.columns.method") },
      { id: "status", label: t("paymentBatches.columns.status") },
      { id: "lineCount", label: t("paymentBatches.columns.lineCount") },
      { id: "paidLineCount", label: t("paymentBatches.columns.paidLineCount") },
      ...(moneyMasked ? [] : [{ id: "totalNet", label: t("paymentBatches.columns.totalNet") }]),
      { id: "payDate", label: t("paymentBatches.columns.payDate") },
    ],
    [t, moneyMasked],
  );
  const columnPrefs = useColumnVisibility("payroll.paymentBatches", columnOptions);

  if (!canView) return <EmptyState title={t("paymentBatches.noPermission")} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("paymentBatches.title")}
        description={t("paymentBatches.description")}
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
                {t("paymentBatches.create")}
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
        <Select
          className="w-40"
          value={filters.status}
          onChange={(e) => setFilter("status", e.target.value as PaymentBatchStatus | "")}
          aria-label={t("paymentBatches.filterStatus")}
        >
          <option value="">{t("paymentBatches.filterAll")}</option>
          {PAYMENT_BATCH_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`paymentBatchStatus.${s}`)}
            </option>
          ))}
        </Select>
        <Select
          className="w-44"
          value={filters.method}
          onChange={(e) => setFilter("method", e.target.value as PaymentBatchMethod | "")}
          aria-label={t("paymentBatches.filterMethod")}
        >
          <option value="">{t("paymentBatches.filterAll")}</option>
          {PAYMENT_BATCH_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`paymentBatchMethod.${m}`)}
            </option>
          ))}
        </Select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setPage(1);
            }}
          >
            {t("paymentBatches.clearFilters")}
          </Button>
        )}
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
          pageSize={pageSize}
          columnVisibility={columnPrefs.visibility}
          pinFirstColumn
          onRowClick={(row) => onOpenBatch(row.id)}
          emptyState={
            <EmptyState
              title={hasFilters ? t("paymentBatches.emptyFiltered") : t("paymentBatches.empty")}
            />
          }
          footer={
            <TableFooter
              page={page}
              pageSize={pageSize}
              total={total}
              disabled={listQuery.isFetching}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          }
        />
      )}

      <PaymentBatchFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
