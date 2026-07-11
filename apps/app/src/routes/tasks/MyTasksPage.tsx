import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ListTodo } from "lucide-react";
import { taskCoreApi, taskKeys, useCan } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card } from "@mediaos/ui";
import type { MyTaskItemDto, TaskCoreSourceDto } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { TaskStatusBadge, TaskPriorityBadge, TaskOverdueBadge } from "./TaskStatusBadge";

/**
 * MyTasksPage — S4-FE-TASK-2 (SPEC-06 §13.9, TASK-SCREEN-009).
 *
 * GET /tasks/my (TASK-API-210) gộp 3 nguồn assigned/created/watched TRONG 1 mảng trần (mỗi dòng kèm
 * `source`) — trang này nhóm lại CLIENT-SIDE thành 3 tab, KHÔNG gọi 3 API riêng (đúng thiết kế BE:
 * "gộp 3 nguồn, sort quá-hạn-lên-đầu" — server đã làm phần nặng). Cổng route = TASK.TASK.VIEW (→
 * read:task) — user phải liên kết employee để có dữ liệu (SPEC-06 §13.9 Quy tắc); nếu chưa liên kết,
 * server trả mảng rỗng (empty-state, KHÔNG lỗi).
 */
const GROUPS: readonly TaskCoreSourceDto[] = ["assigned", "created", "watched"];

function TaskRow({ item, onOpen }: { item: MyTaskItemDto; onOpen: (id: string) => void }) {
  const { t } = useTranslation("tasks");
  return (
    <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <button
          type="button"
          className="text-left font-medium text-foreground underline-offset-2 hover:underline"
          onClick={() => onOpen(item.id)}
        >
          {item.title}
        </button>
        <p className="text-xs text-muted-foreground">
          {item.projectName ?? t("tasks.my.noProject")}
          {item.dueAt ? ` · ${new Date(item.dueAt).toLocaleString("vi-VN")}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <TaskPriorityBadge priority={item.priority} />
        <TaskStatusBadge status={item.status} />
        <TaskOverdueBadge isOverdue={item.isOverdue} />
      </div>
    </Card>
  );
}

export function MyTasksPage() {
  const { t } = useTranslation("tasks");
  const navigate = useNavigate();
  const canView = useCan(
    TASK_CORE_ENGINE_PAIRS.READ.action,
    TASK_CORE_ENGINE_PAIRS.READ.resourceType,
  );
  const [tab, setTab] = useState<TaskCoreSourceDto>("assigned");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: taskKeys.my(),
    queryFn: () => taskCoreApi.getMyTasks(),
    enabled: canView,
    staleTime: 30_000,
  });

  const grouped = useMemo(() => {
    const result: Record<TaskCoreSourceDto, MyTaskItemDto[]> = {
      assigned: [],
      created: [],
      watched: [],
    };
    for (const item of data ?? []) result[item.source].push(item);
    return result;
  }, [data]);

  const openTask = (taskId: string) => void navigate({ to: "/tasks/$taskId", params: { taskId } });

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("tasks.my.forbidden.title")}
          description={t("tasks.my.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("tasks.my.error.title")}
          description={t("tasks.my.error.description")}
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

  const activeItems = grouped[tab];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("tasks.my.title")}
        description={t("tasks.my.description")}
        icon={ListTodo}
      />

      <div className="flex gap-2 border-b border-border">
        {GROUPS.map((key) => (
          <button
            key={key}
            type="button"
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab(key)}
          >
            {t(`tasks.my.groups.${key}`)} ({grouped[key].length})
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <div className="h-16 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
        </div>
      ) : activeItems.length === 0 ? (
        <EmptyState
          title={t("tasks.my.empty.title")}
          description={t("tasks.my.empty.description")}
        />
      ) : (
        <div className="space-y-2">
          {activeItems.map((item) => (
            <TaskRow key={item.id} item={item} onOpen={openTask} />
          ))}
        </div>
      )}
    </div>
  );
}
