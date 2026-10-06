/**
 * S16-SOCIAL-FE-3B (L4) — lỗi của màn Thiết lập huy hiệu (`SOC-SCREEN-012`): bảng `mã → reason` RIÊNG cho
 * từng lời gọi + «việc phải làm sau lỗi» mã hoá thành DỮ LIỆU (khuôn `moderation/lib/moderation-errors.ts`).
 *
 * Hộp thoại / trang chỉ gọi `describe…Error(err)` rồi làm theo các cờ trả về — không tự suy từ status / mã.
 *
 * Bốn lời gọi, bốn hàm:
 *   · `describeCreateBadgeError` — 049 `POST /social/kudos-badges` (hộp thoại, chế độ tạo)
 *   · `describeUpdateBadgeError` — 050 `PATCH /social/kudos-badges/:id` (hộp thoại, chế độ sửa)
 *   · `describeToggleBadgeError` — 051 `DELETE …/:id` («Ngừng dùng») và 050 `{ isActive: true }` («Bật lại»)
 *   · `describeBadgeReadError`   — đọc 056 (bảng)
 *
 * ┌─ LƯỢT GHI: «SERVER ĐÃ TỪ CHỐI» ≠ «CHƯA XÁC NHẬN ĐƯỢC KẾT QUẢ» ─────────────────────────────────────┐
 * │ 4xx ⇒ kết cục xác định: chưa ghi. Mọi thứ còn lại (5xx — kể cả 502/503/504 của reverse proxy — · mất │
 * │ phản hồi · hết hạn chờ · 2xx mà thân hỏng schema) ⇒ `outcomeUnknown`: server có thể ĐÃ ghi ⇒ không   │
 * │ được nói «Không thực hiện được», và trang phải đọc lại danh sách NGAY (người dùng có thể bấm «Huỷ»   │
 * │ chứ không «Thử lại»; app tắt `refetchOnWindowFocus`). Gửi lại vẫn an toàn: 049 mang cùng khoá         │
 * │ idempotency trong một lượt mở (plan D20); 050 / 051 lặp lại cùng giá trị không đổi gì thêm.           │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Mọi `reason` thuộc tập đóng `ADMIN_ERROR_REASONS` ⇒ có câu ở `social:admin.error.<reason>`; đưa thẳng vào
 * `<AdminErrorNotice reason>`. `message` của server không đi qua bất kỳ trường nào ở đây.
 */
import { IDEMPOTENCY_ERROR_CODES, SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import {
  behaviorOf,
  readErrorReason,
  writeErrorReason,
  type AdminBehaviorTable,
  type AdminErrorReason,
  type AdminErrorTable,
} from "../../admin/lib/admin-errors";

const C = SOCIAL_ERROR_CODES;

// ─────────────────────────────── Bảng mã → reason theo lời gọi ───────────────────────────────

/** 049. Hai mã 409 mang nghĩa NGƯỢC nhau: `CODE-TAKEN` là kết cục (đổi mã), idempotency là tạm thời. */
export const CREATE_BADGE_ERROR_TABLE = {
  [C.KUDOS_BADGE_CODE_TAKEN]: "badgeCodeTaken",
  [IDEMPOTENCY_ERROR_CODES.IN_PROGRESS]: "busy",
} as const satisfies AdminErrorTable;

/** 050 từ hộp thoại. Body không mang `code` ⇒ KHÔNG khai `CODE-TAKEN`; route không `@Idempotent()`. */
export const UPDATE_BADGE_ERROR_TABLE = {
  [C.KUDOS_BADGE_NOT_FOUND]: "badgeGone",
} as const satisfies AdminErrorTable;

/** 051 «Ngừng dùng» + 050 `{ isActive: true }` «Bật lại» — cùng một mã cho «huy hiệu không còn». */
export const TOGGLE_BADGE_ERROR_TABLE = {
  [C.KUDOS_BADGE_NOT_FOUND]: "badgeGone",
} as const satisfies AdminErrorTable;

/** Đọc 056: KHÔNG khai mã nào — chỉ phân xử theo status. Bảng rỗng là CÓ CHỦ Ý, đừng «bổ sung cho đủ». */
export const BADGE_READ_ERROR_TABLE = {} as const satisfies AdminErrorTable;

// ─────────────────────────────── «Hành vi» theo reason ───────────────────────────────

/**
 * Việc hộp thoại 049 / 050 phải làm sau một lỗi.
 *  · `dialog: "close"` ⇒ ĐÓNG hộp thoại, dải lỗi vẽ ở TRANG (lỗi kết cục). `"keep"` ⇒ GIỮ hộp thoại + nháp.
 *  · `field` ⇒ lỗi thuộc về MỘT ô: dải vẽ cạnh ô đó và ô mang `aria-invalid` + `aria-describedby`.
 *  · `invalidate` ⇒ thứ đang thấy đã (hoặc có thể đã) cũ: trang invalidate `kudos.badgesAdminAll()` +
 *    `kudos.badges()`. Với lỗi `"close"` trang làm khi nhận kết cục; với `"keep"` hộp thoại báo qua `onStale`.
 *  · `retryable` ⇒ gửi lại NGUYÊN yêu cầu đó có thể thành công: vẽ «Thử lại».
 */
export interface BadgeFormErrorBehavior {
  dialog: "close" | "keep";
  field: "code" | null;
  invalidate: boolean;
  retryable: boolean;
}
export interface BadgeFormErrorOutcome extends BadgeFormErrorBehavior {
  reason: AdminErrorReason;
}

/** Việc trang phải làm sau khi «Ngừng dùng» / «Bật lại» hỏng. */
export interface BadgeToggleErrorBehavior {
  invalidate: boolean;
  retryable: boolean;
}
export interface BadgeToggleErrorOutcome extends BadgeToggleErrorBehavior {
  reason: AdminErrorReason;
}

/** Đường đọc chỉ có một câu hỏi: có vẽ nút «Thử lại» không. */
export interface BadgeReadErrorBehavior {
  retryable: boolean;
}
export interface BadgeReadErrorOutcome extends BadgeReadErrorBehavior {
  reason: AdminErrorReason;
}

const KEEP: BadgeFormErrorBehavior = {
  dialog: "keep",
  field: null,
  invalidate: false,
  retryable: false,
};
const CLOSE: BadgeFormErrorBehavior = { ...KEEP, dialog: "close" };

/** Dùng chung cho 049 và 050: reason nào không thể xảy ra ở một lời gọi thì bảng mã của nó không sinh ra. */
export const BADGE_FORM_ERROR_BEHAVIOR: AdminBehaviorTable<BadgeFormErrorBehavior> = {
  // 049 — mã đã có (kể cả ở một huy hiệu đang ngừng dùng): người dùng phải đổi mã ⇒ không «Thử lại». Câu
  // lỗi gợi ý bật lại huy hiệu cũ ⇒ đọc lại danh sách để huy hiệu đó (nếu vừa được tạo ở nơi khác) hiện ra.
  badgeCodeTaken: { ...KEEP, field: "code", invalidate: true },
  // 049 — lượt gửi trước cùng khoá còn đang chạy: xong thì cùng khoá nhận lại phản hồi của nó.
  busy: { ...KEEP, retryable: true },
  // 050 — huy hiệu không còn: kết cục, hàng đang thấy đã cũ.
  badgeGone: { ...CLOSE, invalidate: true },
  // 403 tầng 1/2: mất quyền giữa chừng, thử lại vô ích.
  forbidden: CLOSE,
  invalidRequest: KEEP,
  // 4xx mã lạ — server ĐÃ từ chối: chưa ghi, gửi lại được.
  generic: { ...KEEP, retryable: true },
  // Không có câu trả lời đọc được — xem khung ở đầu file.
  outcomeUnknown: { ...KEEP, invalidate: true, retryable: true },
};

export const BADGE_TOGGLE_ERROR_BEHAVIOR: AdminBehaviorTable<BadgeToggleErrorBehavior> = {
  badgeGone: { invalidate: true, retryable: false },
  forbidden: { invalidate: false, retryable: false },
  invalidRequest: { invalidate: false, retryable: false },
  generic: { invalidate: false, retryable: true },
  outcomeUnknown: { invalidate: true, retryable: true },
};

export const BADGE_READ_ERROR_BEHAVIOR: AdminBehaviorTable<BadgeReadErrorBehavior> = {
  forbidden: { retryable: false },
  invalidRequest: { retryable: false },
  loadFailed: { retryable: true },
  generic: { retryable: true },
};

export function describeCreateBadgeError(err: unknown): BadgeFormErrorOutcome {
  const reason = writeErrorReason(err, CREATE_BADGE_ERROR_TABLE);
  return { reason, ...behaviorOf(BADGE_FORM_ERROR_BEHAVIOR, reason) };
}

export function describeUpdateBadgeError(err: unknown): BadgeFormErrorOutcome {
  const reason = writeErrorReason(err, UPDATE_BADGE_ERROR_TABLE);
  return { reason, ...behaviorOf(BADGE_FORM_ERROR_BEHAVIOR, reason) };
}

export function describeToggleBadgeError(err: unknown): BadgeToggleErrorOutcome {
  const reason = writeErrorReason(err, TOGGLE_BADGE_ERROR_TABLE);
  return { reason, ...behaviorOf(BADGE_TOGGLE_ERROR_BEHAVIOR, reason) };
}

export function describeBadgeReadError(err: unknown): BadgeReadErrorOutcome {
  const reason = readErrorReason(err, BADGE_READ_ERROR_TABLE);
  return { reason, ...behaviorOf(BADGE_READ_ERROR_BEHAVIOR, reason) };
}
