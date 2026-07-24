import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { taskCoreApi, taskKeys, useCan, useCanExact, ApiError } from "@mediaos/web-core";
import {
  EmptyState,
  Button,
  Card,
  Avatar,
  Popover,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@mediaos/ui";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { TaskOverdueBadge } from "./TaskStatusBadge";
import {
  TaskStateField,
  TaskStatusField,
  TaskPriorityField,
  TaskDeadlineField,
  TaskAssigneeField,
  TaskTitleField,
  TaskDescriptionField,
} from "./TaskInlineFields";
import { TaskGoalField } from "./TaskGoalField";
import { TaskWatchersPanel } from "./TaskWatchersPanel";
import { TaskLabelStrip } from "./TaskLabelPicker";
import { TaskMoveProjectDialog } from "./TaskMoveProjectDialog";
import { TaskFormDrawer } from "./TaskFormDrawer";
import { DeleteTaskDialog } from "./DeleteTaskDialog";
import { TaskCommentThread } from "./TaskCommentThread";
import { TaskSubtaskPanel } from "./TaskSubtaskPanel";
import { TaskChecklistPanel } from "./TaskChecklistPanel";
import { TaskActivityTimeline } from "./TaskActivityTimeline";
import { TaskFilePanel } from "./TaskFilePanel";

/**
 * TaskDetailContent — THÂN màn chi tiết task (SPEC-06 §13.7, TASK-SCREEN-007), dùng chung cho hai
 * lối vào: trang riêng `/tasks/:taskId` (`variant="page"`) và panel trượt phải mở từ board
 * (`variant="drawer"`). Tách ở S5-TASK-BOARD-UX-1 để không nhân bản khối nội dung.
 *
 * BỐ CỤC (S5-TASK-LAYOUT-1, benchmark MISA AMIS — owner gửi ảnh 2026-07-20):
 *   1. Dải đầu HAI DÒNG: dòng trên = dự án; dòng dưới = trạng thái + mức ưu tiên (hai thứ quyết định
 *      "việc này đang ở đâu, gấp cỡ nào" nên đứng riêng một dòng, không lẫn vào lưới).
 *   2. Tiêu đề + mô tả SỬA TẠI CHỖ.
 *   3. Lưới thông tin gọn: người phụ trách hiện AVATAR + TÊN (thứ hay nhìn nhất); các vai còn lại
 *      (người giao việc, người tạo) chỉ avatar + tên nhỏ, không chiếm một ô riêng mỗi người.
 *   4. HAI NHÓM TAB thay 5 thẻ rời — trước đây Việc con · Checklist · Bình luận · Lịch sử · Tệp xếp
 *      dọc, màn hình dài lê thê và phải cuộn qua khối rỗng để tới khối cần:
 *        · nhóm "Phân rã": Việc con | Checklist
 *        · nhóm "Trao đổi": Bình luận | Tệp đính kèm | Hoạt động
 *   5. KHÔNG còn nút "Sửa công việc": mọi trường hay dùng đã sửa được tại chỗ. Form đầy đủ (phòng
 *      ban, ngày bắt đầu — không có ô inline) và Xoá lui vào menu `⋯`, mirror MISA.
 *
 * Mỗi khối con tự gate quyền finer bên trong; Xoá gate ở đây (delete:task, useCanExact fail-closed).
 */

/** Một vai (người giao việc / người tạo) — avatar + tên, gọn hơn một ô riêng cho mỗi người. */
function RoleChip({ label, name }: { label: string; name: string | null }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1.5">
        <Avatar size="sm" name={name} />
        <span className="truncate text-sm text-foreground">{name ?? "—"}</span>
      </div>
    </div>
  );
}

/**
 * Dải đầu hai dòng. Trạng thái/ưu tiên để control THƯỜNG (không `compact`) trên dòng riêng — bản
 * trước nhét cả ba vào một hàng nên hai select bị bóp nhỏ, khó đọc đúng thứ owner phàn nàn.
 */
function TaskHeaderStrip({ task }: { task: TaskCoreResponseDto }) {
  const { t } = useTranslation("tasks");
  const [moveOpen, setMoveOpen] = useState(false);
  // S5-TASK-MOVEPROJ-1 — đổi dự án gửi kèm stateId nên đòi ĐỦ HAI cặp; thiếu một ⇒ ẩn nút thay vì
  // hiện rồi 403 (UI-02 §5.3). Server vẫn là người quyết cuối.
  const canUpdate = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE.resourceType,
  );
  const canSetState = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATE.resourceType,
  );
  const canMove = canUpdate && canSetState;

  return (
    <div
      className="space-y-3 rounded-lg border border-border bg-muted/30 px-4 py-3"
      data-testid="task-header-strip"
    >
      {/* Dòng 1 — dự án */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          {t("tasks.detail.fields.project")}
        </span>
        <span className="truncate text-sm font-semibold text-foreground">
          {task.projectName ?? "—"}
        </span>
        {/* Đổi dự án đi qua hộp thoại RIÊNG (không phải select tại chỗ): còn phải chọn CỘT đích của
            dự án mới, nếu không state_id sẽ mồ côi — xem docblock TaskMoveProjectDialog. */}
        {canMove && (
          <button
            type="button"
            onClick={() => setMoveOpen(true)}
            data-testid="task-move-project-open"
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground underline-offset-2 transition-colors hover:bg-muted hover:text-foreground hover:underline"
          >
            {t("tasks.moveProject.openAction")}
          </button>
        )}
      </div>

      {/* Dòng 2 — cột pipeline (nếu dự án có) + trạng thái + mức độ quan trọng */}
      <div className="flex flex-wrap items-end gap-3">
        <TaskStateField task={task} />
        <TaskStatusField task={task} />
        <TaskPriorityField task={task} />
        <TaskOverdueBadge isOverdue={task.isOverdue} />
      </div>

      {/* Dòng 3 — gắn thẻ (nhãn màu tự do, UX kiểu Base). Không thẻ + không quyền ⇒ strip tự ẩn. */}
      <TaskLabelStrip task={task} />

      {moveOpen && <TaskMoveProjectDialog task={task} onClose={() => setMoveOpen(false)} />}
    </div>
  );
}

/** Menu `⋯` — nơi chứa hành động HIẾM dùng, để đầu màn chỉ còn thông tin (mirror MISA). */
function TaskOverflowMenu({
  canUpdate,
  canDelete,
  onEdit,
  onDelete,
}: {
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("tasks");
  const [open, setOpen] = useState(false);
  if (!canUpdate && !canDelete) return null;

  const item =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted";

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-56 p-1"
      trigger={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={t("tasks.detail.actions.more")}
          data-testid="task-actions-menu"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      }
    >
      {canUpdate && (
        <button
          type="button"
          className={item}
          data-testid="task-action-edit"
          onClick={() => {
            setOpen(false);
            onEdit();
          }}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          {t("tasks.detail.actions.editMore")}
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          className={item}
          data-testid="task-action-delete"
          onClick={() => {
            setOpen(false);
            onDelete();
          }}
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
          {t("tasks.detail.actions.delete")}
        </button>
      )}
    </Popover>
  );
}

function InfoGrid({ task }: { task: TaskCoreResponseDto }) {
  const { t } = useTranslation("tasks");
  const readOnly: Array<[string, ReactNode]> = [
    [
      t("tasks.detail.fields.startAt"),
      task.startAt ? new Date(task.startAt).toLocaleString("vi-VN") : "—",
    ],
    [
      t("tasks.detail.fields.completedAt"),
      task.completedAt ? new Date(task.completedAt).toLocaleString("vi-VN") : "—",
    ],
  ];

  return (
    <Card className="space-y-4 p-4">
      {/* Hai ô SỬA ĐƯỢC đứng trước — đây là thứ người ta vào màn này để đổi. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <TaskAssigneeField task={task} />
        <TaskDeadlineField task={task} />
      </div>
      {/* S5-GOAL-FE-2 — "Mục tiêu" (GOAL-API-010): TaskGoalField TỰ gate two-gate (update:goal +
          update:task) và tự về chế độ chỉ-đọc khi thiếu — mount vô điều kiện ở đây. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <TaskGoalField task={task} />
      </div>
      <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* S5-TASK-DETAIL-1 (GAP 3) — đủ 3 vai; người phụ trách ở trên nên đây còn 2. */}
        <RoleChip label={t("tasks.detail.fields.reporter")} name={task.reporterName ?? null} />
        <RoleChip label={t("tasks.detail.fields.creator")} name={task.creatorName ?? null} />
        {readOnly.map(([label, value]) => (
          <div key={String(label)} className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <div className="text-sm text-foreground">{value}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * TaskDetailActions — cụm hành động hiếm dùng (menu ⋯ + hộp thoại Sửa/Xoá) tách riêng để hai lối
 * vào đặt ở hai chỗ khác nhau: trang riêng đặt cạnh tiêu đề trong thân; panel trượt đặt lên HEADER
 * của Sheet, cùng hàng với nút đóng — trước đây menu nằm trong thân drawer nên rớt xuống DƯỚI nút X,
 * lệch hàng (owner phàn nàn 2026-07-20).
 */
export function TaskDetailActions({
  task,
  onDeleted,
}: {
  task: TaskCoreResponseDto;
  /** Gọi sau khi xoá thành công — trang thì quay lại danh sách, drawer thì đóng panel. */
  onDeleted: () => void;
}) {
  const canUpdate = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE.resourceType,
  );
  const canDelete = useCanExact(
    TASK_CORE_ENGINE_PAIRS.DELETE.action,
    TASK_CORE_ENGINE_PAIRS.DELETE.resourceType,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <TaskOverflowMenu
        canUpdate={canUpdate}
        canDelete={canDelete}
        onEdit={() => setEditOpen(true)}
        onDelete={() => setDeleteOpen(true)}
      />
      {editOpen && (
        <TaskFormDrawer
          mode="edit"
          task={task}
          onClose={() => setEditOpen(false)}
          onSuccess={() => setEditOpen(false)}
        />
      )}
      {deleteOpen && (
        <DeleteTaskDialog task={task} onClose={() => setDeleteOpen(false)} onDeleted={onDeleted} />
      )}
    </>
  );
}

export function TaskDetailContent({
  taskId,
  onDeleted,
  variant = "page",
}: {
  taskId: string;
  /** Gọi sau khi xoá thành công — trang thì quay lại danh sách, drawer thì đóng panel. */
  onDeleted: () => void;
  variant?: "page" | "drawer";
}) {
  const { t } = useTranslation("tasks");
  const canView = useCan(
    TASK_CORE_ENGINE_PAIRS.READ.action,
    TASK_CORE_ENGINE_PAIRS.READ.resourceType,
  );
  // Tab mặc định của mỗi nhóm; state ở đây (không trong panel con) để đổi tab không mất dữ liệu đã tải.
  const [breakdownTab, setBreakdownTab] = useState("subtasks");
  const [collabTab, setCollabTab] = useState("comments");
  const isDrawer = variant === "drawer";

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: () => taskCoreApi.getTask(taskId),
    enabled: canView,
    staleTime: 30_000,
  });

  if (!canView) {
    return (
      <EmptyState
        title={t("tasks.detail.forbidden.title")}
        description={t("tasks.detail.forbidden.description")}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && (error.status === 404 || error.status === 403);
    return (
      <EmptyState
        title={notFound ? t("tasks.detail.notFound.title") : t("tasks.detail.error.title")}
        description={
          notFound ? t("tasks.detail.notFound.description") : t("tasks.detail.error.description")
        }
        action={
          notFound ? undefined : (
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          )
        }
      />
    );
  }

  if (!data) return null;
  const task = data;

  return (
    <div className="space-y-4">
      {/* Hàng tiêu đề + menu ⋯ — CHỈ ở trang riêng. Trong drawer, Sheet đã hiện tiêu đề ở header
          và TaskDetailDrawer tự đặt TaskDetailActions lên header đó (cùng hàng nút đóng). */}
      {!isDrawer && (
        <div className="flex items-start justify-between gap-2">
          <TaskTitleField task={task} />
          <TaskDetailActions task={task} onDeleted={onDeleted} />
        </div>
      )}

      <TaskHeaderStrip task={task} />

      <InfoGrid task={task} />

      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {t("tasks.detail.fields.description")}
        </h3>
        <TaskDescriptionField task={task} />
      </Card>

      <TaskWatchersPanel task={task} />

      {/* Nhóm tab 1 — phân rã công việc */}
      <Card className="p-0">
        <Tabs value={breakdownTab} onValueChange={setBreakdownTab}>
          <TabsList className="px-2 pt-1">
            <TabsTrigger value="subtasks">{t("tasks.detail.tabs.subtasks")}</TabsTrigger>
            <TabsTrigger value="checklist">{t("tasks.detail.tabs.checklist")}</TabsTrigger>
          </TabsList>
          {/* TabsContent unmount tab ẩn ⇒ panel con hủy mount. Không sao: dữ liệu nằm ở cache React
              Query (khoá theo taskId), quay lại tab là hiện ngay, không gọi lại API trong staleTime. */}
          <TabsContent value="subtasks" className="p-4">
            <TaskSubtaskPanel taskId={task.id} embedded />
          </TabsContent>
          <TabsContent value="checklist" className="p-4">
            <TaskChecklistPanel taskId={task.id} embedded />
          </TabsContent>
        </Tabs>
      </Card>

      {/* Nhóm tab 2 — trao đổi & dấu vết */}
      <Card className="p-0">
        <Tabs value={collabTab} onValueChange={setCollabTab}>
          <TabsList className="px-2 pt-1">
            <TabsTrigger value="comments">{t("tasks.detail.tabs.comments")}</TabsTrigger>
            <TabsTrigger value="files">{t("tasks.detail.tabs.files")}</TabsTrigger>
            <TabsTrigger value="activity">{t("tasks.detail.tabs.activity")}</TabsTrigger>
          </TabsList>
          <TabsContent value="comments" className="p-4">
            <TaskCommentThread taskId={task.id} embedded />
          </TabsContent>
          <TabsContent value="files" className="p-4">
            <TaskFilePanel taskId={task.id} projectId={task.projectId} embedded />
          </TabsContent>
          <TabsContent value="activity" className="p-4">
            <TaskActivityTimeline taskId={task.id} embedded />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
