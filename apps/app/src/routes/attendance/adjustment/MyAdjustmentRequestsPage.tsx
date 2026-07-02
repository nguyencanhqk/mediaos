/**
 * MyAdjustmentRequestsPage — đơn điều chỉnh công của tôi (ATT-SCREEN-007, S3-FE-ATT-3).
 *
 * KHÔNG gate useCan('view-own','adjustment') — cặp sensitive KHÔNG nằm trong
 * SENSITIVE_CAPABILITY_ALLOWLIST → luôn false nếu dùng → mọi user bị chặn oan (xem constants.ts).
 * Server là cổng thật: render list vô điều kiện, 403 từ query error → forbidden EmptyState.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { ClipboardList, Plus, RefreshCw } from "lucide-react";
import type { AttendanceAdjustmentListItem } from "@mediaos/contracts";
import { ApiError, formatDateTime } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Select } from "@mediaos/ui";
import { AdjustmentStatusBadge } from "./AdjustmentStatusBadge";
import { useMyAdjustmentRequests } from "./hooks/useAdjustmentRequests";
import {
  ADJUSTMENT_STATUS,
  ADJUSTMENT_REQUEST_TYPE_LABEL_KEYS,
  ADJUSTMENT_PAGE_SIZE,
} from "./constants";
import { ATT_PATHS } from "../constants";

function useColumns(
  t: ReturnType<typeof useTranslation<"attendance">>["t"],
  onView: (id: string) => void,
): ColumnDef<AttendanceAdjustmentListItem>[] {
  return [
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
      accessorKey: "reason",
      header: t("adjustment.columns.reason"),
      cell: ({ row }) => (
        <span className="line-clamp-1 max-w-xs text-sm text-muted-foreground">
          {row.original.reason}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: t("adjustment.columns.status"),
      cell: ({ row }) => <AdjustmentStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "submittedAt",
      header: t("adjustment.columns.submittedAt"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.submittedAt ? formatDateTime(row.original.submittedAt) : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: t("adjustment.columns.actions"),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onView(row.original.id)}
          aria-label={t("adjustment.columns.actions")}
        >
          {t("adjustment.columns.view")}
        </Button>
      ),
    },
  ];
}

const STATUS_OPTIONS = Object.values(ADJUSTMENT_STATUS);

export function MyAdjustmentRequestsPage() {
  const { t } = useTranslation("attendance");
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("");
  const [requestType, setRequestType] = useState<string>("");

  const queryParams = {
    page,
    pageSize: ADJUSTMENT_PAGE_SIZE,
    ...(status
      ? { status: status as (typeof ADJUSTMENT_STATUS)[keyof typeof ADJUSTMENT_STATUS] }
      : {}),
    ...(requestType
      ? { requestType: requestType as (typeof ADJUSTMENT_REQUEST_TYPE_LABEL_KEYS)[number] }
      : {}),
  };

  const { data, isLoading, isError, error, refetch } = useMyAdjustmentRequests(queryParams);

  const columns = useColumns(
    t,
    (id) => void navigate({ to: ATT_PATHS.ADJUSTMENT_DETAIL(id) as "/" }),
  );

  const isForbidden = isError && error instanceof ApiError && error.status === 403;

  if (isForbidden) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("adjustment.forbidden.title")}
          description={t("adjustment.forbidden.description")}
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
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
      </div>
    );
  }

  const items = data?.items ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("adjustment.myTitle")}
        description={t("adjustment.myDescription")}
        icon={ClipboardList}
        actions={
          <Button size="sm" onClick={() => void navigate({ to: ATT_PATHS.ADJUSTMENT_NEW as "/" })}>
            <Plus className="mr-2 h-4 w-4" />
            {t("adjustment.actions.create")}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={requestType}
            onChange={(e) => {
              setRequestType(e.target.value);
              setPage(1);
            }}
            className="w-52"
            aria-label={t("adjustment.filters.allTypes")}
            data-testid="filter-request-type"
          >
            <option value="">{t("adjustment.filters.allTypes")}</option>
            {ADJUSTMENT_REQUEST_TYPE_LABEL_KEYS.map((rt) => (
              <option key={rt} value={rt}>
                {t(`adjustment.requestType.${rt}`)}
              </option>
            ))}
          </Select>

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
    </div>
  );
}
