/**
 * SystemJobRunsDialog — lịch sử chạy của 1 job (S5-FND-JOBS-OBS-1, READ-ONLY). Mở từ SystemJobsPage khi
 * bấm "Xem lịch sử" trên 1 hàng job. Phân trang page-based (mẫu FileAccessLogsPage/AuthLogPagination —
 * `apiFetch` không giữ block `pagination` hoist ở envelope nên dùng heuristic prev/next, KHÔNG total).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { type SystemJobRunView, useCan } from "@mediaos/web-core";
import { Badge, DataTable, Dialog, EmptyState } from "@mediaos/ui";
import { AuthLogPagination } from "@/routes/system/auth-logs/AuthLogControls";
import { useSystemJobRuns } from "./useSystemJobs";
import { FOUNDATION_ENGINE_PAIRS } from "./constants";
import { formatJobDurationMs, JOB_STATUS_BADGE_VARIANT } from "./system-jobs-format";

const RUNS_PAGE_SIZE = 20;

export interface SystemJobRunsDialogProps {
  jobCode: string;
  onClose: () => void;
}

function useRunsColumns(
  t: ReturnType<typeof useTranslation<"system">>["t"],
): ColumnDef<SystemJobRunView>[] {
  return [
    {
      accessorKey: "startedAt",
      header: t("systemJobs.columns.startedAt"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {new Date(row.original.startedAt).toLocaleString("vi-VN")}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: t("systemJobs.columns.status"),
      cell: ({ row }) => (
        <Badge variant={JOB_STATUS_BADGE_VARIANT[row.original.status]}>
          {t(`systemJobs.status.${row.original.status}` as "systemJobs.status.Success")}
        </Badge>
      ),
    },
    {
      accessorKey: "duration",
      header: t("systemJobs.columns.duration"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{formatJobDurationMs(row.original.durationMs)}</span>
      ),
    },
    {
      accessorKey: "items",
      header: t("systemJobs.columns.items"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {row.original.successItems ?? "—"}/{row.original.totalItems ?? "—"}
          {row.original.failedItems ? ` (${row.original.failedItems} lỗi)` : ""}
        </span>
      ),
    },
    {
      accessorKey: "errorMessage",
      header: t("systemJobs.columns.error"),
      cell: ({ row }) => (
        <span className="line-clamp-2 max-w-xs text-xs text-destructive">
          {row.original.errorMessage ?? "—"}
        </span>
      ),
    },
  ];
}

export function SystemJobRunsDialog({ jobCode, onClose }: SystemJobRunsDialogProps) {
  const { t } = useTranslation("system");
  const canView = useCan(
    FOUNDATION_ENGINE_PAIRS.VIEW_JOB.action,
    FOUNDATION_ENGINE_PAIRS.VIEW_JOB.resourceType,
  );
  const [page, setPage] = useState(1);

  const { data, isLoading } = useSystemJobRuns(jobCode, { page, limit: RUNS_PAGE_SIZE }, canView);
  const columns = useRunsColumns(t);
  const items = data ?? [];

  return (
    <Dialog open onClose={onClose} title={t("systemJobs.history.title", { jobCode })}>
      <div className="space-y-4">
        <DataTable
          columns={columns}
          data={items}
          isLoading={isLoading}
          emptyState={
            <EmptyState
              title={t("systemJobs.history.empty.title")}
              description={t("systemJobs.history.empty.description")}
            />
          }
          pageSize={RUNS_PAGE_SIZE}
        />
        <AuthLogPagination
          page={page}
          currentCount={items.length}
          pageSize={RUNS_PAGE_SIZE}
          onPageChange={setPage}
        />
      </div>
    </Dialog>
  );
}
