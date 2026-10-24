import type { DragEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  TaskCoreStatusDto,
  TaskKanbanCardDto,
  TaskKanbanStateColumnDto,
} from "@mediaos/contracts";
import { KanbanCard } from "./KanbanCard";
import { KanbanQuickCreate } from "./KanbanQuickCreate";
import type { KanbanMoveProps } from "./KanbanCardMoveMenu";

/**
 * Cột board (tách khỏi TaskKanbanPage ở S20-TASK-FEDEBT-1; hành vi giữ nguyên):
 * - `KanbanColumn` — chế độ status (S4-FE-TASK-3): header = nhãn trạng thái + SỐ GỐC của cột (SPEC-06
 *   §13.8 — không đổi theo bộ lọc).
 * - `StateKanbanColumn` — chế độ pipeline (S5-TASK-PIPELINE-1, columnMode:'state'): tên/màu/đếm từ chính
 *   cột, tạo nhanh đầu cột, thẻ hiện badge status để người dùng thấy auto-map.
 * Vùng thả là div cột cha; danh sách thẻ tự cuộn TRONG cột (header đứng yên).
 */
interface ColumnCardsProps {
  tasks: TaskKanbanCardDto[];
  canDrag: boolean;
  columnId: string;
  onDragStartTask: (taskId: string) => (e: DragEvent<HTMLDivElement>) => void;
  onOpenTask?: (taskId: string) => void;
  expandedSubtasks: ReadonlySet<string>;
  onToggleSubtasks: (taskId: string) => void;
  move: KanbanMoveProps;
  showStatus?: boolean;
}

function ColumnCards({
  tasks,
  canDrag,
  columnId,
  onDragStartTask,
  onOpenTask,
  expandedSubtasks,
  onToggleSubtasks,
  move,
  showStatus,
}: ColumnCardsProps) {
  const { t } = useTranslation("tasks");
  return (
    // calc ≈ topbar + header project + tabs; min-h giữ vùng thả khi cột rỗng.
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
            showStatus={showStatus}
            move={move}
            columnId={columnId}
          />
        ))
      )}
    </div>
  );
}

type SharedColumnProps = Omit<ColumnCardsProps, "columnId" | "showStatus">;

export function KanbanColumn({
  status,
  totalCount,
  onDrop,
  ...cards
}: SharedColumnProps & {
  status: TaskCoreStatusDto;
  /** Tổng số task GỐC của cột (SPEC-06 §13.8) — header cột không đổi theo bộ lọc assignee. */
  totalCount: number;
  onDrop: (status: TaskCoreStatusDto) => (e: DragEvent<HTMLDivElement>) => void;
}) {
  const { t } = useTranslation("tasks");
  return (
    <div
      className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2"
      onDragOver={(e) => cards.canDrag && e.preventDefault()}
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
      <ColumnCards {...cards} columnId={status} />
    </div>
  );
}

export function StateKanbanColumn({
  column,
  projectId,
  onDrop,
  ...cards
}: SharedColumnProps & {
  column: TaskKanbanStateColumnDto;
  /** S5-TASK-BOARD-UX-1 — cần cho tạo nhanh: createTask({ projectId, stateId }). */
  projectId: string;
  onDrop: (stateId: string) => (e: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2"
      onDragOver={(e) => cards.canDrag && e.preventDefault()}
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
      <ColumnCards {...cards} columnId={column.stateId} showStatus />
    </div>
  );
}
