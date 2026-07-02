/**
 * AdjustmentRequestsPage — đơn điều chỉnh công cần duyệt (Team/Company, ATT-SCREEN-008, S3-FE-ATT-3).
 *
 * KHÔNG gate useCan('view-team'/'view-company','adjustment') — sensitive KHÔNG allowlisted (constants.ts).
 * Chỉ fetch scope ĐANG active (tránh gọi cả 2 endpoint cùng lúc); mỗi tab tự xử lý 403 riêng (người chỉ có
 * view-team mà thiếu view-company vẫn dùng được tab Team). Duyệt/từ chối thực hiện ở AdjustmentRequestDetailPage
 * (nút "Xem" điều hướng tới đó) — trang này CHỈ đọc danh sách.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, RefreshCw } from "lucide-react";
import type { AttendanceAdjustmentListItem } from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Select } from "@mediaos/ui";
import { AdjustmentStatusBadge } from "./AdjustmentStatusBadge";
import {
  useTeamAdjustmentRequests,
  useCompanyAdjustmentRequests,
} from "./hooks/useAdjustmentRequests";
import { ADJUSTMENT_STATUS, ADJUSTMENT_PAGE_SIZE } from "./constants";
import { ATT_PATHS } from "../constants";

type Scope = "team" | "company";

function RequesterCell({ item }: { item: AttendanceAdjustmentListItem }) {
  return (
    <div className="flex flex-col">
      <span className="text-sm font-medium">{item.fullName ?? "—"}</span>
      <span className="text-xs text-muted-foreground">{item.employeeCode ?? "—"}</span>
    </div>
  );
}

function useColumns(
  t: ReturnType<typeof useTranslation<"attendance">>["t"],
  onView: (id: string) => void,
): ColumnDef<AttendanceAdjustmentListItem>[] {
  return [
    {
      id: "requester",
      header: t("adjustment.columns.requester"),
      cell: ({ row }) => <RequesterCell item={row.original} />,
    },
    {
      accessorKey: "workDate",
      header: t("adjustment.columns.workDate"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.workDate}</span>,
    },
    {
      accessorKey: "requestType",
      header: t("adjustment.columns.requestType"),
      cell: ({ row }) => (
        <span className="text-sm">{t(`adjustment.requestType.${row.original.requestType}`)}</span>
      ),
    },
    {
      accessorKey: "status",
      header: t("adjustment.columns.status"),
      cell: ({ row }) => <AdjustmentStatusBadge status={row.original.status} />,
    },
    {
      id: "actions",
      header: t("adjustment.columns.actions"),
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => onView(row.original.id)}>
          {t("adjustment.columns.view")}
        </Button>
      ),
    },
  ];
}

const STATUS_OPTIONS = Object.values(ADJUSTMENT_STATUS);

export function AdjustmentRequestsPage() {
  const { t } = useTranslation("attendance");
  const navigate = useNavigate();

  const [scope, setScope] = useState<Scope>("team");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>(ADJUSTMENT_STATUS.PENDING);

  const queryParams = {
    page,
    pageSize: ADJUSTMENT_PAGE_SIZE,
    ...(status
      ? { status: status as (typeof ADJUSTMENT_STATUS)[keyof typeof ADJUSTMENT_STATUS] }
      : {}),
  };

  const teamQuery = useTeamAdjustmentRequests(queryParams, scope === "team");
  const companyQuery = useCompanyAdjustmentRequests(queryParams, scope === "company");
  const active = scope === "team" ? teamQuery : companyQuery;
  const { data, isLoading, isError, error, refetch } = active;

  const columns = useColumns(
    t,
    (id) => void navigate({ to: ATT_PATHS.ADJUSTMENT_DETAIL(id) as "/" }),
  );

  function changeScope(next: Scope) {
    setScope(next);
    setPage(1);
  }

  const isForbidden = isError && error instanceof ApiError && error.status === 403;

  const items = data?.items ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("adjustment.manageTitle")}
        description={t("adjustment.manageDescription")}
        icon={CheckCircle2}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-md border border-input">
            <button
              type="button"
              data-testid="scope-team"
              onClick={() => changeScope("team")}
              className={`px-3 py-1.5 text-sm ${scope === "team" ? "bg-primary text-primary-foreground" : "bg-background"}`}
            >
              {t("adjustment.scope.team")}
            </button>
            <button
              type="button"
              data-testid="scope-company"
              onClick={() => changeScope("company")}
              className={`px-3 py-1.5 text-sm ${scope === "company" ? "bg-primary text-primary-foreground" : "bg-background"}`}
            >
              {t("adjustment.scope.company")}
            </button>
          </div>

          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-44"
            aria-label={t("adjustment.filters.allStatuses")}
            data-testid="filter-status"
          >
            <option value="">{t("adjustment.filters.allStatuses")}</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`adjustment.status.${s}`)}
              </option>
            ))}
          </Select>
        </div>
      </PageHeader>

      {isForbidden ? (
        <EmptyState
          title={t("adjustment.forbidden.title")}
          description={t("adjustment.forbidden.description")}
        />
      ) : isError ? (
        <EmptyState
          title={t("adjustment.error.title")}
          description={t("adjustment.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          }
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={items}
            isLoading={isLoading}
            emptyState={
              <EmptyState
                title={t("adjustment.empty.title")}
                description={t("adjustment.empty.description")}
              />
            }
            pageSize={ADJUSTMENT_PAGE_SIZE}
          />

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
        </>
      )}
    </div>
  );
}
