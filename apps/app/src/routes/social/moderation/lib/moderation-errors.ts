/**
 * S16-SOCIAL-FE-3 (L2) — lỗi của màn Kiểm duyệt (`SOC-SCREEN-010`): bảng `mã → reason` RIÊNG cho từng
 * lời gọi + cột «Hành vi» của bảng lỗi plan §3 L2 (E1–E11) mã hoá thành DỮ LIỆU.
 *
 * Hộp thoại / trang chỉ gọi `describe…Error(err)` rồi làm theo các cờ trả về — không tự suy «lỗi này nên
 * đóng hay giữ hộp thoại» từ status/mã. Lý do: cùng 409 có hai nghĩa ngược nhau (`021` = kết cục cuối,
 * đóng; `REPORT-BUSY` = tạm thời, giữ + bấm lại), cùng 403 có hai nghĩa (`REPORT-ACTION-DENIED` = bỏ
 * hành động kèm là gửi được; 403 khác = mất quyền, đóng). Suy tại chỗ gọi là gộp nhầm.
 *
 * Hai lượt GHI (029 · 006) không idempotent ⇒ lỗi KHÔNG phải một lời từ chối 4xx của server (5xx — kể cả
 * 502/503/504 của reverse proxy — · mất phản hồi · hết hạn chờ · thân 2xx hỏng schema) là `outcomeUnknown`
 * (có thể đã ghi), không phải `generic`; lượt ĐỌC hỏng là `loadFailed`.
 *
 * Ba lời gọi, ba hàm:
 *   · `describeResolveReportError`  — 029 `PATCH /social/reports/:id` (hộp thoại xử lý báo cáo)
 *   · `describeUnhidePostError`     — 006 `PATCH /social/posts/:id/moderation` với `{ hidden: false }`
 *   · `describeModerationReadError` — đọc 028 (hàng đợi) và 001 `status=hidden` (bài đang ẩn)
 *
 * Mọi `reason` thuộc tập đóng `ADMIN_ERROR_REASONS` ⇒ có câu ở `social:admin.error.<reason>`; đưa thẳng
 * vào `<AdminErrorNotice reason>`. `message` của server không đi qua bất kỳ trường nào ở đây.
 */
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
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

/** 029. `REPORT_NOT_FOUND` = `SOCIAL-ERR-001`: ở lời gọi NÀY nghĩa là «báo cáo không còn» (E6). */
export const RESOLVE_REPORT_ERROR_TABLE = {
  [C.REPORT_ALREADY_DECIDED]: "reportAlreadyDecided",
  [C.REPORT_BUSY]: "reportBusy",
  [C.REPORT_ACTION_DENIED]: "reportActionDenied",
  [C.REPORT_ACTION_INVALID_FOR_TARGET]: "reportActionInvalid",
  [C.REPORT_ACTION_TARGET_UNAVAILABLE]: "reportTargetUnavailable",
  [C.REPORT_NOT_FOUND]: "reportGone",
} as const satisfies AdminErrorTable;

/** 006. CÙNG mã `SOCIAL-ERR-001` nhưng ở lời gọi này nghĩa là «bài không còn» (E7). */
export const UNHIDE_POST_ERROR_TABLE = {
  [C.POST_NOT_FOUND]: "postGone",
} as const satisfies AdminErrorTable;

/**
 * Đọc 028/001: KHÔNG khai mã nào — chỉ phân xử theo status. 403 với MỌI mã (kể cả `SOCIAL-ERR-010` của
 * 001 `status=hidden` thiếu `manage:feed-post`) ⇒ `forbidden` (E8); 400 ⇒ `invalidRequest`; còn lại ⇒
 * `loadFailed` (câu RIÊNG của lượt đọc — xem `describeModerationReadError`). Bảng rỗng là CÓ CHỦ Ý, đừng
 * «bổ sung cho đủ».
 */
export const MODERATION_READ_ERROR_TABLE = {} as const satisfies AdminErrorTable;

// ─────────────────────────────── «Hành vi» theo reason ───────────────────────────────

/**
 * Việc hộp thoại 029 phải làm sau một lỗi.
 *  · `dialog: "close"` ⇒ ĐÓNG hộp thoại và vẽ dải lỗi ở TRANG (lỗi kết cục — hàng có thể biến mất sau
 *    refetch, dải nằm trong hộp thoại/hàng sẽ mất theo — plan B6). `"keep"` ⇒ GIỮ hộp thoại + nội dung
 *    đã nhập, dải lỗi nằm TRONG hộp thoại.
 *  · `resetAction` ⇒ đưa ô «Hành động kèm» về «không» (hành động đã chọn không thực hiện được; kết thúc
 *    báo cáo không kèm hành động thì được).
 *  · `invalidate` ⇒ invalidate `socialKeys.moderation.reports.lists()` (thứ đang thấy đã cũ). Với lỗi
 *    `"close"` trang làm việc này khi nhận kết cục; với lỗi `"keep"` hộp thoại báo trang qua `onStale`.
 *  · `invalidatePosts` ⇒ THÊM mọi bề mặt đang vẽ bài + chi tiết / bình luận của bài bị báo cáo: báo cáo
 *    đã — hoặc CÓ THỂ đã — được kết thúc kèm ẩn / xoá bài (ở nơi khác, hoặc bởi chính lượt gửi mất phản
 *    hồi). Đi cùng đường với `invalidate`: kết cục (`"close"`) hoặc `onStale` (`"keep"`).
 *  · `retryable` ⇒ gửi lại NGUYÊN yêu cầu đó có thể thành công: vẽ «Thử lại» / mời bấm lại. `false` ⇒
 *    KHÔNG truyền `onRetry` cho `AdminErrorNotice` (câu chữ của reason đó cũng không hứa thử lại).
 */
export interface ResolveReportErrorBehavior {
  dialog: "close" | "keep";
  resetAction: boolean;
  invalidate: boolean;
  invalidatePosts: boolean;
  retryable: boolean;
}
export interface ResolveReportErrorOutcome extends ResolveReportErrorBehavior {
  reason: AdminErrorReason;
}

/** Việc dòng «Bài đang ẩn» phải làm sau khi 006 hỏng. `invalidate` ⇒ `socialKeys.moderation.hiddenPosts()`. */
export interface UnhidePostErrorBehavior {
  invalidate: boolean;
  retryable: boolean;
}
export interface UnhidePostErrorOutcome extends UnhidePostErrorBehavior {
  reason: AdminErrorReason;
}

/** Đường đọc chỉ có một câu hỏi: có vẽ nút «Thử lại» không. */
export interface ModerationReadErrorBehavior {
  retryable: boolean;
}
export interface ModerationReadErrorOutcome extends ModerationReadErrorBehavior {
  reason: AdminErrorReason;
}

const KEEP: ResolveReportErrorBehavior = {
  dialog: "keep",
  resetAction: false,
  invalidate: false,
  invalidatePosts: false,
  retryable: false,
};
const CLOSE: ResolveReportErrorBehavior = { ...KEEP, dialog: "close" };

/** Cột «Hành vi» của E1–E6 + E9–E11 cho 029. Reason không có hàng ⇒ dùng hàng `generic`. */
export const RESOLVE_REPORT_ERROR_BEHAVIOR: AdminBehaviorTable<ResolveReportErrorBehavior> = {
  // E1 — báo cáo đã được kết thúc trước: kết cục cuối. «Trước» có thể là người khác, hoặc CHÍNH lượt
  // trước của mình đã ghi mà mất phản hồi (hết hạn chờ) rồi bấm «Thử lại». Lượt đó có thể kèm ẩn / xoá
  // bài ⇒ làm mới cả các bề mặt bài, không chỉ hàng đợi.
  reportAlreadyDecided: { ...CLOSE, invalidate: true, invalidatePosts: true },
  // E2 — hàng đang bị giao dịch khác giữ: tạm thời, bấm lại được.
  reportBusy: { ...KEEP, retryable: true },
  // E3 — thiếu quyền cho HÀNH ĐỘNG KÈM (không phải cho việc kết thúc báo cáo).
  reportActionDenied: { ...KEEP, resetAction: true },
  // E4 — hành động không hợp loại đích: người dùng tự chọn lại.
  reportActionInvalid: KEEP,
  // E5 — đích không còn thao tác được: chỉ còn đường kết thúc không kèm hành động. Hàng đang thấy vẫn vẽ
  // đích như còn sống (link «Xem trong ngữ cảnh» dẫn tới 404) ⇒ đọc lại hàng đợi; hộp thoại vẫn giữ.
  reportTargetUnavailable: { ...KEEP, resetAction: true, invalidate: true },
  // E6 — báo cáo không còn (hoặc ra khỏi phạm vi).
  reportGone: { ...CLOSE, invalidate: true },
  // E9 — 403 tầng 1/2: mất quyền giữa chừng, thử lại vô ích.
  forbidden: CLOSE,
  // E10
  invalidRequest: KEEP,
  // 4xx mã lạ — server ĐÃ từ chối: chưa ghi, gửi lại được. (E11 · 5xx KHÔNG rơi vào đây — xem hàng dưới.)
  generic: { ...KEEP, retryable: true },
  // E11 + không có câu trả lời đọc được (5xx — kể cả 502/503/504 của reverse proxy khi API restart / treo
  // — · mất phản hồi · hết hạn chờ · 2xx mà thân hỏng schema): server có thể — ca cuối: chắc chắn — ĐÃ
  // ghi, kể cả ẩn / xoá bài. Đọc lại hàng đợi + bề mặt bài NGAY (người dùng có thể bấm «Huỷ» chứ không
  // «Thử lại», và app tắt `refetchOnWindowFocus`); gửi lại vẫn an toàn: đã ghi rồi thì lượt lặp nhận E1.
  outcomeUnknown: { ...KEEP, invalidate: true, invalidatePosts: true, retryable: true },
};

/** Cột «Hành vi» của E7 + E9–E11 cho 006. */
export const UNHIDE_POST_ERROR_BEHAVIOR: AdminBehaviorTable<UnhidePostErrorBehavior> = {
  postGone: { invalidate: true, retryable: false },
  forbidden: { invalidate: false, retryable: false },
  invalidRequest: { invalidate: false, retryable: false },
  generic: { invalidate: false, retryable: true },
  // Như 029: không rõ server đã hiện lại bài hay chưa ⇒ đọc lại danh sách ngay; lượt lặp `{ hidden: false }`
  // không đổi gì thêm.
  outcomeUnknown: { invalidate: true, retryable: true },
};

/** Cột «Hành vi» của E8 + E10–E11 cho đường đọc. */
export const MODERATION_READ_ERROR_BEHAVIOR: AdminBehaviorTable<ModerationReadErrorBehavior> = {
  forbidden: { retryable: false },
  invalidRequest: { retryable: false },
  loadFailed: { retryable: true },
  generic: { retryable: true },
};

/**
 * Các reason mà CÂU của chúng nói «Danh sách đã được làm mới» (E1 · E6 · E7 + `badgeGone` của màn Thiết
 * lập huy hiệu — tập này phủ CẢ cụm quản trị, vì ca ghim nó quét toàn bộ câu i18n). Khi lượt đọc lại đang LỖI,
 * dải của các reason này không được vẽ — câu đó đứng cạnh «không tải được danh sách» là nói hai điều trái
 * nhau. MỌI dải khác (thành công · `forbidden` · `outcomeUnknown`…) không nói gì về danh sách ⇒ luôn vẽ:
 * giấu chúng đi là để lượt ghi đã xong trông như vừa hỏng. Spec ghim tập này khớp với chữ i18n.
 */
const LIST_REFRESH_CLAIMING_REASONS: ReadonlySet<AdminErrorReason> = new Set<AdminErrorReason>([
  "reportAlreadyDecided",
  "reportGone",
  "postGone",
  "badgeGone",
]);

export function claimsListRefreshed(reason: AdminErrorReason): boolean {
  return LIST_REFRESH_CLAIMING_REASONS.has(reason);
}

export function describeResolveReportError(err: unknown): ResolveReportErrorOutcome {
  const reason = writeErrorReason(err, RESOLVE_REPORT_ERROR_TABLE);
  return { reason, ...behaviorOf(RESOLVE_REPORT_ERROR_BEHAVIOR, reason) };
}

export function describeUnhidePostError(err: unknown): UnhidePostErrorOutcome {
  const reason = writeErrorReason(err, UNHIDE_POST_ERROR_TABLE);
  return { reason, ...behaviorOf(UNHIDE_POST_ERROR_BEHAVIOR, reason) };
}

/**
 * Lượt ĐỌC không bao giờ ra `generic`: «Không thực hiện được…» là câu của một lượt ghi, mà dải lỗi tải có
 * thể đứng ngay cạnh dải kết cục của lượt ghi vừa XONG. Mọi lỗi không phải 403/400 ⇒ `loadFailed`.
 */
export function describeModerationReadError(err: unknown): ModerationReadErrorOutcome {
  const reason = readErrorReason(err, MODERATION_READ_ERROR_TABLE);
  return { reason, ...behaviorOf(MODERATION_READ_ERROR_BEHAVIOR, reason) };
}
