import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";
import { payrollApi, payrollKeys, useCan } from "@mediaos/web-core";
import type { PayrollPeriodDto, PayrollPeriodStatus } from "@mediaos/contracts";
import { Button, DataTable, EmptyState, Input, PageHeader, Select } from "@mediaos/ui";
import { PAYROLL_ENGINE_PAIRS, PAYROLL_PAGE_SIZE, PAYROLL_PERIOD_STATUSES } from "./constants";
import { PayrollPeriodStatusBadge } from "./components/StatusBadges";
import { PeriodFormDialog } from "./components/PeriodFormDialog";

interface Filters {
  periodMonth: string;
  status: PayrollPeriodStatus | "";
}
const EMPTY_FILTERS: Filters = { periodMonth: "", status: "" };

/** `periodMonth` phải đúng `YYYY-MM` mới gửi lên — mirror `periodMonthSchema`; gửi chuỗi dở dang
 * (`2026-`) là 400 VALIDATION-ERR-001 ngay khi người dùng đang gõ. */
const PERIOD_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * PAY-SCREEN-001 (S13-PAYROLL-FE-1) — danh sách kỳ lương.
 *
 * ⚠️ **MÀN NÀY KHÔNG HIỆN SỐ TIỀN NÀO, kể cả tổng.** Nó gác bằng `('view','payroll-period')` vốn
 * `is_sensitive = false` (SPEC-11 §18) và `payrollPeriodSchema` **không có khoá tiền** — tổng đi qua
 * `summary`, gác bằng cặp ĐỌC tiền `view-line`. Đừng "tiện thể" thêm cột tổng chi phí ở đây: dữ liệu
 * không có trong DTO, và nếu có thì màn này đang mở cho một cặp quyền rộng hơn hẳn.
 *
 * Chi tiết kỳ là ROUTE riêng (PAY-SCREEN-002) chứ không phải dialog — thanh hành động FSM + bảng lương
 * + hộp cảnh báo không nhét vừa một modal, và deep-link từ NOTI 020/021/022 trỏ thẳng vào đó.
 */
export function PayrollPeriodListPage({ onOpenPeriod }: { onOpenPeriod: (id: string) => void }) {
  const { t } = useTranslation("payroll");

  const canView = useCan(
    PAYROLL_ENGINE_PAIRS.periodList.action,
    PAYROLL_ENGINE_PAIRS.periodList.resourceType,
  );
  const canCreate = useCan(
    PAYROLL_ENGINE_PAIRS.periodCreate.action,
    PAYROLL_ENGINE_PAIRS.periodCreate.resourceType,
  );

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };
  const hasFilters = filters.periodMonth !== "" || filters.status !== "";

  const listParams = useMemo(
    () => ({
      ...(PERIOD_MONTH_RE.test(filters.periodMonth) ? { periodMonth: filters.periodMonth } : {}),
      ...(filters.status ? { status: [filters.status] } : {}),
      page,
      per_page: PAYROLL_PAGE_SIZE,
    }),
    [filters, page],
  );

  const listQuery = useQuery({
    queryKey: payrollKeys.periods.list(listParams),
    queryFn: () => payrollApi.listPeriods(listParams),
    enabled: canView,
  });

  const rows = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination?.total ?? rows.length;
  const lastPage = Math.max(1, Math.ceil(total / PAYROLL_PAGE_SIZE));

  const columns = useMemo<ColumnDef<PayrollPeriodDto>[]>(
    () => [
      { accessorKey: "periodMonth", header: t("periodList.columns.month") },
      {
        accessorKey: "status",
        header: t("periodList.columns.status"),
        cell: ({ row }) => <PayrollPeriodStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "payDate",
        header: t("periodList.columns.payDate"),
        cell: ({ row }) => row.original.payDate ?? "—",
      },
      {
        id: "attendancePeriod",
        header: t("periodList.columns.attendancePeriod"),
        cell: ({ row }) =>
          row.original.attendancePeriodId ? t("periodList.linked") : t("periodList.notLinked"),
      },
      {
        accessorKey: "note",
        header: t("periodList.columns.note"),
        cell: ({ row }) => row.original.note ?? "—",
      },
    ],
    [t],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("periodList.title")}
        description={t("periodList.description")}
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
                {t("periodList.create")}
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Input
            placeholder={t("periodList.monthPlaceholder")}
            value={filters.periodMonth}
            onChange={(e) => setFilter("periodMonth", e.target.value)}
            aria-label={t("periodList.filterMonth")}
          />
        </div>
        <Select
          className="w-52"
          value={filters.status}
          onChange={(e) => setFilter("status", e.target.value as PayrollPeriodStatus | "")}
          aria-label={t("periodList.filterStatus")}
        >
          <option value="">{t("periodList.filterAll")}</option>
          {PAYROLL_PERIOD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`periodStatus.${s}`)}
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
            {t("periodList.clearFilters")}
          </Button>
        )}
      </div>

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
        <>
          <DataTable
            columns={columns}
            data={rows}
            isLoading={listQuery.isLoading}
            pageSize={PAYROLL_PAGE_SIZE}
            onRowClick={(row) => onOpenPeriod(row.id)}
            emptyState={
              <EmptyState
                title={hasFilters ? t("periodList.emptyFiltered") : t("periodList.empty")}
                action={
                  canCreate && !hasFilters ? (
                    <Button onClick={() => setCreateOpen(true)}>
                      <Plus className="mr-2 size-4" />
                      {t("periodList.create")}
                    </Button>
                  ) : undefined
                }
              />
            }
          />

          {lastPage > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground">
                {page} / {lastPage}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || listQuery.isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ‹
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= lastPage || listQuery.isFetching}
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
              >
                ›
              </Button>
            </div>
          )}
        </>
      )}

      <PeriodFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          onOpenPeriod(id);
        }}
      />
    </div>
  );
}
