/**
 * MeTasksPage — ME-SCREEN-011 "Công việc của tôi" (SPEC-09 §8.1/§8.2, route "/me/tasks").
 *
 * Đọc DUY NHẤT `GET /me/task-summary` (meApi.getTaskSummary) — section-envelope RIÊNG `{status, data}`
 * (§13): assignedCount/dueTodayCount/overdueCount, KHÔNG gọi endpoint bảng TASK nguồn trực tiếp và KHÔNG
 * thay trang My Tasks (§7.5). Deep-link sang `/tasks/my-tasks` — route đích TỰ gate lại.
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { KanbanSquare, CheckSquare, RefreshCw } from "lucide-react";
import { meApi, meKeys, useCan } from "@mediaos/web-core";
import { EmptyState, Button, Skeleton, PageHeader } from "@mediaos/ui";
import { MeSectionCard } from "./components/MeSectionCard";
import { TaskSectionContent } from "./components/MeSectionContents";
import { MeDeepLinkButtons } from "./components/MeDeepLinkButtons";
import { ME_ACCESS_PAIR, ME_QUICK_ACTION_PATHS } from "./constants";

function MeTasksPageInner() {
  const { t } = useTranslation("me");
  const { t: tc } = useTranslation("common");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: meKeys.taskSummary(),
    queryFn: meApi.getTaskSummary,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full max-w-xl rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("tasksPage.error.title")}
          description={t("tasksPage.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("tasksPage.title")}
        description={t("tasksPage.description")}
        icon={KanbanSquare}
      />

      <MeSectionCard
        title={t("task.title")}
        icon={KanbanSquare}
        isPageLoading={false}
        section={data}
        onRetry={() => void refetch()}
        isEmpty={(d) => d.assignedCount === 0 && d.dueTodayCount === 0 && d.overdueCount === 0}
        emptyTitle={t("task.empty")}
        className="max-w-xl"
      >
        {(d) => <TaskSectionContent data={d} />}
      </MeSectionCard>

      <MeDeepLinkButtons
        title={t("tasksPage.linksTitle")}
        actions={[
          {
            key: "my-tasks",
            label: t("quickActions.myTasks"),
            icon: CheckSquare,
            path: ME_QUICK_ACTION_PATHS.MY_TASKS,
          },
        ]}
      />
    </div>
  );
}

export function MeTasksPage() {
  const { t } = useTranslation("me");
  const canAccess = useCan(ME_ACCESS_PAIR.action, ME_ACCESS_PAIR.resourceType);

  if (!canAccess) {
    return (
      <div className="p-6">
        <EmptyState title={t("forbidden.title")} description={t("forbidden.description")} />
      </div>
    );
  }

  return <MeTasksPageInner />;
}
