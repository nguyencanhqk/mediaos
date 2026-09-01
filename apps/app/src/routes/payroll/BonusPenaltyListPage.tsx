import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";
import { payrollApi, payrollKeys, useAuthStore, useCanExact } from "@mediaos/web-core";
import type { BonusKind, BonusPenaltyDto, BonusPenaltyStatus } from "@mediaos/contracts";
import { Button, DataTable, EmptyState, Input, PageHeader, Select } from "@mediaos/ui";
import { BONUS_PENALTY_STATUSES, PAYROLL_ENGINE_PAIRS, PAYROLL_PAGE_SIZE } from "./constants";
import { canDecideBonusPenalty } from "./payroll-actions";
import { formatPayrollMoney, PAYROLL_NUMERIC_CELL_CLASS } from "./payroll-format";
import { isPayrollStateConflict, parsePayrollError, payrollErrorI18nKey } from "./payroll-errors";
import { displayUserRef, usePayrollPeople } from "./use-payroll-people";
import { BonusKindBadge, BonusPenaltyStatusBadge } from "./components/StatusBadges";
import { BonusPenaltyFormDialog } from "./components/BonusPenaltyFormDialog";
import { ReasonDialog } from "./components/ReasonDialog";

const PERIOD_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

interface Filters {
  periodMonth: string;
  status: BonusPenaltyStatus | "";
  kind: BonusKind | "";
}
const EMPTY_FILTERS: Filters = { periodMonth: "", status: "", kind: "" };

/**
 * PAY-SCREEN-005 (S13-PAYROLL-FE-1) — thưởng/phạt/khấu trừ theo kỳ (SPEC-11 §13.3).
 *
 * ── FOUR-EYES Ở ĐÂY CŨNG LÀ ẨN NÚT ────────────────────────────────────────────────────────────────
 * Nút «Duyệt»/«Từ chối» KHÔNG hiện trên khoản do CHÍNH mình tạo (`createdBy === currentUserId` ⇒ 409
 * `PAYROLL-ERR-012` ở BE). Cùng nguyên tắc với thanh hành động kỳ lương: four-eyes phải thấy được ở UI,
 * không chỉ đọc được trong mã lỗi.
 *
 * ⚠️ **Đã vào kỳ lương ⇒ khoá sửa.** `payrollPeriodId !== null` là cờ đã consume — badge «đã vào kỳ»
 * thay cho nút sửa (409 `PAYROLL-ERR-013`). Trạng thái `Approved` mà chưa consume thì vẫn KHÔNG sửa
 * được (chỉ `Pending` mới sửa) — hai điều kiện khác nhau, cả hai đều ở `canEditBonusPenalty`.
 *
 * ⚠️ `decisionNote` **BẮT BUỘC khi từ chối** (mirror `bonus_penalties_reject_note_check`), tuỳ chọn khi
 * duyệt — đó là lý do «Từ chối» mở `ReasonDialog` còn «Duyệt» gửi thẳng.
 */
export function BonusPenaltyListPage() {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();
  const people = usePayrollPeople();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const canView = useCanExact(
    PAYROLL_ENGINE_PAIRS.bonusPenaltyList.action,
    PAYROLL_ENGINE_PAIRS.bonusPenaltyList.resourceType,
  );
  const canCreate = useCanExact(
    PAYROLL_ENGINE_PAIRS.bonusPenaltyCreate.action,
    PAYROLL_ENGINE_PAIRS.bonusPenaltyCreate.resourceType,
  );
  const canDecide = useCanExact(
    PAYROLL_ENGINE_PAIRS.bonusPenaltyApprove.action,
    PAYROLL_ENGINE_PAIRS.bonusPenaltyApprove.resourceType,
  );

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<BonusPenaltyDto | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };
  const hasFilters = filters.periodMonth !== "" || filters.status !== "" || filters.kind !== "";

  const listParams = useMemo(
    () => ({
      ...(PERIOD_MONTH_RE.test(filters.periodMonth) ? { periodMonth: filters.periodMonth } : {}),
      ...(filters.status ? { status: [filters.status] } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      page,
      per_page: PAYROLL_PAGE_SIZE,
    }),
    [filters, page],
  );

  const listQuery = useQuery({
    queryKey: payrollKeys.bonusPenalties.list(listParams),
    queryFn: () => payrollApi.listBonusPenalties(listParams),
    enabled: canView,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: payrollKeys.bonusPenalties.allOf() });

  const decideMutation = useMutation({
    mutationFn: (input: { id: string; decision: "approve" | "reject"; note?: string }) =>
      input.decision === "approve"
        ? payrollApi.approveBonusPenalty(input.id, {})
        : payrollApi.rejectBonusPenalty(input.id, { decisionNote: input.note ?? "" }),
    onSuccess: () => {
      setErrorKey(null);
      setRejectTarget(null);
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
  const total = listQuery.data?.pagination?.total ?? rows.length;
  const lastPage = Math.max(1, Math.ceil(total / PAYROLL_PAGE_SIZE));

  const columns = useMemo<ColumnDef<BonusPenaltyDto>[]>(
    () => [
      {
        id: "user",
        header: t("bonus.columns.employee"),
        cell: ({ row }) => displayUserRef(row.original.userId, people),
      },
      {
        id: "kind",
        header: t("bonus.columns.kind"),
        cell: ({ row }) => <BonusKindBadge kind={row.original.kind} />,
      },
      {
        id: "amount",
        header: t("bonus.columns.amount"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollMoney(row.original.amount)}
          </span>
        ),
      },
      { accessorKey: "periodMonth", header: t("bonus.columns.month") },
      { accessorKey: "reason", header: t("bonus.columns.reason") },
      {
        id: "status",
        header: t("bonus.columns.status"),
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-2">
            <BonusPenaltyStatusBadge status={row.original.status} />
            {row.original.payrollPeriodId !== null && (
              <span className="text-xs text-muted-foreground">{t("bonus.consumed")}</span>
            )}
          </div>
        ),
      },
      {
        id: "decide",
        header: "",
        cell: ({ row }) => {
          const item = row.original;
          if (!canDecideBonusPenalty(item, canDecide, currentUserId)) return null;
          return (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={decideMutation.isPending}
                onClick={() => decideMutation.mutate({ id: item.id, decision: "approve" })}
              >
                {t("bonus.approve")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={decideMutation.isPending}
                onClick={() => setRejectTarget(item)}
              >
                {t("bonus.reject")}
              </Button>
            </div>
          );
        },
      },
    ],
    // Deps chỉ gồm thứ THẬT SỰ đổi cột: `decideMutation` là object mới mỗi render nên đưa nguyên nó
    // vào là useMemo không bao giờ trúng cache. `mutate` ổn định qua các render ở react-query v5.
    [t, people, canDecide, currentUserId, decideMutation.isPending, decideMutation.mutate],
  );

  if (!canView) return <EmptyState title={t("bonus.noPermission")} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("bonus.title")}
        description={t("bonus.description")}
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
                {t("bonus.create")}
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Input
            placeholder="2026-09"
            value={filters.periodMonth}
            onChange={(e) => setFilter("periodMonth", e.target.value)}
            aria-label={t("bonus.filterMonth")}
          />
        </div>
        <Select
          className="w-44"
          value={filters.status}
          onChange={(e) => setFilter("status", e.target.value as BonusPenaltyStatus | "")}
          aria-label={t("bonus.filterStatus")}
        >
          <option value="">{t("bonus.filterAll")}</option>
          {BONUS_PENALTY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`bonusStatus.${s}`)}
            </option>
          ))}
        </Select>
        <Select
          className="w-40"
          value={filters.kind}
          onChange={(e) => setFilter("kind", e.target.value as BonusKind | "")}
          aria-label={t("bonus.filterKind")}
        >
          <option value="">{t("bonus.filterAll")}</option>
          <option value="bonus">{t("bonusKind.bonus")}</option>
          <option value="penalty">{t("bonusKind.penalty")}</option>
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
            {t("bonus.clearFilters")}
          </Button>
        )}
      </div>

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
        <>
          <DataTable
            columns={columns}
            data={rows}
            isLoading={listQuery.isLoading}
            pageSize={PAYROLL_PAGE_SIZE}
            emptyState={
              <EmptyState title={hasFilters ? t("bonus.emptyFiltered") : t("bonus.empty")} />
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

      <BonusPenaltyFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        people={people}
        defaultPeriodMonth={
          PERIOD_MONTH_RE.test(filters.periodMonth) ? filters.periodMonth : undefined
        }
      />

      <ReasonDialog
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        onSubmit={(note) => {
          if (rejectTarget) {
            decideMutation.mutate({ id: rejectTarget.id, decision: "reject", note });
          }
        }}
        title={t("bonus.rejectTitle")}
        submitLabel={t("bonus.reject")}
        isPending={decideMutation.isPending}
        errorMessage={errorKey ? t(errorKey) : null}
      />
    </div>
  );
}
