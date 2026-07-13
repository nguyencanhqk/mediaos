/**
 * ProjectProgressCard — báo cáo tổng hợp dự án trong ProjectDetailPage (S4-FE-TASK-4, SPEC-06 §16.1).
 * Nối GET /projects/:id/report (S4-TASK-BE-5, PR #184) — countsByStatus (5 cột task_status) + overdueCount +
 * assigneeWorkload (top-N tải công việc ACTIVE theo người phụ trách chính).
 *
 * KHÁC `ProjectProgressWidget` (S4-FE-DASH-2, GET /dashboard/widgets/project-progress — chỉ
 * summary{total,done,percent}+byStatus, gate read:project): card này là báo cáo NHẠY CẢM riêng
 * (view-report:project, is_sensitive=true, seed 0485) — thêm overdueCount + workload theo người phụ trách,
 * dùng useCanExact fail-closed (mirror ExportEmployeesButton — KHÔNG useCan wildcard-aware, tránh
 * FE-permit/BE-403 mismatch). Thiếu cap exact → component KHÔNG render (KHÔNG fetch).
 *
 * Masking là việc của SERVER — component chỉ render field ProjectReportDto trả về.
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { taskProjectApi, taskKeys, useCanExact } from "@mediaos/web-core";
import { Badge, Button, Card, EmptyState } from "@mediaos/ui";
import type { ProjectReportCountsByStatusDto } from "@mediaos/contracts";
import { PROJECT_REPORT_PAIR } from "./task-file-constants";

const STATUS_ORDER: Array<keyof ProjectReportCountsByStatusDto> = [
  "Todo",
  "In Progress",
  "In Review",
  "Done",
  "Cancelled",
];

export interface ProjectProgressCardProps {
  projectId: string;
}

export function ProjectProgressCard({ projectId }: ProjectProgressCardProps) {
  const { t } = useTranslation("tasks");
  const canView = useCanExact(PROJECT_REPORT_PAIR.action, PROJECT_REPORT_PAIR.resourceType);

  const query = useQuery({
    queryKey: taskKeys.projects.report(projectId),
    queryFn: () => taskProjectApi.getReport(projectId),
    enabled: canView && !!projectId,
    staleTime: 30_000,
  });

  // Cặp NHẠY CẢM — thiếu cap exact (view-report:project) → KHÔNG render (KHÔNG fetch). Server vẫn 403
  // nếu bị gọi trực tiếp.
  if (!canView) return null;

  if (query.isLoading) {
    return (
      <Card className="space-y-3 p-4" data-testid="project-report-loading">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded bg-muted" />
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {t("projects.detail.report.title")}
        </h3>
        <EmptyState
          title={t("projects.detail.report.error.title")}
          description={t("projects.detail.report.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          }
        />
      </Card>
    );
  }

  const report = query.data;
  if (!report) return null;

  const total = STATUS_ORDER.reduce((sum, key) => sum + report.countsByStatus[key], 0);

  return (
    <Card className="space-y-4 p-4">
      <h3 className="text-sm font-semibold text-muted-foreground">
        {t("projects.detail.report.title")}
      </h3>

      {total === 0 ? (
        <EmptyState
          title={t("projects.detail.report.empty.title")}
          description={t("projects.detail.report.empty.description")}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_ORDER.map((status) => (
              <div
                key={status}
                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs"
              >
                <span className="text-muted-foreground">{t(`tasks.status.${status}`)}</span>
                <span className="font-semibold text-foreground tabular-nums">
                  {report.countsByStatus[status]}
                </span>
              </div>
            ))}
            <Badge variant={report.overdueCount > 0 ? "danger" : "muted"}>
              {t("projects.detail.report.overdueCount", { count: report.overdueCount })}
            </Badge>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              {t("projects.detail.report.workloadTitle")}
            </p>
            {report.assigneeWorkload.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("projects.detail.report.workloadEmpty")}
              </p>
            ) : (
              <ul className="space-y-1">
                {report.assigneeWorkload.map((w) => (
                  <li
                    key={w.employeeId}
                    className="flex items-center justify-between text-sm"
                    data-testid="project-report-workload-row"
                  >
                    <span className="text-foreground">
                      {w.employeeName ?? t("projects.detail.report.unknownEmployee")}
                    </span>
                    <span className="font-medium tabular-nums text-muted-foreground">
                      {t("projects.detail.report.activeCount", { count: w.activeCount })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
