/**
 * S16-SOCIAL-FE-2B — đọc LÝ DO của một lỗi ghi ở màn Nhóm (plan D3 + §8 M7); S16-SOCIAL-GROUPERR-1 (D14)
 * chuyển sang đọc MÃ.
 *
 * ┌─ HAI HÌNH DẠNG TRÊN DÂY, CẢ HAI ĐANG THẬT ─────────────────────────────────────────────────────┐
 * │ **API MỚI** (từ GROUPERR-1): `error.code` = `SOCIAL_ERROR_CODES[K]` (contracts) — có số         │
 * │ `SOCIAL-ERR-0xx` hoặc sentinel `SOCIAL-ERR-<KHOÁ>`. Đọc thẳng mã, không đoán theo status.       │
 * │ **API CŨ**: service ném CHUỖI ⇒ `error.code` là mã CHUNG theo status (`RESOURCE-ERR-*` ·        │
 * │ `AUTH-ERR-FORBIDDEN`), mã chỉ ở tiền tố `message`. FE auto-deploy khi merge còn API deploy tay  │
 * │ ⇒ có một khoảng FE mới gặp API cũ (owner ký O4): nhánh **LEGACY-PREFIX** giữ nguyên hành vi cũ   │
 * │ cho hình dạng đó. Gỡ ở `S16-SOCIAL-GROUPERR-FEFALLBACK-1` SAU khi PROD API đã lên bản có mã.     │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * `038` trả 409 cho CẢ `SOCIAL-ERR-013` (lệch trạng thái) lẫn `015` (chủ nhóm cuối) ⇒ status một mình
 * không đủ để nói «hãy phong người khác làm chủ nhóm trước». `013` còn dùng chung cho «đã là thành viên»
 * (join) và «lệch trạng thái» (038) ⇒ vẫn cần NGỮ CẢNH thao tác.
 */
import { SOCIAL_ERROR_CODES, isSocialErrorCode, type SocialErrorCode } from "@mediaos/contracts";
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

/** LEGACY-PREFIX — tiền tố có số của `message` (API cũ). */
const SOCIAL_CODE_RE = /^SOCIAL-ERR-(\d{3}):/;
/** Mã của interceptor idempotency CÓ đặt `code` vào payload (`contracts/idempotency.ts`). */
const IDEMPOTENCY_CODE_PREFIX = "REQUEST-ERR-IDEMPOTENCY";
const C = SOCIAL_ERROR_CODES;

/**
 * Mã SOCIAL của một `ApiError`: `code` khi đó là mã SOCIAL (API mới); NGƯỢC LẠI đọc tiền tố có số của
 * `message` (LEGACY-PREFIX, API cũ); `null` với mọi thứ khác (ZodError, Error, lỗi không phải SOCIAL).
 */
export function socialErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (isSocialErrorCode(err.code)) return err.code;
  const m = SOCIAL_CODE_RE.exec(err.message);
  return m ? `SOCIAL-ERR-${m[1]}` : null;
}

export function groupErrorReason(action: GroupAction, err: unknown): GroupErrorReason | null {
  if (!(err instanceof ApiError)) return null;
  if (isSocialErrorCode(err.code)) return reasonByCode(action, err.code);
  return legacyPrefixReason(action, err);
}

/** API MỚI — chỉ mã, không heuristic status. Mã SOCIAL không thuộc nhóm ⇒ `null` (banner chung). */
function reasonByCode(action: GroupAction, code: SocialErrorCode): GroupErrorReason | null {
  if (code === C.GROUP_LAST_OWNER) return "lastOwner";
  if (code === C.GROUP_NOT_FOUND) return "groupGone";
  // `GROUP_MEMBERSHIP_EXISTS` và `GROUP_MEMBER_STATE_MISMATCH` CHUNG mã 013 — ngữ cảnh thao tác phân xử.
  if (code === C.GROUP_MEMBERSHIP_EXISTS) return action === "join" ? "alreadyMember" : "stateChanged";
  if (code === C.GROUP_NAME_TAKEN) return "nameTaken";
  if (code === C.GROUP_MEMBER_NOT_FOUND) return "stateChanged";
  return null;
}

/**
 * LEGACY-PREFIX (API cũ, owner ký O4) — y nguyên hành vi trước GROUPERR-1. Hai lỗi KHÔNG số
 * (`GROUP_NAME_TAKEN` · `GROUP_MEMBER_NOT_FOUND`) nhận theo NGỮ CẢNH route + status: API cũ không mang
 * gì khác để phân biệt chúng.
 */
function legacyPrefixReason(action: GroupAction, err: ApiError): GroupErrorReason | null {
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
