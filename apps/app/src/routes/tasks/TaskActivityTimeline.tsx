import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { taskCollabApi, taskKeys, useCanExact } from "@mediaos/web-core";
import { Card } from "@mediaos/ui";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { ActivityFeedList } from "./ActivityFeedList";

const PAGE_SIZE = 20;

/**
 * TaskActivityTimeline — nhật ký hoạt động task (S4-FE-TASK-3, SPEC-06 §13.12/§14.19, TASK-API-602).
 *
 * Gate `view:task-audit-log` — SENSITIVE (seed 0485, CHỈ hr/company-admin @Company) ⇒ `useCanExact`
 * (KHÔNG wildcard fallback). employee/manager KHÔNG thấy mục này (component trả `null` — ẨN HẲN, không
 * hiện khối "không có quyền" gây nhiễu UI card khác trong trang, mirror TaskListPage filter theo
 * canReadEmployees/canReadProjects).
 *
 * S5-TASK-WORKSPACE-1: thân render (loading/error/list/empty + phân trang) chuyển sang
 * `ActivityFeedList` dùng chung với ProjectActivityTimeline (feed dự án TASK-API-601); bảng nhãn
 * action ở `activity-labels.ts`. Key i18n GIỮ NGUYÊN.
 */
export function TaskActivityTimeline({ taskId }: { taskId: string }) {
  const { t } = useTranslation("tasks");
  const canView = useCanExact(
    TASK_CORE_ENGINE_PAIRS.VIEW_ACTIVITY_LOG.action,
    TASK_CORE_ENGINE_PAIRS.VIEW_ACTIVITY_LOG.resourceType,
  );
  const [page, setPage] = useState(1);
  const queryParams = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: taskKeys.activity(taskId, queryParams),
    queryFn: () => taskCollabApi.listActivity(taskId, queryParams),
    enabled: canView,
    staleTime: 30_000,
  });

  if (!canView) return null;

  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold text-muted-foreground">
        {t("tasks.detail.activity.title")}
      </h3>
      <ActivityFeedList
        items={data ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        page={page}
        onPageChange={setPage}
        pageSize={PAGE_SIZE}
        errorText={t("tasks.detail.activity.errors.loadFailed")}
        emptyText={t("tasks.detail.activity.empty")}
      />
    </Card>
  );
}
