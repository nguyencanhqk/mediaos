import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Plus, RefreshCw } from "lucide-react";
import { payrollApi, payrollKeys, useAuthStore, useCanExact } from "@mediaos/web-core";
import type { PayrollAdvanceDto, PayrollAdvanceStatus } from "@mediaos/contracts";
import {
  Button,
  ColumnPicker,
  DataTable,
  DataToolbar,
  EmptyState,
  Input,
  PageHeader,
  Select,
  TableFooter,
  useColumnVisibility,
  type ColumnOption,
} from "@mediaos/ui";
import { PAYROLL_ADVANCE_STATUSES, PAYROLL_ENGINE_PAIRS, PAYROLL_PAGE_SIZE } from "./constants";
import { canDecideAdvance, canEditAdvance } from "./payroll-actions";
import { formatPayrollMoney, PAYROLL_NUMERIC_CELL_CLASS } from "./payroll-format";
import { isPayrollStateConflict, parsePayrollError, payrollErrorI18nKey } from "./payroll-errors";
import { displayUserRef, usePayrollPeople } from "./use-payroll-people";
import { PayrollAdvanceStatusBadge } from "./components/StatusBadges";
import { AdvanceFormDialog } from "./components/AdvanceFormDialog";
import { ReasonDialog } from "./components/ReasonDialog";

const PERIOD_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

interface Filters {
  deductPeriodMonth: string;
  status: PayrollAdvanceStatus | "";
}
const EMPTY_FILTERS: Filters = { deductPeriodMonth: "", status: "" };

/**
 * PAY-SCREEN-012 (S15-PAYROLL-FE-3) — «Tạm ứng» (SPEC-11 §9.1 · §13.1 · §15.1 hàng 059–064).
 *
 * ⚠️ **Four-eyes RỘNG HƠN thưởng/phạt.** Nút «Duyệt»/«Từ chối» ẩn khi actor là người TẠO **hoặc** người
 * THỤ HƯỞNG (`canDecideAdvance` — mirror `payroll-advances.service.ts`: BE chặn cả hai vế, 409
 * `PAYROLL-ERR-025 self-approval`). SPEC-11 §9.1 chỉ viết «ẩn với người tạo» — hẹp hơn BE.
 *
 * ⚠️ **Query 059 là `.strict()`.** Chỉ gửi `deductPeriodMonth` · `status[]` · `page` · `per_page` —
 * không sort, không cột lạ (khoá lạ ⇒ 400, không bị bỏ im lặng).
 *
 * ⚠️ Đã gắn vào kỳ lương (`payrollPeriodId !== null`) ⇒ khoá sửa — badge «đã khấu trừ» thay cho nút sửa.
 * `canEditAdvance` chỉ mở khi còn `Pending` và chưa consume.
 *
 * ⚠️ Duyệt khi kỳ đích đang `Calculated` trả `warnings: ["recalculate-required"]` — tín hiệu PHẢI hiện,
 * không được nuốt: khoản vừa duyệt chưa nằm trong phiếu đã tính, cần tính lại kỳ.
 */
export function PayrollAdvanceListPage() {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();
  const people = usePayrollPeople();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const canView = useCanExact(
    PAYROLL_ENGINE_PAIRS.advanceList.action,
    PAYROLL_ENGINE_PAIRS.advanceList.resourceType,
  );
  const canCreate = useCanExact(
    PAYROLL_ENGINE_PAIRS.advanceCreate.action,
    PAYROLL_ENGINE_PAIRS.advanceCreate.resourceType,
  );
  const canManage = useCanExact(
    PAYROLL_ENGINE_PAIRS.advanceUpdate.action,
    PAYROLL_ENGINE_PAIRS.advanceUpdate.resourceType,
  );
  const canApprove = useCanExact(
    PAYROLL_ENGINE_PAIRS.advanceApprove.action,
    PAYROLL_ENGINE_PAIRS.advanceApprove.resourceType,
  );

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAYROLL_PAGE_SIZE);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAdvance, setEditingAdvance] = useState<PayrollAdvanceDto | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PayrollAdvanceDto | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [recalcNotice, setRecalcNotice] = useState(false);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };
  const hasFilters = filters.deductPeriodMonth !== "" || filters.status !== "";

  // 🔴 059 là `.strict()` — chỉ những khoá này, không sort, không khoá lạ (xem chú thích đầu file).
  const listParams = useMemo(
    () => ({
      ...(PERIOD_MONTH_RE.test(filters.deductPeriodMonth)
        ? { deductPeriodMonth: filters.deductPeriodMonth }
        : {}),
      ...(filters.status ? { status: [filters.status] } : {}),
      page,
      per_page: pageSize,
    }),
    [filters, page, pageSize],
  );

  const listQuery = useQuery({
    queryKey: payrollKeys.advances.list(listParams),
    queryFn: () => payrollApi.listAdvances(listParams),
    enabled: canView,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: payrollKeys.advances.allOf() });

  const decideMutation = useMutation({
    mutationFn: (input: { id: string; decision: "approve" | "reject"; note?: string }) =>
      input.decision === "approve"
        ? payrollApi.approveAdvance(input.id, {})
        : payrollApi.rejectAdvance(input.id, { note: input.note ?? "" }),
    onSuccess: (data) => {
      setErrorKey(null);
      setRejectTarget(null);
      // Kỳ đích đang `Calculated` ⇒ khoản vừa duyệt chưa nằm trong phiếu — hiện tín hiệu, không nuốt.
      setRecalcNotice(data.warnings.includes("recalculate-required"));
      void refresh();
    },
    onError: (error) => {
      const info = parsePayrollError(error);
      setErrorKey(payrollErrorI18nKey(info));
      // Khoản có thể vừa bị người khác quyết định / vừa bị gộp vào kỳ ⇒ đọc lại để nút biến mất đúng.
      if (isPayrollStateConflict(info)) void refresh();
    },
  });

  const rows = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination?.total;
  // Mask fail-CLOSED (D10): trang RỖNG không có hàng để đo ⇒ không được kết luận «được xem».
  const moneyMasked = rows.length === 0 || rows.every((r) => r.amount === undefined);

  const columns = useMemo<ColumnDef<PayrollAdvanceDto>[]>(
    () => [
      {
        id: "user",
        header: t("advances.columns.employee"),
        cell: ({ row }) => displayUserRef(row.original.userId, people),
      },
      {
        id: "amount",
        header: t("advances.columns.amount"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollMoney(row.original.amount)}
          </span>
        ),
      },
      {
        id: "deductPeriodMonth",
        accessorKey: "deductPeriodMonth",
        header: t("advances.columns.month"),
      },
      { id: "reason", accessorKey: "reason", header: t("advances.columns.reason") },
      {
        id: "status",
        header: t("advances.columns.status"),
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-2">
            <PayrollAdvanceStatusBadge status={row.original.status} />
            {row.original.payrollPeriodId !== null && (
              <span className="text-xs text-muted-foreground">
                {t("advances.consumed", { month: row.original.deductPeriodMonth })}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "decision",
        header: t("advances.columns.decision"),
        cell: ({ row }) => {
          const item = row.original;
          const showEdit = canEditAdvance(item, canManage);
          const showDecide = canDecideAdvance(item, canApprove, currentUserId);
          if (!showEdit && !showDecide) return null;
          return (
            <div className="flex justify-end gap-2">
              {showEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingAdvance(item);
                    setFormOpen(true);
                  }}
                >
                  {t("advances.edit")}
                </Button>
              )}
              {showDecide && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decideMutation.isPending}
                    onClick={() => decideMutation.mutate({ id: item.id, decision: "approve" })}
                  >
                    {t("advances.approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={decideMutation.isPending}
                    onClick={() => setRejectTarget(item)}
                  >
                    {t("advances.reject")}
                  </Button>
                </>
              )}
            </div>
          );
        },
      },
    ],
    // Deps chỉ gồm thứ THẬT SỰ đổi cột: `decideMutation` là object mới mỗi render nên đưa nguyên
    // `isPending`/`mutate` vào — `mutate` ổn định qua các render ở react-query v5.
    [
      t,
      people,
      canManage,
      canApprove,
      currentUserId,
      decideMutation.isPending,
      decideMutation.mutate,
    ],
  );

  /** «Nhân sự» khoá (cột định danh, ghim trái); cột tiền vắng khỏi ⚙ khi bị mask (D10). */
  const columnOptions = useMemo<ColumnOption[]>(
    () => [
      { id: "user", label: t("advances.columns.employee"), locked: true },
      ...(moneyMasked ? [] : [{ id: "amount", label: t("advances.columns.amount") }]),
      { id: "deductPeriodMonth", label: t("advances.columns.month") },
      { id: "reason", label: t("advances.columns.reason") },
      { id: "status", label: t("advances.columns.status") },
    ],
    [t, moneyMasked],
  );
  const columnPrefs = useColumnVisibility("payroll.advances", columnOptions);

  if (!canView) return <EmptyState title={t("advances.noPermission")} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("advances.title")}
        description={t("advances.description")}
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
              <Button
                size="sm"
                onClick={() => {
                  setEditingAdvance(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="mr-2 size-4" />
                {t("advances.create")}
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
        <div className="w-40">
          <Input
            placeholder="2026-09"
            value={filters.deductPeriodMonth}
            onChange={(e) => setFilter("deductPeriodMonth", e.target.value)}
            aria-label={t("advances.filterMonth")}
          />
        </div>
        <Select
          className="w-44"
          value={filters.status}
          onChange={(e) => setFilter("status", e.target.value as PayrollAdvanceStatus | "")}
          aria-label={t("advances.filterStatus")}
        >
          <option value="">{t("advances.filterAll")}</option>
          {PAYROLL_ADVANCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`advanceStatus.${s}`)}
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
            {t("advances.clearFilters")}
          </Button>
        )}
      </DataToolbar>

      {recalcNotice && (
        <div
          className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-muted/40 px-4 py-3 text-sm"
          role="status"
        >
          <AlertTriangle className="size-4" />
          {t("advances.recalculateRequired")}
        </div>
      )}

      {errorKey && <p className="text-sm text-danger">{t(errorKey)}</p>}

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
          pinLastColumn
          emptyState={
            <EmptyState title={hasFilters ? t("advances.emptyFiltered") : t("advances.empty")} />
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

      <AdvanceFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        people={people}
        advance={editingAdvance}
      />

      <ReasonDialog
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        onSubmit={(note) => {
          if (rejectTarget) {
            decideMutation.mutate({ id: rejectTarget.id, decision: "reject", note });
          }
        }}
        title={t("advances.rejectTitle")}
        submitLabel={t("advances.reject")}
        isPending={decideMutation.isPending}
        errorMessage={errorKey ? t(errorKey) : null}
      />
    </div>
  );
}
