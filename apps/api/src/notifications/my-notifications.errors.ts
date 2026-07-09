/**
 * S4-NOTI-BE-1 — mã lỗi nghiệp vụ My-Notification API (SPEC-08 §19 — slug, KHÔNG số NOTI-ERR-XXX cũ).
 * Surface qua HttpException payload.code (AllExceptionsFilter đọc trực tiếp, xem leave-request.logic.ts
 * LEAVE_ERR cho pattern tương tự).
 */
export const NOTI_ERR = {
  NOT_FOUND: "NOTI-ERR-NOTIFICATION-NOT-FOUND",
  DELETED: "NOTI-ERR-NOTIFICATION-DELETED",
} as const;
