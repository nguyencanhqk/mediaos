import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import type { SalaryProfileListItemDto } from "@mediaos/contracts";
import { Button, DataTable, EmptyState, PageHeader, Select } from "@mediaos/ui";
import { PAYROLL_ENGINE_PAIRS, PAYROLL_PAGE_SIZE } from "./constants";
import { formatPayrollMoney, PAYROLL_NUMERIC_CELL_CLASS } from "./payroll-format";
import { displayUserRef, usePayrollPeople } from "./use-payroll-people";
import { SalaryProfileFormDialog } from "./components/SalaryProfileFormDialog";

/**
 * PAY-SCREEN-004 (S13-PAYROLL-FE-1) — hồ sơ lương nhân sự, **versioned theo `effective_date`**
 * (PAY-DEC-003). Cặp gác: `('view','salary-profile')` — SENSITIVE.
 *
 * ⚠️ Bảng liệt kê **PHIÊN BẢN**, không phải người: một nhân sự có nhiều hàng, mỗi hàng là một mức lương
 * hiệu lực từ một ngày. Lọc theo người (`userId`) là cách xem "lịch sử của ai đó"; đó cũng là lý do
 * không có cột "lương hiện tại" — cái đó phụ thuộc NGÀY, và ngày nào là do kỳ lương quyết
 * (`effective_date <= lastDay` mới nhất, chọn ở SQL lúc `calculate`).
 *
 * ⚠️ `baseSalary`/`allowances` **có thể vắng khoá** (server mask theo cặp quyền) — cột tiền dùng
 * `formatPayrollMoney` để ra `—` chứ KHÔNG ra `0 ₫`.
 *
 * ⚠️ `allowances` là mảng `{name, amount}`; hiện **số dòng**, không tự cộng tổng: tổng phụ cấp là đại
 * lượng do SQL tính lúc tính lương (`sum((a->>'amount')::numeric)`), cộng lại ở JS đẻ ra con số thứ hai.
 */
export function SalaryProfileListPage() {
  const { t } = useTranslation("payroll");
  const people = usePayrollPeople();

  const canView = useCanExact(
    PAYROLL_ENGINE_PAIRS.salaryProfileList.action,
    PAYROLL_ENGINE_PAIRS.salaryProfileList.resourceType,
  );
  const canCreate = useCanExact(
    PAYROLL_ENGINE_PAIRS.salaryProfileCreate.action,
    PAYROLL_ENGINE_PAIRS.salaryProfileCreate.resourceType,
  );

  const [userFilter, setUserFilter] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const listParams = useMemo(
    () => ({
      ...(userFilter ? { userId: userFilter } : {}),
      page,
      per_page: PAYROLL_PAGE_SIZE,
    }),
    [userFilter, page],
  );

  const listQuery = useQuery({
    queryKey: payrollKeys.salaryProfiles.list(listParams),
    queryFn: () => payrollApi.listSalaryProfiles(listParams),
    enabled: canView,
  });

  const rows = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination?.total ?? rows.length;
  const lastPage = Math.max(1, Math.ceil(total / PAYROLL_PAGE_SIZE));

  const columns = useMemo<ColumnDef<SalaryProfileListItemDto>[]>(
    () => [
      {
        id: "user",
        header: t("salaryProfiles.columns.employee"),
        cell: ({ row }) => displayUserRef(row.original.userId, people),
      },
      { accessorKey: "effectiveDate", header: t("salaryProfiles.columns.effectiveDate") },
      {
        id: "baseSalary",
        header: t("salaryProfiles.columns.baseSalary"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollMoney(row.original.baseSalary)}
          </span>
        ),
      },
      {
        id: "allowances",
        header: t("salaryProfiles.columns.allowances"),
        cell: ({ row }) =>
          row.original.allowances === undefined
            ? "—"
            : t("salaryProfiles.allowanceCount", { count: row.original.allowances.length }),
      },
    ],
    [t, people],
  );

  if (!canView) return <EmptyState title={t("salaryProfiles.noPermission")} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("salaryProfiles.title")}
        description={t("salaryProfiles.description")}
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
                {t("salaryProfiles.create")}
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Select
          className="w-64"
          value={userFilter}
          onChange={(e) => {
            setUserFilter(e.target.value);
            setPage(1);
          }}
          aria-label={t("salaryProfiles.filterEmployee")}
          disabled={!people.canResolve}
        >
          <option value="">{t("salaryProfiles.filterAll")}</option>
          {[...people.byUserId.entries()].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        {userFilter !== "" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setUserFilter("");
              setPage(1);
            }}
          >
            {t("salaryProfiles.clearFilters")}
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
            emptyState={
              <EmptyState
                title={userFilter ? t("salaryProfiles.emptyFiltered") : t("salaryProfiles.empty")}
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

      <SalaryProfileFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        people={people}
      />
    </div>
  );
}
