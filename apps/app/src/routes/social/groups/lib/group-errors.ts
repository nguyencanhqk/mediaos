/**
 * S16-SOCIAL-FE-2B — đọc LÝ DO của một lỗi ghi ở màn Nhóm (plan D3 + §8 M7).
 *
 * ┌─ VÌ SAO PHẢI ĐỌC TIỀN TỐ `message` ────────────────────────────────────────────────────────────┐
 * │ Service SOCIAL ném CHUỖI (`new ConflictException("SOCIAL-ERR-015: …")`), nên `AllExceptionsFilter`│
 * │ gán `error.code` = mã CHUNG theo status (`RESOURCE-ERR-CONFLICT` · `-NOT-FOUND` ·               │
 * │ `AUTH-ERR-FORBIDDEN`). Mã `SOCIAL-ERR-0xx` CHỈ còn ở đầu `message` — `ApiError.message` giữ     │
 * │ nguyên chuỗi đó. `038` trả 409 cho CẢ ERR-013 (lệch trạng thái) lẫn ERR-015 (chủ nhóm cuối) ⇒  │
 * │ status một mình không đủ để nói «hãy phong người khác làm chủ nhóm trước».                      │
 * │ Định dạng tiền tố được giữ phía BE bởi `social-error-code-census.spec.ts`. Nợ BE: đặt `code`   │
 * │ vào payload như ROOM/ASSET (`S16-SOCIAL-GROUPERR-1`) — khi đó đổi hàm này sang đọc `code`.      │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Hai lỗi nhóm KHÔNG có số (`GROUP_NAME_TAKEN` · `GROUP_MEMBER_NOT_FOUND`, `social.errors.ts:203,214`)
 * được nhận theo NGỮ CẢNH route + status, KHÔNG theo câu chữ: câu chữ không số không có lưới nào giữ.
 */
import { ApiError } from "@mediaos/web-core";
import type { ActionErrorReason } from "../../feed/components/ActionErrorBanner";

/** Thao tác ghi của màn Nhóm — quyết định cách đọc một status mơ hồ. */
export type GroupAction =
  | "create"
  | "update"
  | "delete"
  | "join"
  | "leave"
  | "decide"
  | "role"
  | "remove"
  | "post";

/**
 * Lý do CỤ THỂ đáng nói với người dùng; `null` ⇒ banner forbidden/generic như mọi màn khác. Cùng MỘT
 * tập với `ActionErrorBanner` (khoá `actionError.reason.*`) — không khai lại.
 */
export type GroupErrorReason = ActionErrorReason;

const SOCIAL_CODE_RE = /^SOCIAL-ERR-(\d{3}):/;
/** Mã của interceptor idempotency CÓ đặt `code` vào payload (`contracts/idempotency.ts`). */
const IDEMPOTENCY_CODE_PREFIX = "REQUEST-ERR-IDEMPOTENCY";

/** `"SOCIAL-ERR-015"` từ tiền tố `message` của một `ApiError`; `null` với mọi thứ khác (ZodError, Error…). */
export function socialErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const m = SOCIAL_CODE_RE.exec(err.message);
  return m ? `SOCIAL-ERR-${m[1]}` : null;
}

export function groupErrorReason(action: GroupAction, err: unknown): GroupErrorReason | null {
  if (!(err instanceof ApiError)) return null;
  const code = socialErrorCode(err);
  if (code === "SOCIAL-ERR-015") return "lastOwner";
  if (code === "SOCIAL-ERR-012") return "groupGone";
  if (code === "SOCIAL-ERR-013") return action === "join" ? "alreadyMember" : "stateChanged";
  if (err.status === 409 && (action === "create" || action === "update")) {
    // 031/033: 409 duy nhất của service là tên trùng; 409 idempotency mang `code` riêng.
    return err.code.startsWith(IDEMPOTENCY_CODE_PREFIX) ? null : "nameTaken";
  }
  if (err.status === 404 && (action === "leave" || action === "decide" || action === "role" || action === "remove")) {
    // 404 KHÔNG số = `GROUP_MEMBER_NOT_FOUND` — người đó không còn hàng (người khác đã xử lý trước).
    return "stateChanged";
  }
  return null;
}

/** 403 — người dùng cần hỏi quản trị, thử lại là vô ích (khuôn `ActionErrorBanner.forbidden`). */
export function isForbiddenError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

/**
 * Lỗi có nghĩa «thứ tôi đang thấy đã CŨ» ⇒ kéo lại nhóm để màn tự hiện trạng thái thật (plan D15 +
 * §8 M5a): 403 (vai của tôi đã đổi) · 404 (nhóm/hàng không còn) · 409 (trạng thái đổi dưới chân).
 */
export function isStaleStateError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 403 || err.status === 404 || err.status === 409);
}
