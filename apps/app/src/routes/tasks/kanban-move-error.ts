import { parseKindError } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";

/**
 * S20-TASK-FEDEBT-1 — server từ chối đổi cột (kéo-thả HAY menu ⋯ — chung một mutation) ⇒ báo lý do
 * qua thông báo nổi dùng chung (S20-FE-TOAST-1), thay cho dòng `role=alert` riêng ở đầu board: người
 * đang ở cột xa bên phải / màn điện thoại không thấy dòng đó, còn vùng thông báo luôn trong tầm mắt và
 * đã có `aria-live` sẵn.
 *
 * Mã HTTP đọc qua `parseKindError` của error-mapper (không tự soi `ApiError`); câu chữ là khoá i18n
 * của board theo từng mã — KHÔNG đổ `message` thô của server lên màn hình.
 */
export function kanbanMoveErrorKey(err: unknown): string {
  const { status } = parseKindError(err);
  if (status === 409) return "tasks.kanban.errors.conflict";
  if (status === 403) return "tasks.kanban.errors.forbidden";
  if (status === 404) return "tasks.kanban.errors.notFound";
  // S5-TASK-PIPELINE-1 — kéo sang cột nhóm completed khi checklist bắt buộc chưa xong (400) /
  // cột không hợp lệ: server từ chối atomic, thẻ bật về chỗ cũ.
  if (status === 400) return "tasks.kanban.errors.badRequest";
  if (status !== null && status >= 500) return "tasks.kanban.errors.server";
  return "tasks.kanban.errors.generic";
}

/** Khoá gộp: từ chối liên tiếp cùng lý do ⇒ một thông báo kèm số lần, không chất đống. */
const MOVE_REJECTED_TOAST_PREFIX = "kanban-move-rejected";

export function notifyKanbanMoveRejected(err: unknown, translate: (key: string) => string): void {
  const key = kanbanMoveErrorKey(err);
  toast.error(translate(key), { key: `${MOVE_REJECTED_TOAST_PREFIX}:${key}` });
}
