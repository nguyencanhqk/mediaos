/**
 * RemoteWorkRequestsPage — /attendance/remote-work-requests (S3-FE-ATT-4, ATT-SCREEN-012..014).
 * Tabs theo scope (Của tôi / Nhóm / Công ty) — chỉ hiện tab caller có quyền (pair-as-gate, mỗi
 * scope-level là 1 cặp RIÊNG, KHÔNG suy quyền từ scope khác). Mặc định chọn scope RỘNG NHẤT có quyền.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { Plane, Plus, RefreshCw } from "lucide-react";
import type { RemoteWorkRequestDetail, RemoteRequestStatus } from "@mediaos/contracts";
import { useCan, useCanExact } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Select, Badge } from "@mediaos/ui";
import {
  useMyRemoteWorkRequests,
  useTeamRemoteWorkRequests,
  useCompanyRemoteWorkRequests,
} from "../hooks/useRemoteWorkRequests";
import {
  ATT_ENGINE_PAIRS,
  ATT_PATHS,
  REMOTE_REQUEST_STATUS,
  ATT_RECORDS_PAGE_SIZE,
} from "../constants";

type Scope = "my" | "team" | "company";

const STATUS_VARIANT: Record<RemoteRequestStatus, "secondary" | "default" | "success" | "danger"> =
  {
    Draft: "secondary",
    Pending: "default",
    Approved: "success",
    Rejected: "danger",
    Cancelled: "secondary",
  };

function useColumns(
  t: ReturnType<typeof useTranslation<"attendance">>["t"],
  onView: (id: string) => void,
): ColumnDef<RemoteWorkRequestDetail>[] {
  return [
    {
      accessorKey: "requestCode",
      header: t("remoteWork.columns.code"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.requestCode ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "fullName",
      header: t("remoteWork.columns.employee"),
      cell: ({ row }) => (
        <span className="text-sm font-medium">{row.original.fullName ?? "—"}</span>
      ),
    },
    {
      accessorKey: "requestType",
      header: t("remoteWork.columns.type"),
      cell: ({ row }) => (
        <span className="text-sm">
          {t(`remoteWork.requestType.${row.original.requestType}`, {
            defaultValue: row.original.requestType,
          })}
        </span>
      ),
    },
    {
      id: "period",
      header: t("remoteWork.columns.period"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.startDate === row.original.endDate
            ? row.original.startDate
            : `${row.original.startDate} → ${row.original.endDate}`}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: t("remoteWork.columns.status"),
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANT[row.original.status]}>
          {t(`remoteWork.status.${row.original.status}`, { defaultValue: row.original.status })}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: t("remoteWork.columns.actions"),
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => onView(row.original.id)}>
          {t("remoteWork.actions.view")}
        </Button>
      ),
    },
  ];
}

export function RemoteWorkRequestsPage() {
  const { t } = useTranslation("attendance");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();

  const canCreate = useCan(
    ATT_ENGINE_PAIRS.REMOTE_CREATE_OWN.action,
    ATT_ENGINE_PAIRS.REMOTE_CREATE_OWN.resourceType,
  );
  const canViewOwn = useCanExact(
    ATT_ENGINE_PAIRS.REMOTE_VIEW_OWN.action,
    ATT_ENGINE_PAIRS.REMOTE_VIEW_OWN.resourceType,
  );
  const canViewTeam = useCanExact(
    ATT_ENGINE_PAIRS.REMOTE_VIEW_TEAM.action,
    ATT_ENGINE_PAIRS.REMOTE_VIEW_TEAM.resourceType,
  );
  const canViewCompany = useCanExact(
    ATT_ENGINE_PAIRS.REMOTE_VIEW_COMPANY.action,
    ATT_ENGINE_PAIRS.REMOTE_VIEW_COMPANY.resourceType,
  );

  const defaultScope: Scope | null = canViewCompany
    ? "company"
    : canViewTeam
      ? "team"
      : canViewOwn
        ? "my"
        : null;
  const [scope, setScope] = useState<Scope | null>(defaultScope);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<RemoteRequestStatus | "">("");

  const queryParams = useMemo(
    () => ({ page, pageSize: ATT_RECORDS_PAGE_SIZE, status: status || undefined }),
    [page, status],
  );

  const myQuery = useMyRemoteWorkRequests(queryParams, scope === "my");
  const teamQuery = useTeamRemoteWorkRequests(queryParams, scope === "team");
  const companyQuery = useCompanyRemoteWorkRequests(queryParams, scope === "company");

  const activeQuery = scope === "team" ? teamQuery : scope === "company" ? companyQuery : myQuery;
  const columns = useColumns(
    t,
    (id) => void navigate({ to: ATT_PATHS.REMOTE_WORK_REQUEST_DETAIL(id) as "/" }),
  );

  if (!scope) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("remoteWork.forbidden.title")}
          description={t("remoteWork.forbidden.description")}
        />
      </div>
    );
  }

  if (activeQuery.isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("remoteWork.title")}
          description={t("remoteWork.description")}
          icon={Plane}
        />
        <div className="mt-8">
          <EmptyState
            title={t("remoteWork.error.title")}
            description={t("remoteWork.error.description")}
            action={
              <Button variant="outline" size="sm" onClick={() => void activeQuery.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const items = activeQuery.data?.items ?? [];
  const meta = activeQuery.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={t("remoteWork.title")}
        description={t("remoteWork.description")}
        icon={Plane}
        actions={
          canCreate ? (
            <Button
              size="sm"
              onClick={() => void navigate({ to: ATT_PATHS.REMOTE_WORK_REQUEST_NEW as "/" })}
              data-testid="remote-work-create-btn"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("remoteWork.actions.create")}
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-md border border-border p-0.5">
            {canViewOwn && (
              <ScopeTabButton active={scope === "my"} onClick={() => setScope("my")}>
                {t("remoteWork.scopeTabs.my")}
              </ScopeTabButton>
            )}
            {canViewTeam && (
              <ScopeTabButton active={scope === "team"} onClick={() => setScope("team")}>
                {t("remoteWork.scopeTabs.team")}
              </ScopeTabButton>
            )}
            {canViewCompany && (
              <ScopeTabButton active={scope === "company"} onClick={() => setScope("company")}>
                {t("remoteWork.scopeTabs.company")}
              </ScopeTabButton>
            )}
          </div>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as RemoteRequestStatus | "");
              setPage(1);
            }}
            className="w-44"
          >
            <option value="">{t("remoteWork.filters.allStatuses")}</option>
            {Object.values(REMOTE_REQUEST_STATUS).map((s) => (
              <option key={s} value={s}>
                {t(`remoteWork.status.${s}`, { defaultValue: s })}
              </option>
            ))}
          </Select>
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={activeQuery.isLoading}
        emptyState={
          <EmptyState
            title={t("remoteWork.empty.title")}
            description={t("remoteWork.empty.description")}
          />
        }
        pageSize={ATT_RECORDS_PAGE_SIZE}
      />

      {!activeQuery.isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
          <span>
            {page} / {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!meta?.hasPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {tc("pagination.prev")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!meta?.hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              {tc("pagination.next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScopeTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded px-3 py-1 text-sm font-medium transition-colors",
        active
          ? "bg-brand-muted font-semibold text-brand"
          : "text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
