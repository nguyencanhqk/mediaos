import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { History, RefreshCw, ArrowLeft } from "lucide-react";
import type { LeaveBalanceTransactionView } from "@mediaos/contracts";
import { leaveApi, leaveKeys, useCanExact, PermissionGate, ApiError } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button } from "@mediaos/ui";
import { LEAVE_ENGINE_PAIRS } from "./constants";
import { AdjustBalanceDialog } from "./leave-balance-adjust-dialog";

/**
 * LEAVE-SCREEN-013 — Lịch sử giao dịch số dư phép (ledger, read-only) + điều chỉnh (HR/Admin).
 *
 * Cổng đọc: view-transaction:leave-balance (SENSITIVE, Company-scope hr/company-admin — mig 0455) qua
 * `useCanExact`. Cổng điều chỉnh: adjust:leave-balance qua `<PermissionGate>` — KHÔNG endpoint nào khác
 * sửa `leave_balances.total_days` (bất biến #2, ledger append-only — bảng dưới ĐÂY chỉ ĐỌC, không có
 * nút sửa/xoá dòng nào).
 */
export function LeaveBalanceTransactionsPage({
  balanceId,
  onBack,
}: {
  balanceId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation("leave");
  const canView = useCanExact(
    LEAVE_ENGINE_PAIRS.VIEW_TRANSACTION_BALANCE.action,
    LEAVE_ENGINE_PAIRS.VIEW_TRANSACTION_BALANCE.resourceType,
  );
  const [showAdjust, setShowAdjust] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: leaveKeys.balancesAdmin.transactions(balanceId),
    queryFn: () => leaveApi.listBalanceTransactions(balanceId),
    enabled: canView,
    staleTime: 15_000,
  });

  const columns = useColumns(t);

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("balanceTransactions.forbidden.title")}
          description={t("balanceTransactions.forbidden.description")}
        />
      </div>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="p-6">
        <EmptyState
          title={
            notFound
              ? t("balanceTransactions.notFound.title")
              : t("balanceTransactions.error.title")
          }
          description={
            notFound
              ? t("balanceTransactions.notFound.description")
              : t("balanceTransactions.error.description")
          }
          action={
            notFound ? undefined : (
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("actions.retry", { ns: "common" })}
              </Button>
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("balanceTransactions.title")}
        description={t("balanceTransactions.description")}
        icon={History}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("balanceTransactions.backToList")}
            </Button>
            <PermissionGate
              action={LEAVE_ENGINE_PAIRS.ADJUST_BALANCE.action}
              resourceType={LEAVE_ENGINE_PAIRS.ADJUST_BALANCE.resourceType}
            >
              <Button size="sm" onClick={() => setShowAdjust(true)}>
                {t("balancesAdmin.actions.adjust")}
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("balanceTransactions.empty.title")}
            description={t("balanceTransactions.empty.description")}
          />
        }
        pageSize={20}
      />

      {showAdjust && (
        <AdjustBalanceDialog
          balanceId={balanceId}
          onClose={() => setShowAdjust(false)}
          onSuccess={() => void refetch()}
        />
      )}
    </div>
  );
}

function useColumns(
  t: ReturnType<typeof useTranslation<"leave">>["t"],
): ColumnDef<LeaveBalanceTransactionView>[] {
  return [
    {
      accessorKey: "transactionType",
      header: t("balanceTransactions.columns.type"),
      cell: ({ row }) => <span className="text-sm">{row.original.transactionType}</span>,
    },
    { accessorKey: "transactionDate", header: t("balanceTransactions.columns.date") },
    {
      accessorKey: "amountDays",
      header: t("balanceTransactions.columns.amount"),
      cell: ({ row }) => (
        <span
          className={
            row.original.amountDays < 0
              ? "font-medium text-destructive"
              : "font-medium text-foreground"
          }
        >
          {row.original.amountDays > 0 ? `+${row.original.amountDays}` : row.original.amountDays}
        </span>
      ),
    },
    {
      accessorKey: "balanceBeforeDays",
      header: t("balanceTransactions.columns.before"),
      cell: ({ row }) => <span className="text-sm">{row.original.balanceBeforeDays ?? "—"}</span>,
    },
    {
      accessorKey: "balanceAfterDays",
      header: t("balanceTransactions.columns.after"),
      cell: ({ row }) => <span className="text-sm">{row.original.balanceAfterDays ?? "—"}</span>,
    },
    {
      accessorKey: "reason",
      header: t("balanceTransactions.columns.reason"),
      cell: ({ row }) => <span className="text-sm">{row.original.reason ?? "—"}</span>,
    },
    {
      accessorKey: "createdByType",
      header: t("balanceTransactions.columns.createdBy"),
      cell: ({ row }) => (
        <span className="text-sm">
          {t(`balanceTransactions.createdByType.${row.original.createdByType}`, {
            defaultValue: row.original.createdByType,
          })}
        </span>
      ),
    },
    {
      accessorKey: "createdAt",
      header: t("balanceTransactions.columns.createdAt"),
      cell: ({ row }) => (
        <span className="text-sm">{new Date(row.original.createdAt).toLocaleString("vi-VN")}</span>
      ),
    },
  ];
}
