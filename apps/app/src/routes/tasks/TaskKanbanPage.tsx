import { useMemo, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  taskCollabApi,
  taskKeys,
  taskCollabInvalidation,
  taskCoreInvalidation,
  goalInvalidation,
  useCan,
} from "@mediaos/web-core";
import { Card, Button, EmptyState } from "@mediaos/ui";
import type {
  TaskCoreStatusDto,
  TaskKanbanBoardDto,
  TaskKanbanCardDto,
  TaskKanbanStateColumnDto,
  TaskKanbanStatusColumnDto,
} from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { AssigneeRail } from "./AssigneeRail";
import { useKanbanCardFocusReturn, type KanbanMoveProps } from "./KanbanCardMoveMenu";
import { KanbanColumn, StateKanbanColumn } from "./KanbanColumns";
import { notifyKanbanMoveRejected } from "./kanban-move-error";
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
 *
 * S20-TASK-FEDEBT-1 — thẻ/cột tách sang `KanbanCard.tsx` · `KanbanColumns.tsx` (trang chỉ còn dữ
 * liệu + đổi cột). Server từ chối đổi cột (kéo-thả HAY menu ⋯) ⇒ lý do qua thông báo nổi dùng chung
 * (`kanban-move-error.ts`), không còn dòng `role=alert` riêng ở đầu board.
 */
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

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
  const requestFocusReturn = useKanbanCardFocusReturn();
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
      // S5-GOAL-FE-2 — nhặt mục tiêu neo của thẻ NGAY tại đây: onSettled chỉ có `variables.taskId`,
      // mà lúc đó cache board đã bị optimistic/refetch đè nên không còn tra ngược được goalId.
      let movedGoalId: string | null = null;
      if (previous) {
        let moved: TaskKanbanCardDto | undefined;
        const withoutMoved = previous.columns.map((col) => {
          const found = col.tasks.find((tk) => tk.id === taskId);
          if (found) moved = found;
          return { ...col, tasks: col.tasks.filter((tk) => tk.id !== taskId) };
        });
        movedGoalId = moved?.goalId ?? null;
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
      return { previous, movedGoalId };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      notifyKanbanMoveRejected(err, t);
    },
    onSettled: (_data, _error, variables, context) => {
      for (const key of taskCollabInvalidation.kanban(projectId, variables.taskId))
        void queryClient.invalidateQueries({ queryKey: key });
      for (const key of taskCoreInvalidation.list())
        void queryClient.invalidateQueries({ queryKey: key });
      for (const key of taskCoreInvalidation.my())
        void queryClient.invalidateQueries({ queryKey: key });
      // S5-GOAL-FE-2 — kéo thẻ sang Done/rời Done đổi % mục tiêu neo (SPEC-10 §13, mode 'tasks').
      if (context?.movedGoalId)
        for (const key of goalInvalidation.taskProgress(context.movedGoalId))
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
      // S5-GOAL-FE-2 — xem chú thích ở moveMutation. Kéo cột pipeline KHÔNG phải lúc nào cũng vô can
      // với mục tiêu: `applyStateChangeTx` (task-core.service.ts) có AUTO-MAP — cột đích khác nhóm
      // với status hiện tại thì nó gọi luôn `changeStatusTx`, tức status ĐỔI THẬT ⇒ % mục tiêu
      // (progress_mode='tasks') đổi theo. Bỏ qua vế này vì tưởng "state tách khỏi status" là sai.
      let movedGoalId: string | null = null;
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
        movedGoalId = moved?.goalId ?? null;
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
      return { previous, movedGoalId };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      notifyKanbanMoveRejected(err, t);
    },
    onSettled: (_data, _error, variables, context) => {
      for (const key of taskCollabInvalidation.kanban(projectId, variables.taskId))
        void queryClient.invalidateQueries({ queryKey: key });
      for (const key of taskCoreInvalidation.list())
        void queryClient.invalidateQueries({ queryKey: key });
      for (const key of taskCoreInvalidation.my())
        void queryClient.invalidateQueries({ queryKey: key });
      if (context?.movedGoalId)
        for (const key of goalInvalidation.taskProgress(context.movedGoalId))
          void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const onDragStartTask = (taskId: string) => (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("text/plain", taskId);
    e.dataTransfer.effectAllowed = "move";
  };

  // S20-TASK-BOARDMOVE-1 — lối vào đổi cột DUY NHẤT cho cả kéo-thả lẫn menu ⋯: cùng chốt quyền, cùng
  // no-op khi trùng cột, cùng mutation lạc quan + rollback ở trên. Không có taskId ⇒ không tìm thấy thẻ.
  const findTask = (taskId: string) =>
    data?.columns.flatMap((c) => c.tasks).find((tk) => tk.id === taskId);
  const moveToState = (taskId: string, stateId: string) => {
    if (!canDragState) return;
    const current = findTask(taskId);
    if (!current || current.stateId === stateId) return; // cùng cột = no-op, không gọi API
    moveStateMutation.mutate({ taskId, stateId });
  };
  const moveToStatus = (taskId: string, status: TaskCoreStatusDto) => {
    if (!canDrag) return;
    const current = findTask(taskId);
    if (!current || current.status === status) return;
    moveMutation.mutate({ taskId, status });
  };

  const onDropState = (stateId: string) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    moveToState(e.dataTransfer.getData("text/plain"), stateId);
  };

  const onDrop = (status: TaskCoreStatusDto) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    moveToStatus(e.dataTransfer.getData("text/plain"), status);
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
  // Chế độ status: liệt kê cột server trả (như vùng thả); FSM do server xét — 409 ⇒ rollback + lý do.
  const boardMove: KanbanMoveProps = {
    targets: isStateMode
      ? stateColumns.map((col) => ({ id: col.stateId, label: col.name }))
      : statusColumns.map((col) => ({ id: col.status, label: t(`tasks.status.${col.status}`) })),
    onMove: (taskId, targetId) => {
      requestFocusReturn(taskId);
      const status = statusColumns.find((col) => col.status === targetId)?.status;
      if (isStateMode) moveToState(taskId, targetId);
      else if (status) moveToStatus(taskId, status);
    },
  };
  const showRail = onToggleAssignee !== undefined;
  const noopClear = () => {};

  return (
    <div className="space-y-3">
      {/* Nút "Quản lý cột" đã CHUYỂN vào tab Cài đặt của dự án (ProjectSettingsTab). */}
      {!canDragBoard && (
        <p className="text-xs text-muted-foreground">{t("tasks.kanban.readOnlyHint")}</p>
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
                    move={boardMove}
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
                    move={boardMove}
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
