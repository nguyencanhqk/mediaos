import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { payrollApi, payrollKeys, useCan, useCanExact } from "@mediaos/web-core";
import {
  PAYROLL_PICKER_LIMIT_MAX,
  type PayrollPeriodDto,
  type PayrollTimesheetRowDto,
} from "@mediaos/contracts";
import { Button, DataTable, EmptyState, StatusPill, TableFooter } from "@mediaos/ui";
import { PAYROLL_ENGINE_PAIRS, PAYROLL_PAGE_SIZE } from "../constants";
import {
  formatPayrollDays,
  formatPayrollMinutes,
  PAYROLL_NUMERIC_CELL_CLASS,
} from "../payroll-format";
import { displayUserRef, type PayrollPeopleLookup } from "../use-payroll-people";

/**
 * PAY-SCREEN-008 «Bảng công kỳ» (S15-PAYROLL-FE-1) — TAB của chi tiết kỳ, có route riêng
 * `/payroll/periods/:id/timesheet` để deep-link (UI-07 §21.8 v1.1a: không lên sidebar vì bám một kỳ).
 *
 * Đọc **PAYROLL-API-043** (`GET /payroll-periods/:id/timesheet`) — KHÔNG phải `/me/attendance-summary`
 * của ME. Cặp gác `('view-line','payroll-period')` (SENSITIVE ⇒ `useCanExact`) dù DTO **không có số
 * tiền nào** — chỉ số NGÀY và số PHÚT; băng nhắc điều đó ở đầu bảng.
 *
 * ── TRẠNG THÁI KHOÁ KỲ CÔNG ──────────────────────────────────────────────────────────────────────
 * DTO kỳ chỉ có `attendancePeriodId`; 043 không chở trạng thái kỳ công. Đường DUY NHẤT `payroll-officer`
 * đọc được kỳ công là picker 035 (`manage:payroll-period`, không nhạy cảm) ⇒ đối chiếu theo id. Thiếu
 * cặp / không tìm thấy trong trần 100 ⇒ pill «không rõ» — nói thẳng, không đoán `open`.
 */
export function PeriodTimesheetTab({
  period,
  people,
}: {
  period: PayrollPeriodDto;
  people: PayrollPeopleLookup;
}) {
  const { t } = useTranslation("payroll");
  const canView = useCanExact(
    PAYROLL_ENGINE_PAIRS.periodTimesheet.action,
    PAYROLL_ENGINE_PAIRS.periodTimesheet.resourceType,
  );
  const canReadAttendancePeriods = useCan(
    PAYROLL_ENGINE_PAIRS.pickerAttendancePeriods.action,
    PAYROLL_ENGINE_PAIRS.pickerAttendancePeriods.resourceType,
  );

  const [page, setPage] = useState(1);
  const params = useMemo(() => ({ page, per_page: PAYROLL_PAGE_SIZE }), [page]);

  const timesheetQuery = useQuery({
    queryKey: payrollKeys.periods.timesheet(period.id, params),
    queryFn: () => payrollApi.getPeriodTimesheet(period.id, params),
    enabled: canView,
  });

  const attParams = { limit: PAYROLL_PICKER_LIMIT_MAX };
  const attQuery = useQuery({
    queryKey: payrollKeys.pickers.attendancePeriods(attParams),
    queryFn: () => payrollApi.pickerAttendancePeriods(attParams),
    enabled: canView && canReadAttendancePeriods && period.attendancePeriodId !== null,
    staleTime: 60 * 1000,
  });

  const lock = useMemo(() => {
    if (period.attendancePeriodId === null) return "unlinked" as const;
    const found = attQuery.data?.find((p) => p.id === period.attendancePeriodId);
    return found ? found.status : ("unknown" as const);
  }, [period.attendancePeriodId, attQuery.data]);

  const rows = timesheetQuery.data?.data ?? [];
  const total = timesheetQuery.data?.pagination?.total;

  const columns = useMemo<ColumnDef<PayrollTimesheetRowDto>[]>(
    () => [
      {
        id: "employee",
        header: t("timesheet.columns.employee"),
        cell: ({ row }) => {
          const r = row.original;
          const name = r.fullName ?? r.employeeCode ?? displayUserRef(r.userId, people);
          return (
            <div className="min-w-0">
              <div className="truncate font-medium">{name}</div>
              {r.fullName && r.employeeCode && (
                <div className="text-xs text-muted-foreground">{r.employeeCode}</div>
              )}
            </div>
          );
        },
      },
      numericColumn("workDays", t("timesheet.columns.workDays"), (r) =>
        formatPayrollDays(r.workDays),
      ),
      numericColumn("presentDays", t("timesheet.columns.presentDays"), (r) =>
        formatPayrollDays(r.presentDays),
      ),
      numericColumn("paidLeaveDays", t("timesheet.columns.paidLeaveDays"), (r) =>
        formatPayrollDays(r.paidLeaveDays),
      ),
      numericColumn("unpaidLeaveDays", t("timesheet.columns.unpaidLeaveDays"), (r) =>
        formatPayrollDays(r.unpaidLeaveDays),
      ),
      numericColumn("lateMinutes", t("timesheet.columns.lateMinutes"), (r) =>
        formatPayrollMinutes(r.lateMinutes),
      ),
    ],
    [t, people],
  );

  if (!canView) return <EmptyState title={t("timesheet.noPermission")} />;

  return (
    <div className="space-y-3" data-testid="period-timesheet-tab">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{t("timesheet.description")}</span>
        <StatusPill
          tone={lock === "locked" ? "success" : lock === "open" ? "warning" : "muted"}
          label={t(`timesheet.attendanceLock.${lock}`)}
        />
      </div>

      {timesheetQuery.isError ? (
        <EmptyState
          title={t("states.error")}
          action={
            <Button variant="outline" onClick={() => void timesheetQuery.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={timesheetQuery.isLoading}
          pageSize={PAYROLL_PAGE_SIZE}
          pinFirstColumn
          emptyState={<EmptyState title={t("timesheet.empty")} />}
          footer={
            <TableFooter
              page={page}
              pageSize={PAYROLL_PAGE_SIZE}
              total={total}
              disabled={timesheetQuery.isFetching}
              onPageChange={setPage}
            />
          }
        />
      )}
    </div>
  );
}

function numericColumn(
  id: string,
  header: string,
  render: (row: PayrollTimesheetRowDto) => string,
): ColumnDef<PayrollTimesheetRowDto> {
  return {
    id,
    header,
    cell: ({ row }) => <span className={PAYROLL_NUMERIC_CELL_CLASS}>{render(row.original)}</span>,
  };
}
