import { useMemo, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Paperclip, ListChecks, ListTree } from "lucide-react";
import {
  taskCollabApi,
  taskKeys,
  taskCollabInvalidation,
  taskCoreInvalidation,
  useCan,
  ApiError,
} from "@mediaos/web-core";
import { Card, Button, EmptyState, Avatar, Badge, cn } from "@mediaos/ui";
import type {
  TaskCoreStatusDto,
  TaskKanbanBoardDto,
  TaskKanbanCardDto,
  TaskKanbanStateColumnDto,
  TaskKanbanStatusColumnDto,
} from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { TaskStatusBadge, TaskPriorityBadge, TaskOverdueBadge } from "./TaskStatusBadge";
import { KanbanQuickCreate } from "./KanbanQuickCreate";
import { KanbanCardSubtasks } from "./KanbanCardSubtasks";
import { TaskLabelChip } from "./TaskLabelPicker";
import { AssigneeRail } from "./AssigneeRail";
import {
  buildAssigneeSummary,
  DEFAULT_WORKSPACE_FILTERS,
  matchesAssigneeSelection,
  matchesWorkspaceFilters,
  pinSelectedInSummary,
  sortWorkspaceTasks,
  type WorkspaceTaskFilters,
} from "./workspace-constants";

/**
 * TaskKanbanPage — board task theo cột trạng thái, kéo-thả đổi status (S4-FE-TASK-3, SPEC-06 §13.8/§14.13,
 * TASK-API-212 + move). Mount như tab "Kanban" trong ProjectDetailPage (route `/tasks/projects/:projectId`
 * ĐÃ có sẵn từ S4-FE-TASK-1 — KHÔNG thêm route mới, tránh đụng router.tsx ngoài phạm vi lane).
 *
 * Kéo-thả CHỈ bật khi có `update-status:task` (mirror BE SPEC-06 §14.13 "Người không có quyền update status
 * chỉ xem, không kéo thả") — card không draggable khi thiếu quyền. Optimistic move (dời card sang cột đích
 * ngay trong cache) CÓ rollback khi API lỗi (409 FSM sai bảng / 403 / 500) qua onError khôi phục snapshot.
 *
 * S5-FE-TASK-5 — card giàu tín hiệu (benchmark UX TASK, xem memory task-ux-reference-benchmark): badge
 * comment/attachment/checklist (S5-TASK-BE-6 đã bổ sung counts vào `taskKanbanCardSchema`, field optional
 * NHƯNG server luôn điền số thật — chỉ render khi count > 0), avatar-initials thay text cho assignee, style
 * muted + gạch tiêu đề cho card Done/Cancelled.
 *
 * S5-TASK-WORKSPACE-1 (đợt D1): bộ lọc chuyển lên VỎ workspace (ProjectDetailPage) — nhận qua props
 * `filters` (toolbar chung với tab Danh sách) + `assigneeSelection` (rail avatar multi-select, thay
 * rail đơn-chọn cũ). Lọc/sắp vẫn CLIENT-SIDE trong từng cột qua helper workspace-constants (cùng
 * predicate với tab Danh sách ⇒ parity theo cấu trúc). Header cột giữ SỐ GỐC (SPEC-06 §13.8 — không
 * đổi theo bộ lọc); rail đếm theo tập đã lọc toolbar (TRƯỚC lọc assignee).
 *
 * S5-TASK-SUBTASK-1 — badge THỨ 4 `subtaskDone/subtaskTotal` (D-34, mẫu số COUNTABLE_CHILD loại
 * Cancelled), chỉ render khi `subtaskTotal > 0`. Field kế thừa từ `taskCoreResponseSchema` qua
 * `.extend()` (contracts task-collab.ts) — KHÔNG cần đổi schema Kanban riêng. Badge RIÊNG với checklist
 * (hai khái niệm khác nhau — D-31) — KHÔNG đụng badge checklist.
 */
const COMPLETED_STATUSES = new Set<TaskCoreStatusDto>(["Done", "Cancelled"]);
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

function moveErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "tasks.kanban.errors.conflict";
    if (err.status === 403) return "tasks.kanban.errors.forbidden";
    if (err.status === 404) return "tasks.kanban.errors.notFound";
    // S5-TASK-PIPELINE-1 — kéo sang cột nhóm completed khi checklist bắt buộc chưa xong (400) /
    // cột không hợp lệ: server từ chối atomic, thẻ bật về chỗ cũ.
    if (err.status === 400) return "tasks.kanban.errors.badRequest";
    if (err.status >= 500) return "tasks.kanban.errors.server";
  }
  return "tasks.kanban.errors.generic";
}

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
          title={t("tasks.kanban.badges.checklist", {
            done: checklistDone,
            total: checklistTotal,
          })}
          data-testid="kanban-card-badge-checklist"
        >
          <ListChecks className="h-3 w-3" aria-hidden="true" />
          {checklistDone}/{checklistTotal}
        </Badge>
      )}
      {/* S5-TASK-CARDSUB-1 — badge việc con chuyển thành NÚT BUNG (KanbanCardSubtasks) ở dưới; ở đây
          chỉ còn biểu tượng để giữ hàng badge đồng nhất, số liệu nằm trên nút. */}
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

function KanbanCard({
  task,
  draggable,
  onDragStart,
  onOpen,
  subtasksExpanded,
  onToggleSubtasks,
  showStatus = false,
}: {
  task: TaskKanbanCardDto;
  draggable: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  /** S5-TASK-BOARD-UX-1 — bấm thẻ mở panel chi tiết. Không truyền ⇒ thẻ KHÔNG bấm được (giữ hành vi cũ). */
  onOpen?: () => void;
  /** S5-TASK-CARDSUB-1 — trạng thái bung việc con do BOARD giữ (theo taskId), không phải từng thẻ:
   *  kéo-thả làm thẻ remount sang cột khác, state cục bộ sẽ bị reset về thu. */
  subtasksExpanded: boolean;
  onToggleSubtasks: () => void;
  /** Board state-mode: hiện badge task_status trên thẻ — người dùng THẤY auto-map nhóm→status đã chạy. */
  showStatus?: boolean;
}) {
  const { t } = useTranslation("tasks");
  const isCompleted = task.status != null && COMPLETED_STATUSES.has(task.status);

  // S5-TASK-BOARD-UX-1 — thẻ vừa KÉO-THẢ vừa BẤM-MỞ. Kéo không được kích hoạt onClick: trình duyệt
  // chỉ bắn click khi con trỏ không di chuyển đáng kể, nên dragstart→drop KHÔNG sinh click. Bàn phím
  // đi qua onKeyDown (Enter/Space) vì div không phải nút thật.
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
      onClick={onOpen}
      onKeyDown={onKeyDown}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? t("tasks.kanban.openDetail", { title: task.title }) : undefined}
      data-testid={`kanban-card-${task.id}`}
      className={cn(
        "space-y-1.5 rounded-md border border-border bg-card p-2.5 text-sm shadow-sm",
        draggable && "cursor-grab active:cursor-grabbing",
        onOpen &&
          "hover:border-primary/50 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        !draggable && onOpen && "cursor-pointer",
        isCompleted && "border-border/60 bg-muted/40",
      )}
    >
      {/* S5-TASK-COVER-1 — ảnh bìa. `coverUrl` là URL ĐÃ KÝ TTL-ngắn từ server (không bao giờ là
          fileId thô). Không có bìa ⇒ KHÔNG chừa chỗ trống, thẻ giữ nguyên dáng cũ.
          `onError` ẩn hẳn ảnh: URL đã ký có thể hết hạn khi board mở lâu — thà mất bìa còn hơn để
          một ô ảnh vỡ nằm trên thẻ. `loading="lazy"` vì board có thể hàng chục thẻ. */}
      {task.coverUrl && (
        <img
          // ⚠️ `key` PHẢI là coverUrl, KHÔNG được bỏ. Thẻ có key={task.id} nên React TÁI DÙNG chính
          // phần tử <img> này qua mọi lần refetch và chỉ đổi `src`. `onError` bên dưới đặt style
          // display:none TRỰC TIẾP lên DOM — React không biết gì về nó nên KHÔNG BAO GIỜ dọn.
          // Hệ quả nếu thiếu key: để board mở quá TTL của URL đã ký ⇒ ảnh 403 ⇒ ẩn hết; sau đó dù
          // đặt bìa mới hay chỉ kéo-thả (moveState trả coverUrl mới), URL hợp lệ về tới nơi mà thẻ
          // VẪN trắng — chỉ rời route mới khỏi. Người dùng thấy "bấm mà không có gì xảy ra".
          // Đổi key ⇒ phần tử MỚI ⇒ không mang theo style cũ.
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
      )}
      <p
        className={cn(
          "font-medium text-foreground",
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
      {/* S5-TASK-CARDSUB-1 — bung danh sách việc con ngay trên thẻ (tải lười, chỉ khi bấm). */}
      <KanbanCardSubtasks
        taskId={task.id}
        done={task.subtaskDone ?? 0}
        total={task.subtaskTotal ?? 0}
        expanded={subtasksExpanded}
        onToggle={onToggleSubtasks}
      />
    </div>
  );
}

function KanbanColumn({
  status,
  tasks,
  totalCount,
  canDrag,
  onDragStartTask,
  onDrop,
  onOpenTask,
  expandedSubtasks,
  onToggleSubtasks,
}: {
  status: TaskCoreStatusDto;
  tasks: TaskKanbanCardDto[];
  /** Tổng số task GỐC của cột (SPEC-06 §13.8) — header cột không đổi theo bộ lọc assignee. */
  totalCount: number;
  canDrag: boolean;
  onDragStartTask: (taskId: string) => (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (status: TaskCoreStatusDto) => (e: DragEvent<HTMLDivElement>) => void;
  onOpenTask?: (taskId: string) => void;
  expandedSubtasks: ReadonlySet<string>;
  onToggleSubtasks: (taskId: string) => void;
}) {
  const { t } = useTranslation("tasks");
  return (
    <div
      className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2"
      onDragOver={(e) => canDrag && e.preventDefault()}
      onDrop={onDrop(status)}
      data-testid={`kanban-column-${status}`}
    >
      <div className="flex items-center justify-between px-1">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">
          {t(`tasks.status.${status}`)}
        </h4>
        <span
          className="text-xs text-muted-foreground"
          data-testid={`kanban-column-count-${status}`}
        >
          {totalCount}
        </span>
      </div>
      {/* Cột dài tự cuộn TRONG cột (header cột đứng yên) thay vì kéo giãn cả trang;
          drop handler ở div cột cha nên kéo-thả không đổi. calc ≈ topbar + header
          project + tabs; min-h giữ vùng thả khi cột rỗng. */}
      <div className="flex min-h-24 max-h-[calc(100dvh-21rem)] flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
        {tasks.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t("tasks.kanban.columnEmpty")}</p>
        ) : (
          tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              draggable={canDrag}
              onDragStart={onDragStartTask(task.id)}
              onOpen={onOpenTask ? () => onOpenTask(task.id) : undefined}
              subtasksExpanded={expandedSubtasks.has(task.id)}
              onToggleSubtasks={() => onToggleSubtasks(task.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * S5-TASK-PIPELINE-1 (lane fe) — cột PIPELINE tuỳ biến (columnMode:'state'): tên/màu/đếm từ chính
 * cột; kéo-thả gọi move-state (đổi CỘT — server auto-map status). Card hiện badge status để người
 * dùng thấy auto-map (plan fe mục 4).
 */
function StateKanbanColumn({
  column,
  tasks,
  canDrag,
  projectId,
  onDragStartTask,
  onDrop,
  onOpenTask,
  expandedSubtasks,
  onToggleSubtasks,
}: {
  column: TaskKanbanStateColumnDto;
  tasks: TaskKanbanCardDto[];
  canDrag: boolean;
  /** S5-TASK-BOARD-UX-1 — cần cho tạo nhanh: createTask({ projectId, stateId }). */
  projectId: string;
  onDragStartTask: (taskId: string) => (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (stateId: string) => (e: DragEvent<HTMLDivElement>) => void;
  onOpenTask?: (taskId: string) => void;
  expandedSubtasks: ReadonlySet<string>;
  onToggleSubtasks: (taskId: string) => void;
}) {
  const { t } = useTranslation("tasks");
  return (
    <div
      className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2"
      onDragOver={(e) => canDrag && e.preventDefault()}
      onDrop={onDrop(column.stateId)}
      data-testid={`kanban-state-column-${column.stateId}`}
    >
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: column.color }}
          />
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">{column.name}</h4>
        </div>
        <span
          className="text-xs text-muted-foreground"
          data-testid={`kanban-state-column-count-${column.stateId}`}
        >
          {column.taskCount}
        </span>
      </div>
      {/* Tạo nhanh ĐẦU cột, ngoài vùng cuộn → luôn thấy nút + việc mới nhập xong hiện ngay cạnh nút. */}
      <KanbanQuickCreate projectId={projectId} stateId={column.stateId} />
      <div className="flex min-h-24 max-h-[calc(100dvh-21rem)] flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
        {tasks.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t("tasks.kanban.columnEmpty")}</p>
        ) : (
          tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              draggable={canDrag}
              onDragStart={onDragStartTask(task.id)}
              onOpen={onOpenTask ? () => onOpenTask(task.id) : undefined}
              subtasksExpanded={expandedSubtasks.has(task.id)}
              onToggleSubtasks={() => onToggleSubtasks(task.id)}
              showStatus
            />
          ))
        )}
      </div>
    </div>
  );
}

export function TaskKanbanPage({
  projectId,
  filters = DEFAULT_WORKSPACE_FILTERS,
  assigneeSelection = EMPTY_SELECTION,
  onToggleAssignee,
  onClearAssignees,
  onOpenTask,
}: {
  projectId: string;
  /** Bộ lọc toolbar chung của workspace (mặc định: không lọc — mount độc lập vẫn chạy). */
  filters?: WorkspaceTaskFilters;
  /** Rail avatar multi-select; không truyền onToggleAssignee → ẨN rail (không có chỗ ghi state). */
  assigneeSelection?: ReadonlySet<string>;
  onToggleAssignee?: (value: string) => void;
  onClearAssignees?: () => void;
  /**
   * S5-TASK-BOARD-UX-1 — bấm thẻ mở chi tiết. Vỏ workspace truyền vào (nó quản `?task=` trên URL);
   * không truyền ⇒ thẻ không bấm được, board vẫn chạy như cũ.
   */
  onOpenTask?: (taskId: string) => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const canView = useCan(
    TASK_CORE_ENGINE_PAIRS.VIEW_KANBAN.action,
    TASK_CORE_ENGINE_PAIRS.VIEW_KANBAN.resourceType,
  );
  const canDrag = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATUS.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATUS.resourceType,
  );
  // S5-TASK-PIPELINE-1 — kéo thẻ board pipeline = đổi CỘT (update-state:task, seed 0499); đổi
  // NHÓM cột server đòi thêm update-status (auto-map) — FE cứ gửi, 403 thì rollback + báo.
  const canDragState = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATE.resourceType,
  );
  // S5-TASK-CARDSUB-1 — thẻ nào đang bung việc con. Giữ Ở BOARD (không trong từng thẻ) vì kéo-thả
  // làm thẻ remount sang cột khác; state cục bộ sẽ tự thu lại giữa chừng thao tác.
  const [expandedSubtasks, setExpandedSubtasks] = useState<ReadonlySet<string>>(new Set());
  const toggleSubtasks = (taskId: string) =>
    setExpandedSubtasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  const [dragErrorKey, setDragErrorKey] = useState<string | null>(null);
  const queryKey = taskKeys.kanban(projectId);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => taskCollabApi.getKanbanBoard(projectId),
    enabled: canView,
    staleTime: 15_000,
  });

  // Rail đếm theo tập ĐÃ lọc toolbar nhưng TRƯỚC lọc assignee (bật 1 người không triệt tiêu số
  // người khác); pinSelectedInSummary GHIM người đang chọn (count 0) để luôn còn nút gỡ.
  const railSummary = useMemo(() => {
    const allTasks = (data?.columns ?? []).flatMap((col) => col.tasks);
    return pinSelectedInSummary(
      buildAssigneeSummary(allTasks.filter((task) => matchesWorkspaceFilters(task, filters))),
      assigneeSelection,
      allTasks,
    );
  }, [data, filters, assigneeSelection]);

  // Lọc + sắp per-column MEMO theo [data, filters, selection] — re-render vì kéo-thả lỗi/dialog
  // không lọc lại 500 card (mirror kỷ luật useMemo của ProjectTaskListTab). Key = stateId/status.
  const visibleTasksByColumn = useMemo(() => {
    const map = new Map<string, TaskKanbanCardDto[]>();
    for (const col of data?.columns ?? []) {
      map.set(
        col.columnMode === "state" ? col.stateId : col.status,
        sortWorkspaceTasks(
          col.tasks.filter(
            (task) =>
              matchesWorkspaceFilters(task, filters) &&
              matchesAssigneeSelection(task, assigneeSelection),
          ),
          filters.sort,
        ),
      );
    }
    return map;
  }, [data, filters, assigneeSelection]);

  const moveMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskCoreStatusDto }) =>
      taskCollabApi.moveTask(taskId, { status }),
    onMutate: async ({ taskId, status }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TaskKanbanBoardDto>(queryKey);
      if (previous) {
        let moved: TaskKanbanCardDto | undefined;
        const withoutMoved = previous.columns.map((col) => {
          const found = col.tasks.find((tk) => tk.id === taskId);
          if (found) moved = found;
          return { ...col, tasks: col.tasks.filter((tk) => tk.id !== taskId) };
        });
        if (moved) {
          const patched = { ...moved, status };
          // Narrow theo columnMode (union S5-TASK-PIPELINE-1) — optimistic chỉ áp cột status;
          // board state-mode (kéo theo CỘT pipeline qua move-state) thuộc lane pipeline-fe.
          const nextColumns = withoutMoved.map((col) =>
            col.columnMode === "status" && col.status === status
              ? { ...col, tasks: [patched, ...col.tasks] }
              : col,
          );
          queryClient.setQueryData<TaskKanbanBoardDto>(queryKey, {
            ...previous,
            columns: nextColumns,
          });
        }
      }
      setDragErrorKey(null);
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      setDragErrorKey(moveErrorKey(err));
    },
    onSettled: (_data, _error, variables) => {
      for (const key of taskCollabInvalidation.kanban(projectId, variables.taskId))
        void queryClient.invalidateQueries({ queryKey: key });
      for (const key of taskCoreInvalidation.list())
        void queryClient.invalidateQueries({ queryKey: key });
      for (const key of taskCoreInvalidation.my())
        void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  // S5-TASK-PIPELINE-1 — kéo thẻ board pipeline: đổi CỘT qua move-state, optimistic + rollback 4xx.
  const moveStateMutation = useMutation({
    mutationFn: ({ taskId, stateId }: { taskId: string; stateId: string }) =>
      taskCollabApi.moveTaskState(taskId, { stateId }),
    onMutate: async ({ taskId, stateId }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TaskKanbanBoardDto>(queryKey);
      if (previous) {
        let moved: TaskKanbanCardDto | undefined;
        const withoutMoved = previous.columns.map((col) => {
          const found = col.tasks.find((tk) => tk.id === taskId);
          if (found) moved = found;
          if (!found) return col;
          const nextTasks = col.tasks.filter((tk) => tk.id !== taskId);
          return col.columnMode === "state"
            ? { ...col, tasks: nextTasks, taskCount: Math.max(0, col.taskCount - 1) }
            : { ...col, tasks: nextTasks };
        });
        if (moved) {
          const patched = { ...moved, stateId };
          const nextColumns = withoutMoved.map((col) =>
            col.columnMode === "state" && col.stateId === stateId
              ? { ...col, tasks: [patched, ...col.tasks], taskCount: col.taskCount + 1 }
              : col,
          );
          queryClient.setQueryData<TaskKanbanBoardDto>(queryKey, {
            ...previous,
            columns: nextColumns,
          });
        }
      }
      setDragErrorKey(null);
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      setDragErrorKey(moveErrorKey(err));
    },
    onSettled: (_data, _error, variables) => {
      for (const key of taskCollabInvalidation.kanban(projectId, variables.taskId))
        void queryClient.invalidateQueries({ queryKey: key });
      for (const key of taskCoreInvalidation.list())
        void queryClient.invalidateQueries({ queryKey: key });
      for (const key of taskCoreInvalidation.my())
        void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const onDragStartTask = (taskId: string) => (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("text/plain", taskId);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDropState = (stateId: string) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!canDragState) return;
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    const current = data?.columns.flatMap((c) => c.tasks).find((tk) => tk.id === taskId);
    if (!current || current.stateId === stateId) return; // cùng cột = no-op, không gọi API
    moveStateMutation.mutate({ taskId, stateId });
  };

  const onDrop = (status: TaskCoreStatusDto) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!canDrag) return;
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    const current = data?.columns.flatMap((c) => c.tasks).find((tk) => tk.id === taskId);
    if (!current || current.status === status) return;
    moveMutation.mutate({ taskId, status });
  };

  if (!canView) {
    return (
      <EmptyState
        title={t("tasks.kanban.forbidden.title")}
        description={t("tasks.kanban.forbidden.description")}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-64 w-72 shrink-0 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        title={t("tasks.kanban.error.title")}
        description={t("tasks.kanban.error.description")}
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t("actions.retry", { ns: "common" })}
          </Button>
        }
      />
    );
  }

  // S5-TASK-PIPELINE-1 — 2 chế độ LOẠI TRỪ NHAU theo columnMode (API-06 §15.1: client rẽ nhánh theo
  // discriminant, không đoán theo sự có mặt của trường). Server trả đồng nhất 1 mode per-project.
  const stateColumns = (data?.columns ?? []).filter(
    (col): col is TaskKanbanStateColumnDto => col.columnMode === "state",
  );
  const statusColumns = (data?.columns ?? []).filter(
    (col): col is TaskKanbanStatusColumnDto => col.columnMode === "status",
  );
  const isStateMode = stateColumns.length > 0;
  const totalTasks = (data?.columns ?? []).reduce((sum, col) => sum + col.tasks.length, 0);

  // Status-mode giữ hành vi cũ: 0 task ⇒ EmptyState. State-mode LUÔN hiện cột (kể cả rỗng) —
  // board là nơi tạo việc, giấu cột đi thì không thấy pipeline.
  if (!isStateMode && totalTasks === 0) {
    return (
      <EmptyState
        title={t("tasks.kanban.empty.title")}
        description={t("tasks.kanban.empty.description")}
      />
    );
  }

  const canDragBoard = isStateMode ? canDragState : canDrag;
  const showRail = onToggleAssignee !== undefined;
  const noopClear = () => {};

  return (
    <div className="space-y-3">
      {/* Nút "Quản lý cột" đã CHUYỂN vào tab Cài đặt của dự án (ProjectSettingsTab). */}
      {!canDragBoard && (
        <p className="text-xs text-muted-foreground">{t("tasks.kanban.readOnlyHint")}</p>
      )}
      {dragErrorKey && (
        <p role="alert" className="text-sm text-destructive">
          {t(dragErrorKey)}
        </p>
      )}
      <div className="flex items-start gap-3">
        <Card className="min-w-0 flex-1 overflow-x-auto p-3">
          <div className="flex gap-3">
            {isStateMode
              ? stateColumns.map((col) => (
                  <StateKanbanColumn
                    key={col.stateId}
                    column={col}
                    tasks={visibleTasksByColumn.get(col.stateId) ?? []}
                    canDrag={canDragState}
                    projectId={projectId}
                    onDragStartTask={onDragStartTask}
                    onDrop={onDropState}
                    onOpenTask={onOpenTask}
                    expandedSubtasks={expandedSubtasks}
                    onToggleSubtasks={toggleSubtasks}
                  />
                ))
              : statusColumns.map((col) => (
                  <KanbanColumn
                    key={col.status}
                    status={col.status}
                    tasks={visibleTasksByColumn.get(col.status) ?? []}
                    totalCount={col.tasks.length}
                    canDrag={canDrag}
                    onDragStartTask={onDragStartTask}
                    onDrop={onDrop}
                    onOpenTask={onOpenTask}
                    expandedSubtasks={expandedSubtasks}
                    onToggleSubtasks={toggleSubtasks}
                  />
                ))}
          </div>
        </Card>
        {showRail && (
          <AssigneeRail
            summary={railSummary}
            selection={assigneeSelection}
            onToggle={onToggleAssignee}
            onClear={onClearAssignees ?? noopClear}
          />
        )}
      </div>
    </div>
  );
}
