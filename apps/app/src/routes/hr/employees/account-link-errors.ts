import { ApiError } from "@mediaos/web-core";

/**
 * account-link-errors.ts — S5-HR-LINKUI-1 (HR-FUNC-011). Map lỗi POST/DELETE
 * `/hr/employees/:id/link-user` → i18n key vi RÕ theo tình huống (SPEC-03 §20 HR-ERR-027/028).
 *
 * BE (hr-write.service.ts linkUser/unlinkUser) ném NestJS exception CHUNG (Conflict/NotFound/Forbidden)
 * — KHÔNG gắn `error.code` riêng cho từng case (AllExceptionsFilter fallback httpStatusToCode ⇒ MỌI
 * 409 đều ra `RESOURCE-ERR-CONFLICT`, xem apps/api/src/common/errors/error-codes.ts). Vì vậy FE phân
 * biệt HR-ERR-027 (employee đã có user) / HR-ERR-028 (user đã liên kết employee khác) bằng cách đối
 * chiếu message tiếng Anh literal của service — ổn định vì FE/BE cùng monorepo, đổi văn án BE cần đồng
 * bộ ở đây. Luôn trả về i18n KEY (không hiển thị message gốc của server) — tránh rò chi tiết nội bộ.
 */
export function linkUserErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    const msg = err.message;
    if (err.status === 409 && msg.includes("Employee already has a linked user")) {
      return "accountLink.errors.employeeAlreadyLinked"; // HR-ERR-027
    }
    if (err.status === 409 && msg.includes("already linked to another active employee")) {
      return "accountLink.errors.userAlreadyLinked"; // HR-ERR-028
    }
    if (err.status === 404 && msg.includes("Employee not found")) {
      return "accountLink.errors.employeeNotFound";
    }
    if (err.status === 404) return "accountLink.errors.userNotFound";
    if (err.status === 403) return "accountLink.errors.forbidden";
  }
  return "accountLink.errors.generic";
}

export function unlinkUserErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "accountLink.errors.noLinkedUser";
    if (err.status === 403 && err.message.includes("unlink your own account")) {
      return "accountLink.errors.cannotUnlinkSelf";
    }
    if (err.status === 403) return "accountLink.errors.forbidden";
    if (err.status === 404) return "accountLink.errors.employeeNotFound";
  }
  return "accountLink.errors.generic";
}
