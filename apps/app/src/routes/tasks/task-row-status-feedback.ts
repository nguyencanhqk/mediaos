import type { TFunction } from "i18next";
import { toast } from "@mediaos/ui";
import type { TaskCoreStatusDto } from "@mediaos/contracts";
import { canTransitionTaskStatus } from "./task-status-transitions";
import { classifyTaskQuickEditError, taskQuickEditErrorKey } from "./task-quick-edit-errors";

/**
 * S20-TASK-QUICKEDIT-1 — phản hồi BẰNG TOAST cho đổi trạng thái trên dòng.
 *
 * Vì sao cần (lượt đo trình duyệt thật): «Hiện việc đã xong» tắt ⇒ chọn «Hoàn thành» làm dòng rời
 * danh sách ngay (lạc quan). Không có toast thì người dùng không thấy dấu hiệu đã lưu; dòng đã unmount
 * nên lỗi server về SAU đó cũng không còn chỗ hiện dưới dòng. Toast sống ngoài dòng ⇒ báo được cả hai.
 *
 * Hoàn tác = MỘT lần change-status ngược lại qua đúng route đó (server ghi activity + audit như thường),
 * chỉ mời khi FSM cho chuyển ngược (vd Đang làm → Đã hủy thì Đã hủy → Đang làm được; Chờ review → Đã
 * hủy thì không). Lượt hoàn tác không mời hoàn tác lần nữa.
 */
export interface TaskRowStatusChange {
  readonly to: TaskCoreStatusDto;
  readonly from: TaskCoreStatusDto | null;
  readonly isUndo?: boolean;
}

/** Lượt hoàn tác của một thay đổi; `null` khi không hoàn tác được (lượt hoàn tác, NULL, FSM cấm). */
export function undoOf(change: TaskRowStatusChange): TaskRowStatusChange | null {
  const { from, to } = change;
  if (change.isUndo || from === null || from === to) return null;
  if (!canTransitionTaskStatus(to, from)) return null;
  return { to: from, from: to, isUndo: true };
}

/**
 * Một toast mỗi việc: đổi liên tiếp trên cùng dòng ĐÓNG toast cũ rồi mở toast mới. Không dựa vào gộp
 * theo `key` của store: bản gộp giữ `action` cũ khi toast mới không có action ⇒ «Hoàn tác» cũ còn
 * nằm trên toast của một thay đổi không hoàn tác được.
 */
const lastToastByTask = new Map<string, string>();

function replaceTaskToast(taskId: string, show: (key: string) => string): void {
  const previous = lastToastByTask.get(taskId);
  if (previous) toast.dismiss(previous);
  lastToastByTask.set(taskId, show(`task-row-status:${taskId}`));
}

export function notifyTaskRowStatusSaved({
  t,
  taskId,
  title,
  change,
  onUndo,
}: {
  t: TFunction<"tasks">;
  taskId: string;
  title: string;
  change: TaskRowStatusChange;
  onUndo: (undo: TaskRowStatusChange) => void;
}): void {
  const undo = undoOf(change);
  replaceTaskToast(taskId, (key) =>
    toast.success(t("quickEdit.statusSaved", { title, status: t(`tasks.status.${change.to}`) }), {
      key,
      action: undo ? { label: t("quickEdit.undo"), onClick: () => onUndo(undo) } : undefined,
    }),
  );
}

export function notifyTaskRowStatusFailed({
  t,
  taskId,
  error,
  onRetry,
  onOpenChecklist,
}: {
  t: TFunction<"tasks">;
  taskId: string;
  error: unknown;
  onRetry: () => void;
  onOpenChecklist: () => void;
}): void {
  const kind = classifyTaskQuickEditError(error);
  const action =
    kind === "checklistRequired"
      ? { label: t("quickEdit.openChecklist"), onClick: onOpenChecklist }
      : kind === "network"
        ? { label: t("quickEdit.retry"), onClick: onRetry }
        : undefined;
  replaceTaskToast(taskId, (key) =>
    toast.error(t(taskQuickEditErrorKey("status", error)), { key, action }),
  );
}
