import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { taskCollabApi, taskKeys, useCanExact } from "@mediaos/web-core";
import { Card, Button } from "@mediaos/ui";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";

const PAGE_SIZE = 20;

/**
 * TaskActivityTimeline — nhật ký hoạt động task (S4-FE-TASK-3, SPEC-06 §13.12/§14.19, TASK-API-602).
 *
 * Gate `view:task-audit-log` — SENSITIVE (seed 0485, CHỈ hr/company-admin @Company) ⇒ `useCanExact`
 * (KHÔNG wildcard fallback). employee/manager KHÔNG thấy mục này (component trả `null` — ẨN HẲN, không
 * hiện khối "không có quyền" gây nhiễu UI card khác trong trang, mirror TaskListPage filter theo
 * canReadEmployees/canReadProjects).
 *
 * Phân trang limit/offset "tải thêm" (server KHÔNG trả `total` — TaskActivityFeedService.list), mirror
 * TaskListPage/ProjectListPage.
 */
const ACTION_LABEL_KEYS: Record<string, string> = {
  TASK_CREATED: "tasks.detail.activity.actions.taskCreated",
  TASK_UPDATED: "tasks.detail.activity.actions.taskUpdated",
  TASK_DELETED: "tasks.detail.activity.actions.taskDeleted",
  TASK_ASSIGNED: "tasks.detail.activity.actions.taskAssigned",
  TASK_ASSIGNEE_CHANGED: "tasks.detail.activity.actions.taskAssigneeChanged",
  TASK_STATUS_CHANGED: "tasks.detail.activity.actions.taskStatusChanged",
  TASK_PRIORITY_CHANGED: "tasks.detail.activity.actions.taskPriorityChanged",
  TASK_DUE_DATE_CHANGED: "tasks.detail.activity.actions.taskDueDateChanged",
  TASK_WATCHER_ADDED: "tasks.detail.activity.actions.taskWatcherAdded",
  TASK_WATCHER_REMOVED: "tasks.detail.activity.actions.taskWatcherRemoved",
  COMMENT_CREATED: "tasks.detail.activity.actions.commentCreated",
  COMMENT_UPDATED: "tasks.detail.activity.actions.commentUpdated",
  COMMENT_DELETED: "tasks.detail.activity.actions.commentDeleted",
  CHECKLIST_CREATED: "tasks.detail.activity.actions.checklistCreated",
  CHECKLIST_UPDATED: "tasks.detail.activity.actions.checklistUpdated",
  CHECKLIST_DELETED: "tasks.detail.activity.actions.checklistDeleted",
  CHECKLIST_ITEM_CREATED: "tasks.detail.activity.actions.checklistItemCreated",
  CHECKLIST_ITEM_UPDATED: "tasks.detail.activity.actions.checklistItemUpdated",
  CHECKLIST_ITEM_DONE: "tasks.detail.activity.actions.checklistItemDone",
  CHECKLIST_ITEM_DELETED: "tasks.detail.activity.actions.checklistItemDeleted",
};

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

  const items = data ?? [];
  const hasNext = items.length === PAGE_SIZE;

  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold text-muted-foreground">
        {t("tasks.detail.activity.title")}
      </h3>

      {isLoading ? (
        <div className="h-16 animate-pulse rounded bg-muted" />
      ) : isError ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{t("tasks.detail.activity.errors.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t("actions.retry", { ns: "common" })}
          </Button>
        </div>
      ) : items.length > 0 ? (
        <ul className="space-y-2 border-l border-border pl-3">
          {items.map((log) => {
            const labelKey = ACTION_LABEL_KEYS[log.action];
            const label = labelKey ? t(labelKey) : log.action;
            return (
              <li key={log.id} className="text-sm">
                <p className="text-foreground">
                  <span className="font-medium">
                    {log.actorName ?? t("tasks.detail.activity.systemActor")}
                  </span>{" "}
                  {log.message ?? label}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(log.createdAt).toLocaleString("vi-VN")}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("tasks.detail.activity.empty")}</p>
      )}

      {!isLoading && (page > 1 || hasNext) && (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>{page}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("pagination.prev", { ns: "common" })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("pagination.next", { ns: "common" })}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
