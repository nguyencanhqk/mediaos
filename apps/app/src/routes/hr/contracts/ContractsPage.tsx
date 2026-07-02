/**
 * ContractsPage — /hr/contracts (S2-FE-HR-7). Danh sách hợp đồng lao động toàn công ty theo data-scope
 * (Own/Team/Company — server áp qua DataScopeService, S2-HR-BE-6 FIX 2026-07-02). Đọc-chỉ; CRUD nằm ở
 * /hr/employees/:id/contracts (EmployeeContractsPage).
 *
 * Nối GET /hr/contracts (contract.controller.ts). BE trả `paginated(data, pagination)` → interceptor hoist
 * `pagination` lên top-level nhưng apiFetch chỉ trích `.data` (bare array) → phân trang client dùng
 * heuristic prev/next (items.length === limit ⇒ còn trang sau), giống pattern LoginLogsPage.
 *
 * PermissionGate: useCan('view','contract'). States: loading/error/empty/forbidden.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { FileText, RefreshCw, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import type { EmployeeContractDto, ContractStatus } from "@mediaos/contracts";
import { contractsApi, hrKeys, useCan } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Input, Select, Badge } from "@mediaos/ui";
import { ContractStatusBadge } from "./ContractStatusBadge";
import {
  CONTRACT_ENGINE_PAIRS,
  CONTRACT_PATHS,
  CONTRACT_STATUSES,
  CONTRACT_PAGE_SIZE,
} from "./constants";
import "./contracts-i18n";

function useColumns(
  t: ReturnType<typeof useTranslation<"hr">>["t"],
  onViewEmployee: (employeeId: string) => void,
): ColumnDef<EmployeeContractDto>[] {
  return [
    {
      accessorKey: "contractCode",
      header: t("contracts.columns.code"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.contractCode ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "title",
      header: t("contracts.columns.title"),
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.title ?? "—"}</span>,
    },
    {
      accessorKey: "startDate",
      header: t("contracts.columns.startDate"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.startDate}</span>,
    },
    {
      accessorKey: "endDate",
      header: t("contracts.columns.endDate"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.endDate ?? "—"}</span>
      ),
    },
    {
      accessorKey: "status",
      header: t("contracts.columns.status"),
      cell: ({ row }) => <ContractStatusBadge status={row.original.status} />,
    },
    {
      id: "expiring",
      header: t("contracts.columns.expiring"),
      cell: ({ row }) =>
        row.original.expiringSoon ? (
          <Badge variant="warning">{t("contracts.expiringSoon")}</Badge>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      id: "actions",
      header: t("contracts.columns.actions"),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onViewEmployee(row.original.employeeId)}
          aria-label={t("contracts.viewEmployeeContracts")}
        >
          <ExternalLink className="mr-1 h-3.5 w-3.5" />
          {t("contracts.viewEmployeeContracts")}
        </Button>
      ),
    },
  ];
}

export function ContractsPage() {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const canView = useCan(
    CONTRACT_ENGINE_PAIRS.VIEW.action,
    CONTRACT_ENGINE_PAIRS.VIEW.resourceType,
  );

  const [page, setPage] = useState(1);
  const [employeeId, setEmployeeId] = useState("");
  const [status, setStatus] = useState<ContractStatus | "">("");
  const [expiringOnly, setExpiringOnly] = useState(false);

  const queryParams = {
    page,
    limit: CONTRACT_PAGE_SIZE,
    employeeId: employeeId.trim() || undefined,
    status: status || undefined,
    expiringOnly: expiringOnly || undefined,
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: hrKeys.contracts.list(queryParams),
    queryFn: () => contractsApi.listContracts(queryParams),
    enabled: canView,
    staleTime: 30_000,
  });

  const columns = useColumns(
    t,
    (id) => void navigate({ to: CONTRACT_PATHS.EMPLOYEE_CONTRACTS(id) as "/" }),
  );

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("contracts.forbidden.title")}
          description={t("contracts.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("contracts.title")}
          description={t("contracts.description")}
          icon={FileText}
        />
        <div className="mt-8">
          <EmptyState
            title={t("contracts.error.title")}
            description={t("contracts.error.description")}
            action={
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const items = data ?? [];
  const hasPrev = page > 1;
  const hasNext = items.length === CONTRACT_PAGE_SIZE;

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={t("contracts.title")}
        description={t("contracts.description")}
        icon={FileText}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder={t("contracts.filters.employeeIdPlaceholder")}
            value={employeeId}
            onChange={(e) => {
              setEmployeeId(e.target.value);
              setPage(1);
            }}
            className="w-64"
            aria-label={t("contracts.filters.employeeId")}
          />
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ContractStatus | "");
              setPage(1);
            }}
            className="w-44"
            aria-label={t("contracts.filters.status")}
          >
            <option value="">{t("contracts.filters.allStatuses")}</option>
            {CONTRACT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`contracts.status.${s}`, { defaultValue: s })}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={expiringOnly}
              onChange={(e) => {
                setExpiringOnly(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-border"
            />
            {t("contracts.filters.expiringOnly")}
          </label>
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("contracts.empty.title")}
            description={t("contracts.empty.description")}
          />
        }
        pageSize={CONTRACT_PAGE_SIZE}
      />

      {!isLoading && (hasPrev || hasNext) && (
        <div className="flex items-center justify-end gap-3 px-1 text-sm text-muted-foreground">
          <span>{page}</span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label={tc("pagination.prev")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              aria-label={tc("pagination.next")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
