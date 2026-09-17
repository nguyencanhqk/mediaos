import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import {
  payrollInsuranceIssueEnum,
  type PayrollEmployeeListItemDto,
  type PayrollInsuranceIssue,
} from "@mediaos/contracts";
import {
  Button,
  ColumnPicker,
  DataTable,
  DataToolbar,
  EmptyState,
  PageHeader,
  Select,
  StatusPill,
  TableFooter,
  useColumnVisibility,
  type ColumnOption,
} from "@mediaos/ui";
import {
  EMPLOYEE_STATUS_BADGE_VARIANT,
  PAYROLL_ENGINE_PAIRS,
  PAYROLL_PAGE_SIZE,
} from "./constants";
import { UnitSelector } from "./components/UnitSelector";

type ProfileFilter = "" | "true" | "false";
type InsuranceFilter = "" | PayrollInsuranceIssue;

/**
 * PAY-SCREEN-007 «Nhân viên» — danh sách (S15-PAYROLL-FE-1). Cặp gác `('view','payroll-employee')` —
 * SENSITIVE ⇒ `useCanExact`. Đọc PAYROLL-API-036: **chiếu HR bó hẹp** (mã · họ tên · đơn vị · vị trí ·
 * trạng thái · có hồ sơ lương) + `taxCode` CÓ ĐIỀU KIỆN (chỉ khi caller thêm `view:salary-profile`@Company).
 *
 * ── Cột `taxCode` theo ĐÚNG khuôn mask cột tiền (UI-07 §10.4 mục 10) ────────────────────────────
 * Server mask = VẮNG KHOÁ trên mọi hàng. Cột vẫn render `—`, nhưng nhãn «Mã số thuế» phải **vắng khỏi ⚙
 * chọn cột** khi bị mask — và **trang RỖNG coi như mask** (fail-closed): «không đo được» KHÔNG phải «được
 * phép xem» (`payroll-money-column-mask.spec.tsx` là tiền lệ; `payroll-employee-list-mask.spec.tsx` neo
 * ca này).
 *
 * Toolbar chuẩn: tìm `q` (họ tên / mã NV) · `UnitSelector` (khớp CHÍNH XÁC một đơn vị, không đệ quy —
 * plan BE-1 §9.3) · lọc đã/chưa có hồ sơ lương. Cột định danh (tên + mã) ghim trái và KHOÁ trong ⚙.
 *
 * S15-PAYROLL-FE-4: lọc «vấn đề bảo hiểm» (`insuranceIssue` của 036) — đích deep-link của Lời nhắc ở Tổng
 * quan (`?insuranceIssue=` → `initialInsuranceIssue`). Đổi deep-link khi trang đang mở ⇒ bộ lọc theo kịp.
 */
export function PayrollEmployeeListPage({
  onOpenEmployee,
  initialInsuranceIssue,
}: {
  onOpenEmployee: (userId: string) => void;
  initialInsuranceIssue?: PayrollInsuranceIssue;
}) {
  const { t } = useTranslation("payroll");
  const canView = useCanExact(
    PAYROLL_ENGINE_PAIRS.employeeList.action,
    PAYROLL_ENGINE_PAIRS.employeeList.resourceType,
  );

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [orgUnitId, setOrgUnitId] = useState("");
  const [profileFilter, setProfileFilter] = useState<ProfileFilter>("");
  const [insuranceFilter, setInsuranceFilter] = useState<InsuranceFilter>(
    initialInsuranceIssue ?? "",
  );
  const [seenInitialIssue, setSeenInitialIssue] = useState(initialInsuranceIssue);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAYROLL_PAGE_SIZE);

  // Deep-link mới (search param đổi mà trang không remount) ⇒ điều chỉnh state NGAY trong render.
  if (initialInsuranceIssue !== seenInitialIssue) {
    setSeenInitialIssue(initialInsuranceIssue);
    setInsuranceFilter(initialInsuranceIssue ?? "");
    setPage(1);
  }

  const hasFilters =
    search !== "" || orgUnitId !== "" || profileFilter !== "" || insuranceFilter !== "";
  const resetPage = () => setPage(1);

  const listParams = useMemo(
    () => ({
      ...(deferredSearch ? { q: deferredSearch } : {}),
      ...(orgUnitId ? { orgUnitId } : {}),
      ...(profileFilter ? { hasSalaryProfile: profileFilter === "true" } : {}),
      ...(insuranceFilter ? { insuranceIssue: insuranceFilter } : {}),
      page,
      per_page: pageSize,
    }),
    [deferredSearch, orgUnitId, profileFilter, insuranceFilter, page, pageSize],
  );

  const listQuery = useQuery({
    queryKey: payrollKeys.employees.list(listParams),
    queryFn: () => payrollApi.listEmployees(listParams),
    enabled: canView,
  });

  const rows = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination?.total;
  /** Trang rỗng ⇒ MASK (fail-closed) — xem docblock. */
  const taxCodeMasked = rows.length === 0 || rows.every((r) => r.taxCode === undefined);

  const columns = useMemo<ColumnDef<PayrollEmployeeListItemDto>[]>(
    () => [
      {
        id: "employee",
        header: t("employees.columns.employee"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">
              {row.original.fullName ?? row.original.employeeCode ?? "—"}
            </div>
            {row.original.fullName && row.original.employeeCode && (
              <div className="text-xs text-muted-foreground">{row.original.employeeCode}</div>
            )}
          </div>
        ),
      },
      {
        id: "orgUnit",
        header: t("employees.columns.orgUnit"),
        cell: ({ row }) => row.original.orgUnitName ?? "—",
      },
      {
        id: "position",
        header: t("employees.columns.position"),
        cell: ({ row }) => row.original.positionName ?? "—",
      },
      {
        id: "status",
        header: t("employees.columns.status"),
        cell: ({ row }) => {
          const s = row.original.employeeStatus;
          if (!s) return "—";
          return (
            <StatusPill
              tone={EMPLOYEE_STATUS_BADGE_VARIANT[s] ?? "muted"}
              label={t(`employeeStatus.${s}`, { defaultValue: s })}
            />
          );
        },
      },
      {
        id: "hasSalaryProfile",
        header: t("employees.columns.hasSalaryProfile"),
        cell: ({ row }) => (
          <StatusPill
            hideDot
            tone={row.original.hasSalaryProfile ? "success" : "warning"}
            label={
              row.original.hasSalaryProfile ? t("employees.hasProfile") : t("employees.noProfile")
            }
          />
        ),
      },
      {
        id: "taxCode",
        header: t("employees.columns.taxCode"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.taxCode ?? "—"}</span>,
      },
    ],
    [t],
  );

  const columnOptions = useMemo<ColumnOption[]>(
    () => [
      { id: "employee", label: t("employees.columns.employee"), locked: true },
      { id: "orgUnit", label: t("employees.columns.orgUnit") },
      { id: "position", label: t("employees.columns.position") },
      { id: "status", label: t("employees.columns.status") },
      { id: "hasSalaryProfile", label: t("employees.columns.hasSalaryProfile") },
      ...(taxCodeMasked ? [] : [{ id: "taxCode", label: t("employees.columns.taxCode") }]),
    ],
    [t, taxCodeMasked],
  );
  const columnPrefs = useColumnVisibility("payroll.employees", columnOptions);

  if (!canView) return <EmptyState title={t("employees.noPermission")} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("employees.title")}
        description={t("employees.description")}
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

      <DataToolbar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          resetPage();
        }}
        searchPlaceholder={t("employees.searchPlaceholder")}
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
        <UnitSelector
          className="w-56"
          value={orgUnitId}
          onChange={(id) => {
            setOrgUnitId(id);
            resetPage();
          }}
        />
        <Select
          className="w-52"
          value={profileFilter}
          onChange={(e) => {
            setProfileFilter(e.target.value as ProfileFilter);
            resetPage();
          }}
          aria-label={t("employees.filterProfile")}
        >
          <option value="">{t("employees.filterProfileAll")}</option>
          <option value="true">{t("employees.filterProfileHas")}</option>
          <option value="false">{t("employees.filterProfileMissing")}</option>
        </Select>
        <Select
          className="w-64"
          value={insuranceFilter}
          onChange={(e) => {
            setInsuranceFilter(e.target.value as InsuranceFilter);
            resetPage();
          }}
          aria-label={t("employees.filterInsurance")}
        >
          <option value="">{t("employees.filterInsuranceAll")}</option>
          {payrollInsuranceIssueEnum.options.map((issue) => (
            <option key={issue} value={issue}>
              {t(`employees.insuranceIssue.${issue}`)}
            </option>
          ))}
        </Select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setOrgUnitId("");
              setProfileFilter("");
              setInsuranceFilter("");
              resetPage();
            }}
          >
            {t("employees.clearFilters")}
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
          onRowClick={(row) => onOpenEmployee(row.userId)}
          emptyState={
            <EmptyState title={hasFilters ? t("employees.emptyFiltered") : t("employees.empty")} />
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
                resetPage();
              }}
            />
          }
        />
      )}
    </div>
  );
}
