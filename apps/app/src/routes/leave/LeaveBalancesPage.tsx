import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Wallet, RefreshCw } from "lucide-react";
import type { LeaveBalanceAdminView } from "@mediaos/contracts";
import { leaveApi, leaveKeys, useCanExact, PermissionGate } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Select, Input } from "@mediaos/ui";
import { LEAVE_ENGINE_PAIRS } from "./constants";
import { AdjustBalanceDialog } from "./leave-balance-adjust-dialog";

/**
 * LEAVE-SCREEN-012 — Số dư phép nhân viên (HR/Admin).
 *
 * Cổng: view:leave-balance (SENSITIVE, Company-scope hr/company-admin — mig 0455) dùng `useCanExact`
 * (KHÔNG `useCan` wildcard-fallback — mirrors LeaveApprovalPage/view-team:attendance pattern cho cặp
 * is_sensitive). Nút "Điều chỉnh" bọc `<PermissionGate action="adjust" resourceType="leave-balance">`
 * (LEAVE.BALANCE.ADJUST) — server vẫn là cổng thật (POST /leave/admin/balances/:id/adjust).
 *
 * BE gap đã biết: `LeaveBalanceAdminListQuery` KHÔNG hỗ trợ tìm theo tên/mã nhân viên (chỉ employeeId
 * UUID chính xác) → filter "Nhân viên" lọc CLIENT-SIDE trên `userFullName` của trang dữ liệu đã tải (đủ
 * dùng ở quy mô 1 công ty, MVP). Cột "Mã nhân viên"/"Phòng ban"/"Trạng thái nhân viên" trong SPEC-05
 * §13.10 KHÔNG có trong `LeaveBalanceAdminView` hiện tại (BE chưa trả) — bỏ khỏi bảng.
 */
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

export function LeaveBalancesPage({
  onViewTransactions,
}: {
  onViewTransactions: (balanceId: string) => void;
}) {
  const { t } = useTranslation("leave");
  const canView = useCanExact(
    LEAVE_ENGINE_PAIRS.VIEW_BALANCE.action,
    LEAVE_ENGINE_PAIRS.VIEW_BALANCE.resourceType,
  );

  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [adjustTargetId, setAdjustTargetId] = useState<string | null>(null);

  const queryParams = useMemo(
    () => ({ year, ...(leaveTypeId ? { leaveTypeId } : {}) }),
    [year, leaveTypeId],
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: leaveKeys.balancesAdmin.list(queryParams),
    queryFn: () => leaveApi.listBalancesAdmin(queryParams),
    enabled: canView,
    staleTime: 30_000,
  });

  const { data: leaveTypes } = useQuery({
    queryKey: leaveKeys.types.list(),
    queryFn: () => leaveApi.listTypes(),
    staleTime: 5 * 60_000,
    enabled: canView,
  });

  const items = useMemo(() => {
    const rows = data ?? [];
    const needle = employeeSearch.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => (r.userFullName ?? "").toLowerCase().includes(needle));
  }, [data, employeeSearch]);

  const columns = useColumns(t, onViewTransactions, (b) => setAdjustTargetId(b.id));

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("balancesAdmin.forbidden.title")}
          description={t("balancesAdmin.forbidden.description")}
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("balancesAdmin.error.title")}
          description={t("balancesAdmin.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("balancesAdmin.title")}
        description={t("balancesAdmin.description")}
        icon={Wallet}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-32"
            aria-label={t("balancesAdmin.filters.year")}
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
          <Select
            value={leaveTypeId}
            onChange={(e) => setLeaveTypeId(e.target.value)}
            className="w-44"
            aria-label={t("balancesAdmin.filters.leaveType")}
          >
            <option value="">{t("balancesAdmin.filters.allTypes")}</option>
            {(leaveTypes ?? []).map((lt) => (
              <option key={lt.id} value={lt.id}>
                {lt.name}
              </option>
            ))}
          </Select>
          <Input
            value={employeeSearch}
            onChange={(e) => setEmployeeSearch(e.target.value)}
            placeholder={t("balancesAdmin.filters.employeeSearchPlaceholder")}
            aria-label={t("balancesAdmin.filters.employeeSearch")}
            className="w-56"
          />
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("balancesAdmin.empty.title")}
            description={t("balancesAdmin.empty.description")}
          />
        }
        pageSize={20}
      />

      {adjustTargetId && (
        <AdjustBalanceDialog balanceId={adjustTargetId} onClose={() => setAdjustTargetId(null)} />
      )}
    </div>
  );
}

function useColumns(
  t: ReturnType<typeof useTranslation<"leave">>["t"],
  onViewTransactions: (balanceId: string) => void,
  onAdjust: (balance: LeaveBalanceAdminView) => void,
): ColumnDef<LeaveBalanceAdminView>[] {
  return [
    {
      accessorKey: "userFullName",
      header: t("balancesAdmin.columns.employee"),
      cell: ({ row }) => (
        <span className="text-sm font-medium">{row.original.userFullName ?? "—"}</span>
      ),
    },
    {
      accessorKey: "leaveTypeName",
      header: t("balancesAdmin.columns.leaveType"),
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.leaveTypeName ?? row.original.leaveTypeCode ?? "—"}
        </span>
      ),
    },
    { accessorKey: "year", header: t("balancesAdmin.columns.year") },
    { accessorKey: "totalDays", header: t("balancesAdmin.columns.granted") },
    { accessorKey: "usedDays", header: t("balancesAdmin.columns.used") },
    { accessorKey: "pendingDays", header: t("balancesAdmin.columns.pending") },
    { accessorKey: "adjustedDays", header: t("balancesAdmin.columns.adjusted") },
    {
      accessorKey: "remainingDays",
      header: t("balancesAdmin.columns.remaining"),
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.remainingDays}</span>
      ),
    },
    {
      id: "actions",
      header: t("balancesAdmin.columns.actions"),
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onViewTransactions(row.original.id)}
            aria-label={t("balancesAdmin.actions.viewTransactions")}
          >
            {t("balancesAdmin.actions.viewTransactions")}
          </Button>
          <PermissionGate
            action={LEAVE_ENGINE_PAIRS.ADJUST_BALANCE.action}
            resourceType={LEAVE_ENGINE_PAIRS.ADJUST_BALANCE.resourceType}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onAdjust(row.original)}
              aria-label={t("balancesAdmin.actions.adjust")}
            >
              {t("balancesAdmin.actions.adjust")}
            </Button>
          </PermissionGate>
        </div>
      ),
    },
  ];
}
