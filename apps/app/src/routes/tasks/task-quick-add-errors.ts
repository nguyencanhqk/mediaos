import { parseKindError } from "@mediaos/web-core";

/**
 * S20-TASK-QUICKADD-1 — phân loại lỗi của `POST /tasks` (tạo nhanh · form Tạo).
 *
 * Đọc qua `parseKindError` của error-mapper. Lỗi nghiệp vụ của task-core đặt mã slug ở ĐẦU thông điệp
 * (`task-core.service.ts` `ERR.*`); `error.code` của envelope chỉ là mã theo HTTP status ⇒ đọc tiền tố.
 * Câu chữ hiển thị là khoá i18n — KHÔNG đổ thông điệp thô của server lên màn hình.
 */
export type TaskCreateErrorKind = "assignee" | "forbidden" | "badRequest" | "network" | "generic";

/**
 * Server từ chối VÌ người phụ trách: ngoài phạm vi giao (403) · không tồn tại / ngưng hoạt động / chưa
 * có tài khoản (400) · không phải thành viên đang hoạt động của dự án (400) · phạm vi tạo hẹp mà không
 * chỉ định người (403 — `CREATE_ASSIGNEE_REQUIRED` mang slug chung `TASK-ERR-FORBIDDEN`, trên đường
 * tạo việc chỉ nhánh đó dùng slug này).
 */
const ASSIGNEE_REJECTION_SLUGS: readonly string[] = [
  "TASK-ERR-TASK-ASSIGNEE-OUT-OF-SCOPE",
  "TASK-ERR-TASK-ASSIGNEE-NOT-FOUND",
  "TASK-ERR-TASK-ASSIGNEE-INACTIVE",
  "TASK-ERR-TASK-ASSIGNEE-NO-ACCOUNT",
  "TASK-ERR-ASSIGNEE-INVALID",
  "TASK-ERR-FORBIDDEN",
];

/** Khớp NGUYÊN mã (`SLUG` hoặc `SLUG: …`) — `TASK-ERR-FORBIDDEN` không được khớp `TASK-ERR-FORBIDDEN-X`. */
function hasSlug(code: string | null, message: string, slug: string): boolean {
  return code === slug || message === slug || message.startsWith(`${slug}:`);
}

export function classifyTaskCreateError(error: unknown): TaskCreateErrorKind {
  const { status, code, message } = parseKindError(error);
  // Không phải ApiError (fetch ném TypeError khi mất mạng) hoặc status 0 ⇒ chưa tới server.
  if (status === null || status === 0) return "network";
  if (ASSIGNEE_REJECTION_SLUGS.some((slug) => hasSlug(code, message, slug))) return "assignee";
  if (status === 403) return "forbidden";
  if (status === 400 || status === 422) return "badRequest";
  return "generic";
}

export function isAssigneeRejection(error: unknown): boolean {
  return classifyTaskCreateError(error) === "assignee";
}
