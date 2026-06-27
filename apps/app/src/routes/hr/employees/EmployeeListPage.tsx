import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Users, RefreshCw } from "lucide-react";
import type { HrEmployeeListItem } from "@mediaos/contracts";
import { hrApi, hrKeys, useCan, PermissionGate } from "@mediaos/web-core";
// PermissionGate used for create/export buttons; useCan for list-level gate
import { PageHeader, DataTable, EmptyState, Button, Input, Select } from "@mediaos/ui";
import { HR_ENGINE_PAIRS } from "../constants";
import { EmployeeStatusBadge } from "../employee-status";
import { useEmployeeListFilters } from "./use-employee-list-filters";

// ---------------------------------------------------------------------------
// Column definitions (moved out of component to avoid recreation on render)
// ---------------------------------------------------------------------------
function useEmployeeColumns(
  t: ReturnType<typeof useTranslation<"hr">>["t"],
): ColumnDef<HrEmployeeListItem>[] {
  return [
    {
      accessorKey: "employeeCode",
      header: t("employees.columns.code"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.employeeCode ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "fullName",
      header: t("employees.columns.name"),
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.fullName}</span>
      ),
    },
    {
      accessorKey: "email",
      header: t("employees.columns.email"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.email}</span>
      ),
    },
    {
      accessorKey: "orgUnitName",
      header: t("employees.columns.department"),
      cell: ({ row }) => <span className="text-sm">{row.original.orgUnitName ?? "—"}</span>,
    },
    {
      accessorKey: "positionName",
      header: t("employees.columns.position"),
      cell: ({ row }) => <span className="text-sm">{row.original.positionName ?? "—"}</span>,
    },
    {
      accessorKey: "status",
      header: t("employees.columns.status"),
      cell: ({ row }) => <EmployeeStatusBadge status={row.original.status} />,
    },
  ];
}

// ---------------------------------------------------------------------------
// Department filter
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

// ---------------------------------------------------------------------------
// Status filter options
// ---------------------------------------------------------------------------
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
  const navigate = useNavigate();
  const { action, resourceType } = HR_ENGINE_PAIRS.READ_EMPLOYEE;
  const canView = useCan(action, resourceType);

  const { search, setSearch, deptId, setDeptId, status, setStatus, queryParams } =
    useEmployeeListFilters();

  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: hrKeys.employees.list({ ...queryParams, page }),
    queryFn: () => hrApi.listEmployees({ ...queryParams, page }),
    enabled: canView,
    staleTime: 30_000,
  });

  const columns = useEmployeeColumns(t);

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
              {t("actions.retry", { ns: "common" })}
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
    <div className="space-y-6 p-6">
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
      >
        {/* Toolbar: search + filters */}
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
      </PageHeader>

      {/* Table */}
      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("employees.empty.title")}
            description={t("employees.empty.description")}
          />
        }
        pageSize={meta?.pageSize ?? 20}
      />

      {/* Server-side pagination controls */}
      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
          <span>
            {meta
              ? `${(page - 1) * meta.pageSize + 1}–${Math.min(page * meta.pageSize, meta.total)} / ${meta.total}`
              : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!meta?.hasPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("pagination.prev", { ns: "common" })}
            </Button>
            <span>
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!meta?.hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("pagination.next", { ns: "common" })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
