import { parseKindError } from "@mediaos/web-core";

/**
 * S20-TASK-QUICKEDIT-1 — phân loại lỗi của thao tác sửa nhanh (đổi trạng thái / đổi hạn trên dòng).
 *
 * Đọc lỗi qua `parseKindError` của error-mapper (không tự soi `ApiError`). Hai lỗi nghiệp vụ của route
 * action là `BadRequestException` mà mã slug nằm ở ĐẦU thông điệp (`task-actions.service.ts`:
 * `TASK-ERR-CHECKLIST-REQUIRED`, `TASK-ERR-INVALID-DATE-RANGE`) — `error.code` của envelope chỉ là mã
 * theo HTTP status, nên phải đọc tiền tố thông điệp. Câu chữ hiển thị là khoá i18n, KHÔNG đổ thông
 * điệp thô của server lên màn hình.
 */
export type TaskQuickEditErrorKind =
  | "checklistRequired"
  | "dateRange"
  | "forbidden"
  | "closed"
  | "conflict"
  | "network"
  | "generic";

const CHECKLIST_REQUIRED_SLUG = "TASK-ERR-CHECKLIST-REQUIRED";
const DATE_RANGE_SLUG = "TASK-ERR-INVALID-DATE-RANGE";
const TASK_CLOSED_SLUG = "TASK-ERR-TASK-CLOSED";

function hasSlug(code: string | null, message: string, slug: string): boolean {
  return code === slug || message.startsWith(slug);
}

export function classifyTaskQuickEditError(error: unknown): TaskQuickEditErrorKind {
  const { status, code, message } = parseKindError(error);
  // Không phải ApiError (fetch ném TypeError khi mất mạng) hoặc status 0 ⇒ chưa tới server.
  if (status === null || status === 0) return "network";
  if (status === 403) return "forbidden";
  if (hasSlug(code, message, CHECKLIST_REQUIRED_SLUG)) return "checklistRequired";
  if (hasSlug(code, message, DATE_RANGE_SLUG)) return "dateRange";
  if (hasSlug(code, message, TASK_CLOSED_SLUG)) return "closed";
  if (status === 409) return "conflict";
  return "generic";
}

/** Trường đang sửa — câu chữ «không có quyền» khác nhau giữa trạng thái, hạn và người phụ trách. */
export type TaskQuickEditField = "status" | "deadline" | "assignee";

/** Khoá i18n (namespace `tasks`, gốc `quickEdit.errors`) cho một lỗi của một trường. */
export function taskQuickEditErrorKey(field: TaskQuickEditField, error: unknown): string {
  const kind = classifyTaskQuickEditError(error);
  if (kind === "forbidden") return `quickEdit.errors.forbidden.${field}`;
  return `quickEdit.errors.${kind}`;
}
