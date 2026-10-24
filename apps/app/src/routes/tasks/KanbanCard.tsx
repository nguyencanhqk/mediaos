import type { DragEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare, Paperclip, ListChecks, ListTree } from "lucide-react";
import { Avatar, Badge, cn } from "@mediaos/ui";
import type { TaskCoreStatusDto, TaskKanbanCardDto } from "@mediaos/contracts";
import { TaskStatusBadge, TaskPriorityBadge, TaskOverdueBadge } from "./TaskStatusBadge";
import { KanbanCardSubtasks } from "./KanbanCardSubtasks";
import { TaskLabelChip } from "./TaskLabelPicker";
import { KanbanCardMoveMenu, type KanbanMoveProps } from "./KanbanCardMoveMenu";

/**
 * KanbanCard — thẻ trên board (tách khỏi TaskKanbanPage ở S20-TASK-FEDEBT-1; hành vi giữ nguyên).
 *
 * Cấu trúc (S20-TASK-FEDEBT-1): KHỐI thẻ `[data-kanban-card]` (kéo-thả + khung) chứa hai phần anh em:
 * - mặt thẻ (`role=button` khi có `onOpen`) — CHỈ nội dung tĩnh: bìa, tiêu đề, nhãn, người, hạn, badge;
 * - nút ⋯ «Chuyển sang cột…» (góc trên phải) và nút bung việc con (dưới) — nằm CẠNH mặt thẻ.
 * Trước đây hai nút này lồng TRONG phần tử role=button: trình đọc màn hình gộp chúng vào tên của thẻ
 * (role=button có con trình bày), không bấm riêng được, và mỗi nút phải tự chặn click/phím nổi bọt.
 *
 * Hợp đồng DOM với `useKanbanCardFocusReturn`: khối mang `data-kanban-card={task.id}`, mặt thẻ mở-được
 * mang `data-kanban-card-open`, nút ⋯ mang `data-kanban-move-trigger`.
 */
const COMPLETED_STATUSES = new Set<TaskCoreStatusDto>(["Done", "Cancelled"]);

function KanbanCardBadges({ task }: { task: TaskKanbanCardDto }) {
  const { t } = useTranslation("tasks");
  const commentCount = task.commentCount ?? 0;
  const attachmentCount = task.attachmentCount ?? 0;
  const checklistTotal = task.checklistTotal ?? 0;
  const checklistDone = task.checklistDone ?? 0;
  // S5-TASK-SUBTASK-1 — badge tiến độ việc con (D-34, mẫu số COUNTABLE_CHILD loại Cancelled). Badge
  // RIÊNG với checklist (D-31/D-35 "hai khái niệm khác nhau" — KHÔNG gộp, KHÔNG thay).
  const subtaskTotal = task.subtaskTotal ?? 0;
  const subtaskDone = task.subtaskDone ?? 0;

  // ⚠️ Early-return PHẢI xét đủ 4 count — thẻ có subtask mà 0 comment/file/checklist từng KHÔNG
  // render badge nào nếu chỉ xét 3 count cũ (bẫy đã ghi trong plan fe mục 3).
  if (commentCount <= 0 && attachmentCount <= 0 && checklistTotal <= 0 && subtaskTotal <= 0)
    return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
      {commentCount > 0 && (
        <Badge
          variant="muted"
          title={t("tasks.kanban.badges.comments", { count: commentCount })}
          data-testid="kanban-card-badge-comments"
        >
          <MessageSquare className="h-3 w-3" aria-hidden="true" />
          {commentCount}
        </Badge>
      )}
      {attachmentCount > 0 && (
        <Badge
          variant="muted"
          title={t("tasks.kanban.badges.attachments", { count: attachmentCount })}
          data-testid="kanban-card-badge-attachments"
        >
          <Paperclip className="h-3 w-3" aria-hidden="true" />
          {attachmentCount}
        </Badge>
      )}
      {checklistTotal > 0 && (
        <Badge
          variant="muted"
          title={t("tasks.kanban.badges.checklist", { done: checklistDone, total: checklistTotal })}
          data-testid="kanban-card-badge-checklist"
        >
          <ListChecks className="h-3 w-3" aria-hidden="true" />
          {checklistDone}/{checklistTotal}
        </Badge>
      )}
      {/* S5-TASK-CARDSUB-1 — số liệu chi tiết nằm trên nút bung việc con (cạnh mặt thẻ); ở đây
          chỉ giữ biểu tượng cho hàng badge đồng nhất. */}
      {subtaskTotal > 0 && (
        <Badge
          variant="muted"
          title={t("tasks.kanban.badges.subtasks", {
            done: subtaskDone,
            total: subtaskTotal,
            pct: Math.round((subtaskDone / subtaskTotal) * 100),
          })}
          data-testid="kanban-card-badge-subtasks"
        >
          <ListTree className="h-3 w-3" aria-hidden="true" />
          {subtaskDone}/{subtaskTotal}
        </Badge>
      )}
    </div>
  );
}

/** Ảnh bìa — `coverUrl` là URL ĐÃ KÝ TTL-ngắn từ server (không bao giờ là fileId thô). */
function KanbanCardCover({ task }: { task: TaskKanbanCardDto }) {
  if (!task.coverUrl) return null;
  return (
    <img
      // ⚠️ `key` PHẢI là coverUrl, KHÔNG được bỏ. Thẻ có key={task.id} nên React TÁI DÙNG chính
      // phần tử <img> này qua mọi lần refetch và chỉ đổi `src`. `onError` bên dưới đặt style
      // display:none TRỰC TIẾP lên DOM — React không biết gì về nó nên KHÔNG BAO GIỜ dọn.
      // Thiếu key: để board mở quá TTL của URL đã ký ⇒ ảnh 403 ⇒ ẩn hết; URL mới hợp lệ về tới nơi
      // mà thẻ VẪN trắng. Đổi key ⇒ phần tử MỚI ⇒ không mang theo style cũ.
      key={task.coverUrl}
      src={task.coverUrl}
      alt=""
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
      data-testid={`kanban-card-cover-${task.id}`}
      className="mb-1.5 aspect-video w-full rounded object-cover"
    />
  );
}

export interface KanbanCardProps {
  task: TaskKanbanCardDto;
  draggable: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  /** S5-TASK-BOARD-UX-1 — bấm thẻ mở panel chi tiết. Không truyền ⇒ thẻ KHÔNG bấm được. */
  onOpen?: () => void;
  /** S5-TASK-CARDSUB-1 — trạng thái bung việc con do BOARD giữ (theo taskId): kéo-thả làm thẻ
   *  remount sang cột khác, state cục bộ sẽ bị reset về thu. */
  subtasksExpanded: boolean;
  onToggleSubtasks: () => void;
  /** Board state-mode: hiện badge task_status trên thẻ — người dùng THẤY auto-map nhóm→status. */
  showStatus?: boolean;
  /** S20-TASK-BOARDMOVE-1 — menu ⋯ đổi cột, chỉ khi `draggable`; `columnId` = cột đang chứa thẻ. */
  move?: KanbanMoveProps;
  columnId?: string;
}

export function KanbanCard({
  task,
  draggable,
  onDragStart,
  onOpen,
  subtasksExpanded,
  onToggleSubtasks,
  showStatus = false,
  move,
  columnId,
}: KanbanCardProps) {
  const { t } = useTranslation("tasks");
  const isCompleted = task.status != null && COMPLETED_STATUSES.has(task.status);
  const showMoveMenu = draggable && move !== undefined;

  // Thẻ vừa KÉO-THẢ vừa BẤM-MỞ: trình duyệt chỉ bắn click khi con trỏ không di chuyển đáng kể, nên
  // dragstart→drop KHÔNG sinh click. Bàn phím đi qua onKeyDown (Enter/Space) vì div không phải nút thật.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!onOpen) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onOpen();
  };

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      data-kanban-card={task.id}
      className={cn(
        "relative rounded-md border border-border bg-card text-sm shadow-sm",
        draggable && "cursor-grab active:cursor-grabbing",
        onOpen && "hover:border-primary/50 hover:shadow",
        isCompleted && "border-border/60 bg-muted/40",
      )}
    >
      <div
        onClick={onOpen}
        onKeyDown={onKeyDown}
        role={onOpen ? "button" : undefined}
        tabIndex={onOpen ? 0 : undefined}
        aria-label={onOpen ? t("tasks.kanban.openDetail", { title: task.title }) : undefined}
        data-testid={`kanban-card-${task.id}`}
        data-kanban-card-open={onOpen ? "" : undefined}
        className={cn(
          "space-y-1.5 rounded-md p-2.5",
          onOpen &&
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
          !draggable && onOpen && "cursor-pointer",
        )}
      >
        <KanbanCardCover task={task} />
        <p
          className={cn(
            "font-medium text-foreground",
            // Chừa chỗ cho nút ⋯ đặt chồng góc trên phải (nút nằm NGOÀI mặt thẻ); có bìa thì nút
            // nằm trên bìa, tiêu đề không cần chừa.
            showMoveMenu && !task.coverUrl && "pr-7",
            isCompleted && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </p>
        {/* Gắn thẻ — chip nhãn màu trên thẻ board (server đính labels[] trong board read, không N+1). */}
        {(task.labels?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1" data-testid={`kanban-card-labels-${task.id}`}>
            {(task.labels ?? []).map((label) => (
              <TaskLabelChip key={label.id} label={label} />
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <Avatar
            size="sm"
            name={task.assigneeName}
            // S5-TASK-AVATAR-1 — URL đã ký từ server; null ⇒ Avatar tự lùi về chữ cái đầu.
            src={task.assigneeAvatarUrl}
            title={task.assigneeName ?? t("tasks.kanban.unassigned")}
          />
          <div className="flex items-center gap-1.5">
            {showStatus && <TaskStatusBadge status={task.status} />}
            <TaskPriorityBadge priority={task.priority} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {task.dueAt ? new Date(task.dueAt).toLocaleDateString("vi-VN") : "—"}
          </span>
          <TaskOverdueBadge isOverdue={task.isOverdue} />
        </div>
        <KanbanCardBadges task={task} />
      </div>
      {showMoveMenu && (
        <div className="absolute right-2 top-2 rounded-md bg-card/90">
          <KanbanCardMoveMenu task={task} currentId={columnId} move={move} />
        </div>
      )}
      {(task.subtaskTotal ?? 0) > 0 && (
        <div className="px-2.5 pb-2">
          {/* S5-TASK-CARDSUB-1 — bung danh sách việc con ngay trên thẻ (tải lười, chỉ khi bấm). */}
          <KanbanCardSubtasks
            taskId={task.id}
            done={task.subtaskDone ?? 0}
            total={task.subtaskTotal ?? 0}
            expanded={subtasksExpanded}
            onToggle={onToggleSubtasks}
          />
        </div>
      )}
    </div>
  );
}
