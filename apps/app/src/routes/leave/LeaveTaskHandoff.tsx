import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { companyTimeZone, formatDateTime, taskCoreApi, taskKeys, useCan } from "@mediaos/web-core";
import type { MyTaskItemDto } from "@mediaos/contracts";
import { Button, Card, CardContent } from "@mediaos/ui";
import { TASK_CORE_ENGINE_PAIRS } from "../tasks/constants";
import { DEFAULT_DEADLINE_PRESETS, afterLeavePreset } from "../tasks/deadline-presets";
import { TaskRowDeadlineControl } from "../tasks/TaskRowQuickEdit";
import { TaskRowAssigneeControl } from "../tasks/TaskInlineFields";
import { useTaskDrawer } from "../tasks/task-drawer-nav";
import {
  isLeaveHandoffEligible,
  tasksDueDuringLeave,
  type LeavePeriod,
} from "./leave-task-handoff";

/**
 * S20-TASK-LEAVEHANDOFF-1 (US-TASK-NV-93) — khối «Việc đến hạn trong kỳ nghỉ (N)» trên chi tiết đơn nghỉ
 * CỦA TÔI. Dữ liệu = `GET /tasks/my` CÙNG query key «Việc của tôi» (không endpoint mới), lọc client.
 * KHÔNG tự dời hạn, KHÔNG tự giao: mọi thay đổi là thao tác tường minh qua route sẵn có và quyền sẵn có
 * (`update-deadline:task` trong popover mốc hạn, `assign:task` ở ô Người). Thiếu `read:task` ⇒ không
 * render, không gọi API. Lỗi `/tasks/my` chỉ làm khối báo lỗi — phần còn lại của đơn không bị ảnh hưởng.
 */
function HandoffRow({ task, endDate }: { task: MyTaskItemDto; endDate: string }) {
  const { t } = useTranslation("leave");
  const { openTask } = useTaskDrawer();
  const presets = useMemo(
    () => [afterLeavePreset(endDate), ...DEFAULT_DEADLINE_PRESETS],
    [endDate],
  );
  const canComment = useCan(
    TASK_CORE_ENGINE_PAIRS.COMMENT.action,
    TASK_CORE_ENGINE_PAIRS.COMMENT.resourceType,
  );
  return (
    <li
      data-testid={`leave-handoff-row-${task.id}`}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm"
    >
      <button
        type="button"
        data-testid={`leave-handoff-open-${task.id}`}
        onClick={() => openTask(task.id)}
        className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
      >
        {task.title}
      </button>
      <TaskRowDeadlineControl
        task={task}
        presets={presets}
        readOnly={
          <span className="text-xs text-muted-foreground">
            {task.dueAt ? formatDateTime(task.dueAt, companyTimeZone()) : "—"}
          </span>
        }
      />
      <TaskRowAssigneeControl task={task} />
      {canComment && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid={`leave-handoff-notify-${task.id}`}
          onClick={() => openTask(task.id, { tab: "comment" })}
        >
          {t("handoff.notifyReporter")}
        </Button>
      )}
    </li>
  );
}

function HandoffBody({
  tasks,
  endDate,
  isLoading,
  isError,
  onRetry,
}: {
  tasks: readonly MyTaskItemDto[];
  endDate: string;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation("leave");
  if (isLoading) return <div className="h-12 animate-pulse rounded bg-muted" />;
  if (isError) {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
        <span>{t("handoff.error")}</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("handoff.retry")}
        </Button>
      </div>
    );
  }
  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("handoff.empty")}</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {tasks.map((task) => (
        <HandoffRow key={task.id} task={task} endDate={endDate} />
      ))}
    </ul>
  );
}

export function LeaveTaskHandoff({ request }: { request: LeavePeriod }) {
  const { t } = useTranslation("leave");
  const canRead = useCan(
    TASK_CORE_ENGINE_PAIRS.READ.action,
    TASK_CORE_ENGINE_PAIRS.READ.resourceType,
  );
  const timeZone = companyTimeZone();
  const eligible = canRead && isLeaveHandoffEligible(request, new Date(), timeZone);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: taskKeys.my(),
    queryFn: () => taskCoreApi.getMyTasks(),
    enabled: eligible,
    staleTime: 30_000,
  });
  const due = useMemo(
    () => (data ? tasksDueDuringLeave(data, request, timeZone) : []),
    [data, request, timeZone],
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prevCount = useRef<number | null>(null);
  const settled = eligible && !isLoading && !isError && data !== undefined;
  // Dòng rời danh sách (dời hạn «Sau kỳ nghỉ» / đổi người) ⇒ popover + nút bị gỡ, focus rơi về body:
  // trả focus về tiêu đề khối để bàn phím / trình đọc màn hình không mất vị trí.
  useEffect(() => {
    if (!settled) return;
    const before = prevCount.current;
    prevCount.current = due.length;
    if (before === null || due.length >= before) return;
    const active = document.activeElement;
    if (active === null || active === document.body) headingRef.current?.focus();
  }, [settled, due.length]);
  if (!eligible) return null;
  return (
    <Card data-testid="leave-task-handoff">
      <CardContent className="space-y-3 pt-5">
        <h3
          ref={headingRef}
          tabIndex={-1}
          data-testid="leave-handoff-title"
          className="text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("handoff.title")}
          {!isError && !isLoading && " (" + String(due.length) + ")"}
        </h3>
        <p role="status" aria-live="polite" className="sr-only" data-testid="leave-handoff-status">
          {settled ? t("handoff.count", { count: due.length }) : ""}
        </p>
        <HandoffBody
          tasks={due}
          endDate={request.endDate}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
        />
      </CardContent>
    </Card>
  );
}
