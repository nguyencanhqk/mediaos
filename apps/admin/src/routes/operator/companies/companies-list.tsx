import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CompanyStatus, CompanySummaryDto } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PermissionGate } from "@/components/permission-gate";
import { useCan } from "@/hooks/use-can";
import { formatDate } from "@/i18n/format";
import { platformCompaniesApi, type ListCompaniesParams } from "@/lib/platform-companies-api";
import { companiesQueryKey } from "./companies-query";
import { CompanyStatusBadge } from "./status-badge";
import { CreateCompanyDialog } from "./create-company-dialog";
import { ConfigureCompanyDialog } from "./configure-company-dialog";
import { SuspendCompanyDialog } from "./suspend-company-dialog";
import { ChangePlanDialog } from "./change-plan-dialog";

const PAGE_SIZE = 20;
const STATUS_OPTIONS: CompanyStatus[] = ["active", "suspended", "provisioning"];

/**
 * Trang Operator — Companies & Billing (AC-1). List + filter + create/suspend/configure/change-plan.
 *
 * Permission (server ép; FE chỉ ẩn UI):
 *   - read         → `view:platform-company`
 *   - create/suspend/configure → `manage:platform-company`
 *   - change-plan  → `manage:platform-subscription`
 */
export function CompaniesListPage() {
  const { t } = useTranslation("operator-companies");
  const canManageCompany = useCan("manage", "platform-company");
  const canManagePlan = useCan("manage", "platform-subscription");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CompanyStatus | "">("");
  const [page, setPage] = useState(1);

  // Dialog state — null = đóng. Create là boolean (không gắn 1 row cụ thể).
  const [createOpen, setCreateOpen] = useState(false);
  const [configureTarget, setConfigureTarget] = useState<CompanySummaryDto | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<CompanySummaryDto | null>(null);
  const [planTarget, setPlanTarget] = useState<CompanySummaryDto | null>(null);

  const params: ListCompaniesParams = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
    }),
    [page, statusFilter, search],
  );

  const query = useQuery({
    queryKey: companiesQueryKey(params),
    queryFn: () => platformCompaniesApi.list(params),
  });

  const showRowActions = canManageCompany || canManagePlan;

  const columns: ColumnDef<CompanySummaryDto>[] = useMemo(() => {
    const base: ColumnDef<CompanySummaryDto>[] = [
      { accessorKey: "name", header: t("table.name") },
      {
        accessorKey: "slug",
        header: t("table.slug"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.slug}</span>,
      },
      {
        accessorKey: "status",
        header: t("table.status"),
        cell: ({ row }) => <CompanyStatusBadge status={row.original.status} />,
      },
      { accessorKey: "timezone", header: t("table.timezone") },
      { accessorKey: "currency", header: t("table.currency") },
      {
        accessorKey: "createdAt",
        header: t("table.createdAt"),
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
    ];

    if (!showRowActions) return base;

    base.push({
      id: "actions",
      header: t("table.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1.5">
          <PermissionGate action="manage" resourceType="platform-company">
            <Button variant="outline" size="sm" onClick={() => setConfigureTarget(row.original)}>
              {t("actions.configure")}
            </Button>
            {row.original.status !== "suspended" && (
              <Button variant="outline" size="sm" onClick={() => setSuspendTarget(row.original)}>
                {t("actions.suspend")}
              </Button>
            )}
          </PermissionGate>
          <PermissionGate action="manage" resourceType="platform-subscription">
            <Button variant="outline" size="sm" onClick={() => setPlanTarget(row.original)}>
              {t("actions.changePlan")}
            </Button>
          </PermissionGate>
        </div>
      ),
    });
    return base;
  }, [t, showRowActions]);

  const items = query.data?.items ?? [];
  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / PAGE_SIZE)) : 1;
  const isEmpty = !query.isLoading && !query.isError && items.length === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <PermissionGate action="manage" resourceType="platform-company">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("actions.create")}
          </Button>
        </PermissionGate>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          placeholder={t("filters.searchPlaceholder")}
          aria-label={t("filters.searchPlaceholder")}
        />
        <Select
          className="max-w-[200px]"
          value={statusFilter}
          onChange={(e) => {
            setPage(1);
            setStatusFilter(e.target.value as CompanyStatus | "");
          }}
          aria-label={t("filters.statusLabel")}
        >
          <option value="">{t("filters.statusAll")}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      {query.isError ? (
        <div role="alert" aria-live="assertive" className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
          <p className="text-sm text-destructive">{t("error.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t("common:actions.retry")}
          </Button>
        </div>
      ) : isEmpty ? (
        <EmptyState
          icon={Building2}
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            <PermissionGate action="manage" resourceType="platform-company">
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" aria-hidden="true" />
                {t("actions.create")}
              </Button>
            </PermissionGate>
          }
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={items}
            loading={query.isLoading}
            pagination={false}
            emptyMessage={t("empty.title")}
          />
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || query.isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t("common:pagination.prev")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || query.isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("common:pagination.next")}
              </Button>
            </div>
          )}
        </>
      )}

      <CreateCompanyDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <ConfigureCompanyDialog company={configureTarget} onClose={() => setConfigureTarget(null)} />
      <SuspendCompanyDialog company={suspendTarget} onClose={() => setSuspendTarget(null)} />
      <ChangePlanDialog company={planTarget} onClose={() => setPlanTarget(null)} />
    </div>
  );
}
