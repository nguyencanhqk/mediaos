import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";
import { formatNumber, payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import type { StatutoryRateDto } from "@mediaos/contracts";
import { Button, DataTable, EmptyState, PageHeader, StatusPill, TableFooter } from "@mediaos/ui";
import { PAYROLL_ENGINE_PAIRS, PAYROLL_PAGE_SIZE } from "./constants";
import { formatPayrollMoney, PAYROLL_NUMERIC_CELL_CLASS } from "./payroll-format";
import { StatutoryRateFormDialog, type RateFormMode } from "./components/StatutoryRateFormDialog";

const pct = (v: number) => `${formatNumber(v, { maximumFractionDigits: 2 })}%`;

/**
 * PAY-SCREEN-011 «Tỉ lệ luật định» (`/payroll/settings/statutory-rates`) — bảng phiên bản theo
 * `effectiveFrom` giảm dần (055) + tạo (056) / sửa (058) / sao chép thành bản mới.
 *
 * - Băng cảnh báo §3.11 LUÔN hiện: hệ thống lưu và áp số này, KHÔNG khẳng định đúng luật.
 * - `inUse` (đã có kỳ ≥ Calculated dùng) ⇒ nút «Sửa» ẨN, chỉ còn «Tạo bản mới từ bản này» (D14) —
 *   hiện nút rồi để người dùng ăn 409 `rate-in-use` là đúng lớp lỗi SPEC-11 §14 cấm.
 * - `manage:statutory-rate` KHÔNG cấp cho `payroll-officer` (permission-matrix §9g.2) ⇒ officer thấy bảng,
 *   không thấy nút ghi nào.
 */
export function StatutoryRateListPage() {
  const { t } = useTranslation("payroll");

  const canView = useCanExact(
    PAYROLL_ENGINE_PAIRS.statutoryRateList.action,
    PAYROLL_ENGINE_PAIRS.statutoryRateList.resourceType,
  );
  const canManage = useCanExact(
    PAYROLL_ENGINE_PAIRS.statutoryRateCreate.action,
    PAYROLL_ENGINE_PAIRS.statutoryRateCreate.resourceType,
  );

  const [page, setPage] = useState(1);
  // `mode` giữ trong state ⇒ tham chiếu ỔN ĐỊNH (dialog reset form theo `mode`, object mới mỗi render là
  // xoá sạch thứ người dùng đang gõ).
  const [mode, setMode] = useState<RateFormMode | null>(null);

  const params = useMemo(() => ({ page, per_page: PAYROLL_PAGE_SIZE }), [page]);
  const listQuery = useQuery({
    queryKey: payrollKeys.catalog.statutoryRates(params),
    queryFn: () => payrollApi.listStatutoryRates(params),
    enabled: canView,
  });

  const columns = useMemo<ColumnDef<StatutoryRateDto>[]>(
    () => [
      {
        id: "effectiveFrom",
        header: t("statutoryRates.columns.effectiveFrom"),
        cell: ({ row }) => <span className="tabular-nums">{row.original.effectiveFrom}</span>,
      },
      {
        id: "employee",
        header: t("statutoryRates.columns.employee"),
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="tabular-nums">
              {pct(r.siEmployeePct)} · {pct(r.hiEmployeePct)} · {pct(r.uiEmployeePct)}
            </span>
          );
        },
      },
      {
        id: "employer",
        header: t("statutoryRates.columns.employer"),
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="tabular-nums">
              {pct(r.siEmployerPct)} · {pct(r.hiEmployerPct)} · {pct(r.uiEmployerPct)}
            </span>
          );
        },
      },
      {
        id: "union",
        header: t("statutoryRates.columns.union"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {pct(row.original.unionEmployerPct)} · {pct(row.original.unionEmployeePct)}
          </span>
        ),
      },
      {
        id: "siCap",
        header: t("rateFields.siCap"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollMoney(row.original.siCap)}
          </span>
        ),
      },
      {
        id: "baseWage",
        header: t("rateFields.baseWage"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollMoney(row.original.baseWage)}
          </span>
        ),
      },
      {
        id: "deductions",
        header: t("statutoryRates.columns.deductions"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollMoney(row.original.personalDeduction)} /{" "}
            {formatPayrollMoney(row.original.dependentDeduction)}
          </span>
        ),
      },
      {
        id: "inUse",
        header: t("statutoryRates.columns.inUse"),
        cell: ({ row }) => (
          <StatusPill
            tone={row.original.inUse ? "brand" : "muted"}
            label={t(row.original.inUse ? "statutoryRates.inUse" : "statutoryRates.notInUse")}
          />
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          if (!canManage) return null;
          const r = row.original;
          return (
            <div className="flex justify-end gap-2">
              {!r.inUse && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMode({ kind: "edit", rate: r })}
                >
                  {t("statutoryRates.edit")}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setMode({ kind: "copy", rate: r })}>
                {t("statutoryRates.copy")}
              </Button>
            </div>
          );
        },
      },
    ],
    [t, canManage],
  );

  if (!canView) return <EmptyState title={t("statutoryRates.noPermission")} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("statutoryRates.title")}
        description={t("statutoryRates.description")}
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
              <Button size="sm" onClick={() => setMode({ kind: "create" })}>
                <Plus className="mr-2 size-4" />
                {t("statutoryRates.create")}
              </Button>
            )}
          </div>
        }
      />

      <div
        role="note"
        className="rounded-md border border-warning/40 bg-warning-muted/40 px-4 py-3 text-sm"
      >
        {t("statutoryRates.disclaimer")}
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
        <DataTable
          columns={columns}
          data={listQuery.data?.data ?? []}
          isLoading={listQuery.isLoading}
          pageSize={PAYROLL_PAGE_SIZE}
          pinFirstColumn
          pinLastColumn
          emptyState={<EmptyState title={t("statutoryRates.empty")} />}
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

      {canManage && mode !== null && (
        <StatutoryRateFormDialog open onClose={() => setMode(null)} mode={mode} />
      )}
    </div>
  );
}
