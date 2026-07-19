import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { taskCollabApi, taskKeys, useCanExact } from "@mediaos/web-core";
import { Card, EmptyState } from "@mediaos/ui";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { ActivityFeedList } from "./ActivityFeedList";

const PAGE_SIZE = 20;

/**
 * ProjectActivityTimeline — tab "Hoạt động" của workspace dự án (S5-TASK-WORKSPACE-1, SPEC-06 §13.3/
 * §13.12 TASK-SCREEN-012, GET /projects/:id/activity · TASK-API-601). Feed gộp sự kiện project-level
 * (tạo/sửa/đóng dự án, thành viên) + task con — thân render dùng chung `ActivityFeedList` với
 * TaskActivityTimeline (S4-FE-TASK-3), chỉ khác gate-view + query theo projectId.
 *
 * Gate `view:task-audit-log` — SENSITIVE (seed 0485, CHỈ hr/company-admin @Company) ⇒ `useCanExact`
 * fail-closed. Vỏ workspace ẨN HẲN tab khi thiếu quyền (UI-02 §5.3); component vẫn tự gate lần nữa
 * (deny-path khi mount trực tiếp/deep-link ?tab=activity) — trả EmptyState forbidden, KHÔNG fetch.
 */
export function ProjectActivityTimeline({ projectId }: { projectId: string }) {
  const { t } = useTranslation("tasks");
  const canView = useCanExact(
    TASK_CORE_ENGINE_PAIRS.VIEW_ACTIVITY_LOG.action,
    TASK_CORE_ENGINE_PAIRS.VIEW_ACTIVITY_LOG.resourceType,
  );
  const [page, setPage] = useState(1);
  const queryParams = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: taskKeys.projects.activity(projectId, queryParams),
    queryFn: () => taskCollabApi.listProjectActivity(projectId, queryParams),
    enabled: canView,
    staleTime: 30_000,
  });

  if (!canView) {
    return (
      <EmptyState
        title={t("workspace.activity.forbidden.title")}
        description={t("workspace.activity.forbidden.description")}
      />
    );
  }

  return (
    <Card className="space-y-3 p-4" data-testid="project-activity-timeline">
      <h3 className="text-sm font-semibold text-muted-foreground">
        {t("workspace.activity.title")}
      </h3>
      <ActivityFeedList
        items={data ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        page={page}
        onPageChange={setPage}
        pageSize={PAGE_SIZE}
        errorText={t("workspace.activity.errors.loadFailed")}
        emptyText={t("workspace.activity.empty")}
      />
    </Card>
  );
}
