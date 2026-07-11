/**
 * SYSTEM-SCREEN-JOBS (S5-FND-JOBS-OBS-1) — /system/jobs (System Jobs observability, READ-ONLY).
 *
 * GET /foundation/system-jobs → gate view:foundation-job (KHÔNG sensitive). Bảng "1 hàng/job = lần chạy
 * MỚI NHẤT" (job name/trạng thái/bắt đầu/kết thúc/thời lượng/số dòng/lỗi tóm tắt). BẤT BIẾN #2/READ-ONLY:
 * KHÔNG nút trigger/chạy job (BE chỉ có route GET — `run:foundation-job` is_sensitive=true CHƯA có
 * consumer HTTP, out-of-scope). Bấm "Xem lịch sử" mở SystemJobRunsDialog (GET :jobName/runs, phân trang).
 *
 * States: forbidden · loading · error · empty · list.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { History, RefreshCw, Wrench } from "lucide-react";
import { useCan, type SystemJobRunView } from "@mediaos/web-core";
import { Badge, Button, DataTable, EmptyState, PageHeader } from "@mediaos/ui";
import { useSystemJobsSummary } from "./useSystemJobs";
import { FOUNDATION_ENGINE_PAIRS } from "./constants";
import { SystemJobRunsDialog } from "./SystemJobRunsDialog";
import { formatJobDurationMs, JOB_STATUS_BADGE_VARIANT } from "./system-jobs-format";

type TF = ReturnType<typeof useTranslation<"system">>["t"];

function useColumns(
  t: TF,
  onViewHistory: (jobCode: string) => void,
): ColumnDef<SystemJobRunView>[] {
  return [
    {
      accessorKey: "jobCode",
      header: t("systemJobs.columns.jobCode"),
      cell: ({ row }) => (
        <span className="font-mono text-sm font-medium">{row.original.jobCode}</span>
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
      accessorKey: "startedAt",
      header: t("systemJobs.columns.startedAt"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {new Date(row.original.startedAt).toLocaleString("vi-VN")}
        </span>
      ),
    },
    {
      accessorKey: "finishedAt",
      header: t("systemJobs.columns.finishedAt"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {row.original.finishedAt
            ? new Date(row.original.finishedAt).toLocaleString("vi-VN")
            : "—"}
        </span>
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
      accessorKey: "error",
      header: t("systemJobs.columns.error"),
      cell: ({ row }) => (
        <span className="line-clamp-1 max-w-xs text-xs text-destructive">
          {row.original.errorMessage ?? "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: t("systemJobs.actions.columnHeader"),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onViewHistory(row.original.jobCode)}
          data-testid="system-job-history-btn"
        >
          <History className="mr-1 h-3.5 w-3.5" />
          {t("systemJobs.actions.viewHistory")}
        </Button>
      ),
    },
  ];
}

export function SystemJobsPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");

  const canView = useCan(
    FOUNDATION_ENGINE_PAIRS.VIEW_JOB.action,
    FOUNDATION_ENGINE_PAIRS.VIEW_JOB.resourceType,
  );

  const { data, isLoading, isError, refetch } = useSystemJobsSummary(canView);
  const [historyJobCode, setHistoryJobCode] = useState<string | null>(null);

  const columns = useColumns(t, (jobCode) => setHistoryJobCode(jobCode));

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("systemJobs.forbidden.title")}
          description={t("systemJobs.forbidden.description")}
          data-testid="system-jobs-forbidden"
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("systemJobs.title")}
          description={t("systemJobs.description")}
          icon={Wrench}
        />
        <div className="mt-8">
          <EmptyState
            title={t("systemJobs.error.title")}
            description={t("systemJobs.error.description")}
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

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("systemJobs.title")}
        description={t("systemJobs.description")}
        icon={Wrench}
      />

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("systemJobs.empty.title")}
            description={t("systemJobs.empty.description")}
          />
        }
      />

      {historyJobCode && (
        <SystemJobRunsDialog jobCode={historyJobCode} onClose={() => setHistoryJobCode(null)} />
      )}
    </div>
  );
}
