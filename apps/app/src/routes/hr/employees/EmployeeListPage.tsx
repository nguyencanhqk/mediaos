import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Users, RefreshCw, Eye, EyeOff, List, LayoutPanelLeft } from "lucide-react";
import { hrApi, hrKeys, useCan, PermissionGate } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Input, Select, cn } from "@mediaos/ui";
import { useLocalPref } from "@/hooks/use-local-pref";
import { HR_ENGINE_PAIRS } from "../constants";
import { useEmployeeListFilters } from "./use-employee-list-filters";
import { EmployeeOverviewStrip } from "./employee-overview";
import { EMPLOYEE_COLUMN_CATALOG, buildEmployeeColumns } from "./employee-table-columns";
import { useColumnSettings } from "./use-column-settings";
import { ColumnSettingsPopover } from "./column-settings-popover";
import { EmployeeSplitView } from "./employee-split-view";

/**
 * HR-PROFILE-UI-1 — trang Hồ sơ nhân sự nâng cấp:
 * dải tổng quan (ẩn/hiện) · 2 chế độ xem (bảng ⇄ chi tiết) · tìm kiếm/lọc · tùy chỉnh cột.
 * Mọi dữ liệu đã scope + mask ở SERVER; preference hiển thị lưu localStorage.
 */

type ViewMode = "table" | "split";

// ---------------------------------------------------------------------------
// Department filter (giữ từ bản cũ)
// ---------------------------------------------------------------------------
function DepartmentFilter({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  t: ReturnType<typeof useTranslation<"hr">>["t"];
}) {
  const { data: departments } = useQuery({
    queryKey: hrKeys.departments.list(),
    queryFn: () => hrApi.listDepartments(),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-44">
      <option value="">{t("employees.allDepartments")}</option>
      {departments?.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </Select>
  );
}

const STATUS_OPTIONS = [
  { value: "active", labelKey: "status.active" },
  { value: "inactive", labelKey: "status.inactive" },
  { value: "resigned", labelKey: "status.resigned" },
  { value: "terminated", labelKey: "status.terminated" },
] as const;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function EmployeeListPage() {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const { action, resourceType } = HR_ENGINE_PAIRS.READ_EMPLOYEE;
  const canView = useCan(action, resourceType);
  const canViewSensitive = useCan(
    HR_ENGINE_PAIRS.VIEW_SENSITIVE.action,
    HR_ENGINE_PAIRS.VIEW_SENSITIVE.resourceType,
  );

  const { search, setSearch, deptId, setDeptId, status, setStatus, queryParams } =
    useEmployeeListFilters();
  const [page, setPage] = useState(1);

  // Preference hiển thị (per-user, localStorage)
  const [viewMode, setViewMode] = useLocalPref<ViewMode>("mediaos.hr.employees.view.v1", "table");
  const [overviewVisible, setOverviewVisible] = useLocalPref<boolean>(
    "mediaos.hr.employees.overview.v1",
    true,
  );

  // Catalog cột: bỏ cột PII khỏi cả bảng lẫn panel tùy chỉnh khi thiếu view-sensitive
  // (server đã mask null — lọc để không phơi cột toàn "—").
  const catalog = useMemo(
    () => EMPLOYEE_COLUMN_CATALOG.filter((c) => !c.pii || canViewSensitive),
    [canViewSensitive],
  );
  const { visibility, setVisible, reset } = useColumnSettings(catalog);
  const tableVisibility = useMemo(() => {
    if (canViewSensitive) return visibility;
    const vis = { ...visibility };
    for (const c of EMPLOYEE_COLUMN_CATALOG) {
      if (c.pii) vis[c.id] = false;
    }
    return vis;
  }, [visibility, canViewSensitive]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: hrKeys.employees.list({ ...queryParams, page }),
    queryFn: () => hrApi.listEmployees({ ...queryParams, page }),
    enabled: canView,
    staleTime: 30_000,
    // P1 perf: đổi trang/filter giữ dữ liệu cũ hiển thị trong lúc fetch — không nháy skeleton.
    placeholderData: keepPreviousData,
  });

  const columns = useMemo(() => buildEmployeeColumns(t), [t]);

  const goDetail = (employeeId: string) =>
    void navigate({ to: "/hr/employees/$employeeId", params: { employeeId } });
  const goEdit = (employeeId: string) =>
    void navigate({ to: "/hr/employees/$employeeId/edit", params: { employeeId } });

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("employees.forbidden.title")}
          description={t("employees.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("employees.error.title")}
          description={t("employees.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const items = data?.items ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title={t("employees.title")}
        description={t("employees.description")}
        icon={Users}
        actions={
          <div className="flex items-center gap-2">
            <PermissionGate action="export" resourceType="employee">
              <Button variant="outline" size="sm">
                {t("employees.exportList")}
              </Button>
            </PermissionGate>
            <PermissionGate
              action={HR_ENGINE_PAIRS.CREATE_EMPLOYEE.action}
              resourceType={HR_ENGINE_PAIRS.CREATE_EMPLOYEE.resourceType}
            >
              <Button size="sm" onClick={() => void navigate({ to: "/hr/employees/new" })}>
                {t("employees.addEmployee")}
              </Button>
            </PermissionGate>
          </div>
        }
      />

      {/* Dải tổng quan (ẩn/hiện được) */}
      {overviewVisible && <EmployeeOverviewStrip />}

      {/* Toolbar: search + filter | toggle tổng quan + chế độ xem + tùy chỉnh cột */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder={t("employees.search")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-64"
          />
          <DepartmentFilter
            value={deptId}
            onChange={(v) => {
              setDeptId(v);
              setPage(1);
            }}
            t={t}
          />
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-44"
          >
            <option value="">{t("employees.allStatuses")}</option>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOverviewVisible(!overviewVisible)}
            className="text-brand"
          >
            {overviewVisible ? (
              <EyeOff className="mr-2 h-4 w-4" />
            ) : (
              <Eye className="mr-2 h-4 w-4" />
            )}
            {overviewVisible ? t("employees.overview.hide") : t("employees.overview.show")}
          </Button>

          {/* Toggle bảng ⇄ chi tiết */}
          <div className="flex items-center rounded-md border border-border">
            <button
              type="button"
              onClick={() => setViewMode("table")}
              aria-label={t("employees.view.table")}
              title={t("employees.view.table")}
              className={cn(
                "flex h-8 w-9 items-center justify-center rounded-l-md transition-colors",
                viewMode === "table"
                  ? "bg-brand-muted text-brand"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("split")}
              aria-label={t("employees.view.split")}
              title={t("employees.view.split")}
              className={cn(
                "flex h-8 w-9 items-center justify-center rounded-r-md transition-colors",
                viewMode === "split"
                  ? "bg-brand-muted text-brand"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <LayoutPanelLeft className="h-4 w-4" />
            </button>
          </div>

          {viewMode === "table" && (
            <ColumnSettingsPopover
              catalog={catalog}
              visibility={visibility}
              onToggle={setVisible}
              onReset={reset}
            />
          )}
        </div>
      </div>

      {/* Nội dung theo chế độ xem */}
      {viewMode === "table" ? (
        <DataTable
          columns={columns}
          data={items}
          isLoading={isLoading}
          columnVisibility={tableVisibility}
          onRowClick={(row) => goDetail(row.id)}
          emptyState={
            <EmptyState
              title={t("employees.empty.title")}
              description={t("employees.empty.description")}
            />
          }
          pageSize={meta?.pageSize ?? 20}
        />
      ) : (
        <EmployeeSplitView
          items={items}
          isLoading={isLoading}
          onEdit={goEdit}
          onOpenFull={goDetail}
        />
      )}

      {/* Footer: tổng bản ghi + phân trang server */}
      {!isLoading && meta && (
        <div className="flex items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
          <span>{t("employees.totalRecords", { total: meta.total })}</span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!meta.hasPrev}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {tc("pagination.prev")}
              </Button>
              <span>
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!meta.hasNext}
                onClick={() => setPage((p) => p + 1)}
              >
                {tc("pagination.next")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
