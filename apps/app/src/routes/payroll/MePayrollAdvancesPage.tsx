import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import type { PayrollAdvanceDto } from "@mediaos/contracts";
import { Button, DataTable, EmptyState, PageHeader, TableFooter } from "@mediaos/ui";
import { PAYROLL_PAGE_SIZE } from "./constants";
import { formatPayrollMoney, PAYROLL_NUMERIC_CELL_CLASS } from "./payroll-format";
import { PayrollAdvanceStatusBadge } from "./components/StatusBadges";

/**
 * PAY-SCREEN-017 (S15-PAYROLL-FE-3) — «Tạm ứng của tôi». Scope **Own tuyệt đối** (PAYROLL-API-065).
 *
 * ── VÌ SAO MÀN NÀY KHÔNG NẰM SAU CỔNG QUYỀN PAYROLL ───────────────────────────────────────────────
 * Route đăng ký dưới `moduleCode: "ME"` với `access:me`, KHÔNG phải `access:payroll` — CÙNG khuôn
 * `MePayslipsPage`. Khoản tạm ứng của chính mình là thứ nhân viên phải xem được; nhét nó sau cổng
 * module quản trị tiền lương là đúng kiểu lỗi `personal-prefs-must-not-sit-behind-permission-gate`:
 * người ít quyền nhất mất luôn đường xem dữ liệu của chính họ. Cổng THẬT là cặp
 * `('view-own','payroll-advance')` ở BE (sàn scope Company **TẮT**, `objectGrantRequired = false`).
 *
 * ⚠️ Chưa có khoản nào ⇒ 065 trả danh sách **RỖNG, không lỗi** (fail-closed, chuẩn `/me/payslips`) —
 * màn hiện empty-state chứ KHÔNG hiện lỗi.
 *
 * ⚠️ **KHÔNG ghi audit lượt đọc** (SPEC-11 §18.1 B): tự xem của mình không phải sự kiện an ninh, ghi
 * thì đẻ nhiễu che mất lượt xem đáng ngờ thật. Vì vậy màn này KHÔNG cần `enabled` theo khối như các màn
 * quản trị 059/061/066/068/070/073.
 *
 * ⚠️ Không có bộ lọc theo người: chủ thể của 065 là chính caller, query KHÔNG có `userId`.
 */
export function MePayrollAdvancesPage() {
  const { t } = useTranslation("payroll");
  const [page, setPage] = useState(1);

  const listParams = { page, per_page: PAYROLL_PAGE_SIZE };
  const listQuery = useQuery({
    queryKey: payrollKeys.meAdvances.list(listParams),
    queryFn: () => payrollApi.listMyAdvances(listParams),
  });

  const rows = listQuery.data?.data ?? [];
  // Tổng CHỈ từ API — rơi về `rows.length` là lấy số của TRANG làm «tổng»
  // (`apifetch-drops-pagination-bare-array`).
  const total = listQuery.data?.pagination?.total;

  const columns: ColumnDef<PayrollAdvanceDto>[] = [
    {
      id: "amount",
      header: t("meAdvances.columns.amount"),
      // Khoản của CHÍNH mình nên 065 vẫn trả `amount`; vẫn khai `.optional()` ở DTO (mask là việc của
      // server) ⇒ `formatPayrollMoney` tự lo ca vắng khoá, KHÔNG ép về 0.
      cell: ({ row }) => (
        <span className={PAYROLL_NUMERIC_CELL_CLASS}>
          {formatPayrollMoney(row.original.amount)}
        </span>
      ),
    },
    {
      id: "deductPeriodMonth",
      accessorKey: "deductPeriodMonth",
      header: t("meAdvances.columns.month"),
    },
    { id: "reason", accessorKey: "reason", header: t("meAdvances.columns.reason") },
    {
      id: "status",
      header: t("meAdvances.columns.status"),
      cell: ({ row }) => <PayrollAdvanceStatusBadge status={row.original.status} />,
    },
    {
      id: "decidedAt",
      header: t("meAdvances.columns.decidedAt"),
      cell: ({ row }) =>
        row.original.decidedAt === null
          ? "—"
          : new Date(row.original.decidedAt).toLocaleDateString("vi-VN"),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("meAdvances.title")}
        description={t("meAdvances.description")}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void listQuery.refetch()}
            disabled={listQuery.isFetching}
          >
            <RefreshCw className="mr-2 size-4" />
            {t("states.retry")}
          </Button>
        }
      />

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
          emptyState={<EmptyState title={t("meAdvances.empty")} />}
          footer={
            <TableFooter
              page={page}
              pageSize={PAYROLL_PAGE_SIZE}
              total={total}
              disabled={listQuery.isFetching}
              onPageChange={setPage}
            />
          }
        />
      )}
    </div>
  );
}
