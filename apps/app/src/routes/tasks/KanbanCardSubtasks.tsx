import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Circle, CheckCircle2 } from "lucide-react";
import { taskCoreApi, taskKeys } from "@mediaos/web-core";
import { Avatar, cn } from "@mediaos/ui";
import type { SubtaskListItemDto } from "@mediaos/contracts";

/**
 * KanbanCardSubtasks — nút trỏ xuống trên thẻ board, bung ra danh sách việc con
 * (S5-TASK-CARDSUB-1; benchmark UX MISA AMIS: thẻ "8/8 ⌄" bung ra checklist các bước).
 *
 * TẢI LƯỜI, CÓ LÝ DO: payload board CHỈ mang hai con số `subtaskDone`/`subtaskTotal`
 * (`countSubtaskProgressByParentIdsTx` là aggregate GROUP BY) — KHÔNG có danh sách con, và cũng
 * không có endpoint lấy-hàng-loạt. Muốn danh sách thì phải gọi `GET /tasks/:id/subtasks` cho TỪNG
 * thẻ. Board vài chục thẻ ⇒ tải sẵn là vài chục request cho thứ hầu hết người dùng không mở. Nên
 * chỉ gọi khi người dùng THỰC SỰ bung một thẻ (`enabled: expanded`), và cache theo
 * `taskKeys.subtasks(taskId)` — dùng chung với panel việc con ở màn chi tiết, nên mở chi tiết rồi
 * quay ra board là cache-hit.
 *
 * KHÔNG có nút này khi `subtaskTotal === 0` — không mời gọi bung ra một danh sách rỗng.
 */
function SubtaskLine({ item }: { item: SubtaskListItemDto }) {
  const isDone = item.status === "Done";
  const isCancelled = item.status === "Cancelled";
  return (
    <li className="flex items-center gap-1.5 py-0.5" data-testid={`kanban-subtask-${item.id}`}>
      {isDone ? (
        <CheckCircle2 className="h-3 w-3 shrink-0 text-brand" aria-hidden="true" />
      ) : (
        <Circle className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-xs",
          isDone && "text-muted-foreground line-through",
          isCancelled && "text-muted-foreground line-through opacity-70",
        )}
        title={item.title}
      >
        {item.title}
      </span>
      <Avatar size="sm" name={item.assigneeName} src={item.assigneeAvatarUrl} />
    </li>
  );
}

export function KanbanCardSubtasks({
  taskId,
  done,
  total,
  expanded,
  onToggle,
}: {
  taskId: string;
  done: number;
  total: number;
  /** Bung/thu do THẺ giữ state — đóng thẻ khác không làm mất trạng thái thẻ này. */
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation("tasks");

  const { data, isLoading, isError } = useQuery({
    queryKey: taskKeys.subtasks(taskId),
    queryFn: () => taskCoreApi.listSubtasks(taskId),
    enabled: expanded,
    staleTime: 15_000,
  });

  if (total <= 0) return null;
  const items = data ?? [];

  return (
    <div className="space-y-1">
      <button
        type="button"
        // Thẻ cha có onClick mở chi tiết — bung việc con KHÔNG được kéo theo việc đó.
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        // Thẻ cha cũng nghe Enter/Space (role=button) ⇒ chặn cả bàn phím, không chỉ chuột.
        onKeyDown={(e) => e.stopPropagation()}
        aria-expanded={expanded}
        aria-label={t("tasks.kanban.subtaskList.toggle", { done, total })}
        data-testid={`kanban-card-subtasks-toggle-${taskId}`}
        className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        )}
        {done}/{total}
      </button>

      {expanded && (
        <div
          className="rounded border border-border/60 bg-background/40 px-1.5 py-1"
          data-testid={`kanban-card-subtasks-panel-${taskId}`}
          // Bấm trong danh sách không mở chi tiết thẻ cha (dòng việc con chỉ để xem ở đây).
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          {isLoading ? (
            <div className="h-8 animate-pulse rounded bg-muted" />
          ) : isError ? (
            <p className="py-0.5 text-xs text-destructive">
              {t("tasks.kanban.subtaskList.loadFailed")}
            </p>
          ) : items.length === 0 ? (
            <p className="py-0.5 text-xs text-muted-foreground">
              {t("tasks.kanban.subtaskList.empty")}
            </p>
          ) : (
            <ul>
              {items.map((item) => (
                <SubtaskLine key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
