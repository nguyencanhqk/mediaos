import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { CalendarDays, PlusCircle, RefreshCw } from "lucide-react";
import type { LeaveRequestListItemView, LeaveTypeView } from "@mediaos/contracts";
import { leaveApi, leaveKeys, useCan } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Select, Badge } from "@mediaos/ui";
import { LEAVE_ENGINE_PAIRS, LEAVE_PATHS, LEAVE_STATUS } from "./constants";

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  [LEAVE_STATUS.DRAFT]: "secondary",
  [LEAVE_STATUS.PENDING]: "default",
  [LEAVE_STATUS.APPROVED]: "default",
  [LEAVE_STATUS.REJECTED]: "destructive",
  [LEAVE_STATUS.CANCELLED]: "outline",
  [LEAVE_STATUS.REVOKED]: "destructive",
};

function LeaveStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("leave");
  const label = t(`status.${status}`, { defaultValue: status });
  const variant = STATUS_VARIANT[status] ?? "secondary";
  return <Badge variant={variant}>{label}</Badge>;
}

// ── Date range display ────────────────────────────────────────────────────────

function DateRange({ start, end }: { start: string; end: string }) {
  if (start === end) return <span className="text-sm">{start}</span>;
  return (
    <span className="text-sm">
      {start} → {end}
    </span>
  );
}

// ── Column definitions ────────────────────────────────────────────────────────

function useColumns(
  t: ReturnType<typeof useTranslation<"leave">>["t"],
  onView: (id: string) => void,
): ColumnDef<LeaveRequestListItemView>[] {
  return [
    {
      accessorKey: "leaveTypeName",
      header: t("myRequests.columns.leaveType"),
      cell: ({ row }) => (
        <span className="text-sm font-medium">{row.original.leaveTypeName ?? "—"}</span>
      ),
    },
    {
      id: "period",
      header: t("myRequests.columns.period"),
      cell: ({ row }) => <DateRange start={row.original.startDate} end={row.original.endDate} />,
    },
    {
      accessorKey: "totalDays",
      header: t("myRequests.columns.days"),
      cell: ({ row }) => <span className="text-sm">{row.original.totalDays}</span>,
    },
    {
      accessorKey: "status",
      header: t("myRequests.columns.status"),
      cell: ({ row }) => <LeaveStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "submittedAt",
      header: t("myRequests.columns.submittedAt"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.submittedAt
            ? new Date(row.original.submittedAt).toLocaleDateString("vi-VN")
            : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: t("myRequests.columns.actions"),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onView(row.original.id)}
          aria-label={t("myRequests.actions.view")}
        >
          {t("myRequests.actions.view")}
        </Button>
      ),
    },
  ];
}

// ── Status filter options ─────────────────────────────────────────────────────

const STATUS_OPTIONS = Object.values(LEAVE_STATUS);

// ── Main component ────────────────────────────────────────────────────────────

export function MyLeaveRequestsPage() {
  const { t } = useTranslation("leave");
  const navigate = useNavigate();
  const canView = useCan(
    LEAVE_ENGINE_PAIRS.VIEW_OWN_REQUEST.action,
    LEAVE_ENGINE_PAIRS.VIEW_OWN_REQUEST.resourceType,
  );
  const canCreate = useCan(
    LEAVE_ENGINE_PAIRS.CREATE_REQUEST.action,
    LEAVE_ENGINE_PAIRS.CREATE_REQUEST.resourceType,
  );

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");

  const queryParams = {
    page,
    pageSize: 20,
    ...(status ? { status } : {}),
    ...(leaveTypeId ? { leaveTypeId } : {}),
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: leaveKeys.requests.my(queryParams),
    queryFn: () => leaveApi.listMyRequests(queryParams),
    enabled: canView,
    staleTime: 30_000,
  });

  // Leave types for filter dropdown
  const { data: leaveTypes } = useQuery({
    queryKey: leaveKeys.types.list(),
    queryFn: () => leaveApi.listTypes(),
    staleTime: 5 * 60_000,
    enabled: canView,
  });

  const columns = useColumns(t, (id) => void navigate({ to: LEAVE_PATHS.DETAIL(id) as "/" }));

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("myRequests.forbidden.title")}
          description={t("myRequests.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("myRequests.error.title")}
          description={t("myRequests.error.description")}
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
        title={t("myRequests.title")}
        description={t("myRequests.description")}
        icon={CalendarDays}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => void navigate({ to: LEAVE_PATHS.CREATE as "/" })}>
              <PlusCircle className="mr-2 h-4 w-4" />
              {t("myRequests.newRequest")}
            </Button>
          ) : undefined
        }
      >
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Leave type filter */}
          <Select
            value={leaveTypeId}
            onChange={(e) => {
              setLeaveTypeId(e.target.value);
              setPage(1);
            }}
            className="w-44"
            aria-label={t("myRequests.filters.allTypes")}
          >
            <option value="">{t("myRequests.filters.allTypes")}</option>
            {(leaveTypes ?? []).map((lt: LeaveTypeView) => (
              <option key={lt.id} value={lt.id}>
                {lt.name}
              </option>
            ))}
          </Select>

          {/* Status filter */}
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-44"
            aria-label={t("myRequests.filters.allStatuses")}
          >
            <option value="">{t("myRequests.filters.allStatuses")}</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
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
            title={t("myRequests.empty.title")}
            description={t("myRequests.empty.description")}
            action={
              canCreate ? (
                <Button size="sm" onClick={() => void navigate({ to: LEAVE_PATHS.CREATE as "/" })}>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  {t("myRequests.newRequest")}
                </Button>
              ) : undefined
            }
          />
        }
        pageSize={meta?.pageSize ?? 20}
      />

      {/* Pagination */}
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
