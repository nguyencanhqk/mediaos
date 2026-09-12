import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import type { SalaryProfileListItemDto } from "@mediaos/contracts";
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
  const [pageSize, setPageSize] = useState(PAYROLL_PAGE_SIZE);
  const [createOpen, setCreateOpen] = useState(false);

  const listParams = useMemo(
    () => ({
      ...(userFilter ? { userId: userFilter } : {}),
      page,
      per_page: pageSize,
    }),
    [userFilter, page, pageSize],
  );

  const listQuery = useQuery({
    queryKey: payrollKeys.salaryProfiles.list(listParams),
    queryFn: () => payrollApi.listSalaryProfiles(listParams),
    enabled: canView,
  });

  const rows = listQuery.data?.data ?? [];
  // Tổng CHỈ từ API; mảng trần ⇒ footer nói «không rõ tổng» thay vì đếm trang hiện tại.
  const total = listQuery.data?.pagination?.total;
  /**
   * Server mask theo CẶP QUYỀN = **vắng khoá** cả trang (`isPayrollMoneyMasked` khuôn `gross`). Cột
   * tiền vẫn render `—` (không đổi hành vi v1), nhưng **vắng khỏi ⚙ chọn cột**: liệt kê tên trường
   * tiền cho đúng người không được đọc trường đó là biến picker thành bảng chỉ mục PII
   * (UI-07 §10.4 mục 10).
   *
   * ⚠️ **Trang RỖNG ⇒ coi như MASK (fail-closed).** Phép đo này lấy mẫu từ hàng đang tải; lọc ra 0
   * kết quả thì không có gì để đo — và «không đo được» KHÔNG phải là «được phép xem». Bản đầu viết
   * `rows.length > 0 && …` nên trang rỗng cho ra `false` ⇒ tên trường tiền hiện lại trong ⚙ với đúng
   * vai bị mask, chỉ cần lọc một bộ lọc không khớp gì. Giá phải trả của chiều fail-closed chỉ là:
   * lúc chưa có dữ liệu thì không bật/tắt được cột tiền — cột vẫn render, và ⚙ đủ lại ngay khi có hàng.
   */
  const moneyMasked = rows.length === 0 || rows.every((r) => r.baseSalary === undefined);

  const columns = useMemo<ColumnDef<SalaryProfileListItemDto>[]>(
    () => [
      {
        id: "user",
        header: t("salaryProfiles.columns.employee"),
        cell: ({ row }) => displayUserRef(row.original.userId, people),
      },
      {
        id: "effectiveDate",
        accessorKey: "effectiveDate",
        header: t("salaryProfiles.columns.effectiveDate"),
      },
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

  const columnOptions = useMemo<ColumnOption[]>(
    () => [
      { id: "user", label: t("salaryProfiles.columns.employee"), locked: true },
      { id: "effectiveDate", label: t("salaryProfiles.columns.effectiveDate") },
      ...(moneyMasked
        ? []
        : [
            { id: "baseSalary", label: t("salaryProfiles.columns.baseSalary") },
            { id: "allowances", label: t("salaryProfiles.columns.allowances") },
          ]),
    ],
    [t, moneyMasked],
  );
  const columnPrefs = useColumnVisibility("payroll.salaryProfiles", columnOptions);

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
          emptyState={
            <EmptyState
              title={userFilter ? t("salaryProfiles.emptyFiltered") : t("salaryProfiles.empty")}
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

      <SalaryProfileFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        people={people}
      />
    </div>
  );
}
