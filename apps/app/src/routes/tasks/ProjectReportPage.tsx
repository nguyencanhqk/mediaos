import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, RefreshCw } from "lucide-react";
import { taskProjectApi, taskKeys, useCanExact } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, StatCard } from "@mediaos/ui";
import type { ProjectReportCountsByStatusDto } from "@mediaos/contracts";
import { PROJECT_REPORT_PAIR } from "./task-file-constants";

/**
 * ProjectReportPage — TASK-SCREEN-011 "Báo cáo tiến độ dự án" (SPEC-06 §13.11/§16.1, S5-FE-TASK-6).
 *
 * Mở rộng `ProjectProgressCard` (báo cáo nhúng trong ProjectDetailPage) thành TRANG riêng dưới
 * `/tasks/projects/:projectId/report`: hàng KPI tiles (tổng · hoàn thành · chưa hoàn thành · quá hạn)
 * + breakdown theo 5 status + bar tải-công-việc theo người phụ trách. Dữ liệu = `GET /projects/:id/report`
 * (S4-TASK-BE-5) — CÙNG endpoint/DTO với card, KHÔNG thêm endpoint mới.
 *
 * Cổng NHẠY CẢM = `useCanExact(view-report:project)` fail-closed (mirror ProjectProgressCard — KHÔNG
 * useCan wildcard-aware, tránh FE-permit/BE-403 mismatch). Thiếu cap EXACT → trang "forbidden", KHÔNG
 * fetch. Server (`view-report:project`, is_sensitive, seed 0485) vẫn là cổng thật nếu gọi trực tiếp.
 * Masking là việc của SERVER — trang chỉ render field ProjectReportDto trả về.
 *
 * S5-TASK-WORKSPACE-1: phần thân tách thành `ProjectReportContent` — tab "Báo cáo" của workspace dự án
 * mount TRỰC TIẾP content (không back/header); route trang này GIỮ NGUYÊN cho bookmark/deep-link cũ.
 */
const STATUS_ORDER: Array<keyof ProjectReportCountsByStatusDto> = [
  "Todo",
  "In Progress",
  "In Review",
  "Done",
  "Cancelled",
];

/** Thân báo cáo (gate + query + KPI/breakdown/workload) — dùng chung trang riêng + tab workspace. */
export function ProjectReportContent({ projectId }: { projectId: string }) {
  const { t } = useTranslation("tasks");
  const canView = useCanExact(PROJECT_REPORT_PAIR.action, PROJECT_REPORT_PAIR.resourceType);

  const reportQuery = useQuery({
    queryKey: taskKeys.projects.report(projectId),
    queryFn: () => taskProjectApi.getReport(projectId),
    enabled: canView && !!projectId,
    staleTime: 30_000,
  });

  // ── Forbidden (fail-closed) ─────────────────────────────────────────────────
  if (!canView) {
    return (
      <EmptyState
        title={t("projects.report.page.forbidden.title")}
        description={t("projects.report.page.forbidden.description")}
      />
    );
  }

  if (reportQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (reportQuery.isError) {
    return (
      <EmptyState
        title={t("projects.detail.report.error.title")}
        description={t("projects.detail.report.error.description")}
        action={
          <Button variant="outline" size="sm" onClick={() => void reportQuery.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("actions.retry", { ns: "common" })}
          </Button>
        }
      />
    );
  }

  const report = reportQuery.data;
  if (!report) return null;

  const total = STATUS_ORDER.reduce((sum, key) => sum + report.countsByStatus[key], 0);
  const done = report.countsByStatus.Done;
  const notDone =
    report.countsByStatus.Todo +
    report.countsByStatus["In Progress"] +
    report.countsByStatus["In Review"];
  const maxActive = Math.max(1, ...report.assigneeWorkload.map((w) => w.activeCount));

  if (total === 0) {
    return (
      <EmptyState
        title={t("projects.detail.report.empty.title")}
        description={t("projects.detail.report.empty.description")}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI tiles — SPEC-06 §16.1 benchmark: tổng · hoàn thành · chưa hoàn thành · quá hạn */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="project-report-kpi">
        <StatCard tone="blue" label={t("projects.report.page.kpi.total")} value={total} />
        <StatCard tone="emerald" label={t("projects.report.page.kpi.done")} value={done} />
        <StatCard tone="cyan" label={t("projects.report.page.kpi.notDone")} value={notDone} />
        <StatCard
          tone="amber"
          label={t("projects.report.page.kpi.overdue")}
          value={report.overdueCount}
        />
      </div>

      {/* Breakdown theo 5 status (gồm Cancelled) */}
      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {t("projects.report.page.breakdownTitle")}
        </h3>
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
        </div>
      </Card>

      {/* Bar tải công việc theo người phụ trách (activeCount, BE cap top-20) */}
      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {t("projects.detail.report.workloadTitle")}
        </h3>
        {report.assigneeWorkload.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("projects.detail.report.workloadEmpty")}
          </p>
        ) : (
          <ul className="space-y-2.5">
            {report.assigneeWorkload.map((w) => (
              <li
                key={w.employeeId}
                className="space-y-1"
                data-testid="project-report-workload-row"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="text-foreground">
                    {w.employeeName ?? t("projects.detail.report.unknownEmployee")}
                  </span>
                  <span className="font-medium tabular-nums text-muted-foreground">
                    {t("projects.detail.report.activeCount", { count: w.activeCount })}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={w.activeCount}
                  aria-valuemin={0}
                  aria-valuemax={maxActive}
                  className="h-2 w-full overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-brand transition-all"
                    style={{ width: `${Math.round((w.activeCount / maxActive) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export interface ProjectReportPageProps {
  projectId: string;
  onBack: () => void;
}

export function ProjectReportPage({ projectId, onBack }: ProjectReportPageProps) {
  const { t } = useTranslation("tasks");
  const canView = useCanExact(PROJECT_REPORT_PAIR.action, PROJECT_REPORT_PAIR.resourceType);

  // Tên dự án cho tiêu đề — best-effort (read:project). Lỗi/thiếu quyền → fallback tiêu đề chung,
  // KHÔNG chặn trang báo cáo (query report mới là chính).
  const projectQuery = useQuery({
    queryKey: taskKeys.projects.detail(projectId),
    queryFn: () => taskProjectApi.getProject(projectId),
    enabled: canView && !!projectId,
    staleTime: 30_000,
  });

  const title = projectQuery.data?.name ?? t("projects.report.page.fallbackTitle");

  return (
    <div className="space-y-6 p-6">
      <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t("projects.report.page.backToDetail")}
      </Button>
      {canView && (
        <PageHeader
          title={title}
          description={t("projects.report.page.subtitle")}
          icon={BarChart3}
        />
      )}
      <ProjectReportContent projectId={projectId} />
    </div>
  );
}
