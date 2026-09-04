/**
 * S11-ROOM-FE-1 — bóc mã lỗi nghiệp vụ ROOM từ `ApiError` (SPEC-14 §12 · API-15 §7.4).
 *
 * `error.details` là **MẢNG** `ErrorDetail {field, message, rule?}` — hình DUY NHẤT mà
 * `AllExceptionsFilter` cho đi ra. Đọc `details.kind` như một OBJECT trả `undefined` và nuốt lỗi trong
 * im lặng (memory `error-details-must-be-errordetail-array`).
 *
 * Rẽ nhánh theo **`error.code`, KHÔNG theo HTTP status** (SPEC-14 §9 màn 002): 409 phủ tới bốn lỗi khác
 * hẳn nhau (trùng lịch · phòng không nhận đặt · huỷ không hợp lệ · tên trùng), còn ROOM-ERR-010 cố ý
 * dùng HAI status (403 khi không có quyền đặt hộ, 422 khi organizer sai) cho cùng một chỗ hỏng.
 *
 * ⚠️ Danh sách `kind` dưới đây đo TỪ CODE BE THẬT (`grep 'roomDetails("' apps/api/src/rooms/` +
 * `ROOM_ERR.WINDOW` / `ROOM_ERR.ATTENDEE`), KHÔNG chép bảng SPEC-14 §12. Hai chỗ bảng spec KHÔNG nêu
 * kind mà code vẫn phát: ROOM-ERR-007 phát `over-capacity` (spec chỉ ghi `details = {capacity,
 * headcount}`) và ROOM-ERR-008 phát `room-has-upcoming` (spec chỉ ghi `{upcomingCount}`). Map theo
 * đúng bảng spec sẽ bỏ sót hai nhánh có thật.
 */
import { ApiError, parseKindError, type KindErrorInfo } from "@mediaos/web-core";
// Mã idempotency lấy TỪ CONTRACTS — mã thật là `REQUEST-ERR-IDEMPOTENCY-*`, không phải tên khoá hằng.
import { IDEMPOTENCY_ERROR_CODES, parseRoomConflictsDetail } from "@mediaos/contracts";
import type { RoomConflictsDetailDto } from "@mediaos/contracts";

/** Mã lỗi nghiệp vụ ROOM trên dây (`error.code`). Sentinel 404 là `ROOM-ERR-NOT-FOUND`, KHÔNG `-003`. */
export const ROOM_ERROR_CODE = {
  OVERLAP: "ROOM-ERR-001",
  WINDOW: "ROOM-ERR-002",
  ROOM_NOT_BOOKABLE: "ROOM-ERR-004",
  CANCEL: "ROOM-ERR-005",
  ATTENDEE: "ROOM-ERR-006",
  CAPACITY: "ROOM-ERR-007",
  ROOM_HAS_UPCOMING: "ROOM-ERR-008",
  NAME_TAKEN: "ROOM-ERR-009",
  ORGANIZER: "ROOM-ERR-010",
  NOT_FOUND: "ROOM-ERR-NOT-FOUND",
  SCOPE_DENIED: "AUTH-ERR-SCOPE-DENIED",
} as const;

/**
 * 21 `kind` mà backend ROOM thực sự phát ra. Union đóng để `Record` bên dưới được TS ép đủ nhánh —
 * thêm kind ở BE mà quên map ở đây KHÔNG đỏ (kind về dưới dạng `string`), nên spec neo bằng một ca
 * "mọi kind đều có khoá i18n riêng".
 */
export const ROOM_ERROR_KINDS = [
  // ROOM-ERR-001
  "overlap",
  // ROOM-ERR-002 (ROOM_ERR.WINDOW)
  "end-before-start",
  "in-past",
  "too-short",
  "too-long",
  "too-far",
  "range-too-wide",
  // ROOM-ERR-004
  "room-inactive",
  "approval-not-supported",
  // ROOM-ERR-005
  "already-cancelled",
  "already-ended",
  // ROOM-ERR-006 (ROOM_ERR.ATTENDEE)
  "attendee-not-found",
  "attendee-inactive",
  "attendee-duplicate",
  "too-many-attendees",
  // ROOM-ERR-007
  "over-capacity",
  // ROOM-ERR-008
  "room-has-upcoming",
  // ROOM-ERR-009
  "name-taken",
  // ROOM-ERR-010
  "book-on-behalf-denied",
  "organizer-not-found",
  "organizer-inactive",
] as const;
export type RoomErrorKind = (typeof ROOM_ERROR_KINDS)[number];

export interface RoomErrorInfo extends KindErrorInfo {
  /** `details` thô — để `readConflicts()` đưa nguyên vào `parseRoomConflictsDetail` của contracts. */
  readonly rawDetails: unknown;
}

/** Bóc thông tin lỗi ROOM từ một `unknown` bắt được ở `onError` của react-query. */
export function parseRoomError(error: unknown): RoomErrorInfo {
  // Khác ba module anh em: ROOM cần `details` THÔ để `readConflicts()` đưa nguyên vào
  // `parseRoomConflictsDetail` của contracts — nên bọc thêm một trường quanh bản chung.
  const base = parseKindError(error);
  return {
    ...base,
    rawDetails: error instanceof ApiError ? (error.details ?? null) : null,
  };
}

/**
 * `details` của ROOM-ERR-001 đã bóc kiểu, hoặc `null` khi lỗi không phải trùng lịch.
 *
 * Đi qua `parseRoomConflictsDetail()` của contracts — KHÔNG tự `JSON.parse`: `conflicts` là chuỗi JSON
 * nhét trong một `ErrorDetail`, và contracts đã khoá cả nhánh hỏng-hình (`malformed: true`). Phân biệt
 * `malformed` với "không trùng" là bắt buộc: coi hỏng-hình là "không trùng" sẽ đóng dialog như thể đặt
 * thành công (silent failure).
 */
export function readRoomConflicts(info: RoomErrorInfo): RoomConflictsDetailDto | null {
  if (info.code !== ROOM_ERROR_CODE.OVERLAP) return null;
  const details = Array.isArray(info.rawDetails)
    ? (info.rawDetails as { field: string; message: string; rule?: string }[])
    : null;
  const parsed = parseRoomConflictsDetail(details);
  // Server nói ROOM-ERR-001 nhưng details không đọc được ⇒ vẫn là TRÙNG LỊCH, chỉ mất phần chi tiết.
  // Trả khung `malformed` để UI hiện cảnh báo trùng chung thay vì im lặng bỏ qua.
  return parsed ?? { kind: "overlap", conflicts: [], nextFreeFrom: null, malformed: true };
}

/** Số nguyên từ `details` (`capacity`/`headcount`/`upcomingCount` về dưới dạng CHUỖI). */
export function readDetailInt(info: RoomErrorInfo, field: string): number | null {
  const raw = info.fields.get(field);
  if (raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** Ánh xạ `kind` → khoá i18n. Tách riêng để spec neo "mọi kind có khoá", không lẫn nhánh `code`. */
const KIND_TO_I18N_KEY: Readonly<Record<RoomErrorKind, string>> = {
  overlap: "errors.overlap",
  "end-before-start": "errors.endBeforeStart",
  "in-past": "errors.inPast",
  "too-short": "errors.tooShort",
  "too-long": "errors.tooLong",
  "too-far": "errors.tooFar",
  "range-too-wide": "errors.rangeTooWide",
  "room-inactive": "errors.roomInactive",
  "approval-not-supported": "errors.approvalNotSupported",
  "already-cancelled": "errors.alreadyCancelled",
  "already-ended": "errors.alreadyEnded",
  "attendee-not-found": "errors.attendeeNotFound",
  "attendee-inactive": "errors.attendeeInactive",
  "attendee-duplicate": "errors.attendeeDuplicate",
  "too-many-attendees": "errors.tooManyAttendees",
  "over-capacity": "errors.overCapacity",
  "room-has-upcoming": "errors.roomHasUpcoming",
  "name-taken": "errors.nameTaken",
  "book-on-behalf-denied": "errors.bookOnBehalfDenied",
  "organizer-not-found": "errors.organizerNotFound",
  "organizer-inactive": "errors.organizerInactive",
};

/** Ánh xạ `error.code` → khoá i18n, cho lỗi KHÔNG kèm `kind`. */
const CODE_TO_I18N_KEY: Readonly<Record<string, string>> = {
  [ROOM_ERROR_CODE.OVERLAP]: "errors.overlap",
  [ROOM_ERROR_CODE.WINDOW]: "errors.windowInvalid",
  [ROOM_ERROR_CODE.ROOM_NOT_BOOKABLE]: "errors.roomNotBookable",
  [ROOM_ERROR_CODE.CANCEL]: "errors.cancelInvalid",
  [ROOM_ERROR_CODE.ATTENDEE]: "errors.attendeeInvalid",
  [ROOM_ERROR_CODE.CAPACITY]: "errors.overCapacity",
  [ROOM_ERROR_CODE.ROOM_HAS_UPCOMING]: "errors.roomHasUpcoming",
  [ROOM_ERROR_CODE.NAME_TAKEN]: "errors.nameTaken",
  [ROOM_ERROR_CODE.ORGANIZER]: "errors.organizerInvalid",
  [ROOM_ERROR_CODE.NOT_FOUND]: "errors.notFound",
  // `viewScopeDenied` (view:room ở scope hẹp hơn Company) và `cancelScopeDenied` (huỷ lượt người khác)
  // dùng CHUNG mã này — thông điệp server đã phân biệt, nên khoá i18n ở đây là câu bao.
  [ROOM_ERROR_CODE.SCOPE_DENIED]: "errors.scopeDenied",
  [IDEMPOTENCY_ERROR_CODES.IN_PROGRESS]: "errors.idempotencyInProgress",
  [IDEMPOTENCY_ERROR_CODES.KEY_REUSED]: "errors.idempotencyKeyReused",
};

/**
 * Ánh xạ lỗi → khoá i18n TƯƠNG ĐỐI trong namespace `rooms` (chưa có tiền tố `rooms:`) — giữ hàm thuần,
 * test được mà không cần i18n instance.
 *
 * Thứ tự tra: `kind` (chính xác nhất) → `code` → `generic`. KHÔNG tra theo HTTP status.
 */
export function roomErrorI18nKey(info: RoomErrorInfo): string {
  if (info.kind && info.kind in KIND_TO_I18N_KEY) {
    return KIND_TO_I18N_KEY[info.kind as RoomErrorKind];
  }
  if (info.code && info.code in CODE_TO_I18N_KEY) {
    return CODE_TO_I18N_KEY[info.code];
  }
  return "errors.generic";
}

// ── Ba nhánh của form đặt phòng (SPEC-14 §9 màn 002) ─────────────────────────────────────────────

/**
 * Việc mà form đặt phòng phải làm sau một lỗi:
 *  - `show-conflicts` — ROOM-ERR-001: hiện khung bận + «Còn trống từ …», GIỮ form.
 *  - `wait`           — `IN_PROGRESS`: request cùng khoá đang bay; báo "đang gửi, chờ", **KHÔNG** sinh
 *                       khoá mới (sinh mới ở đây biến một lần bấm-đúp thành hai lượt đặt thật).
 *  - `retry-new-key`  — `KEY_REUSED`: khoá đã tiêu cho payload KHÁC; sinh khoá mới rồi gửi lại.
 *  - `show-message`   — mọi lỗi còn lại: hiện thông điệp theo `roomErrorI18nKey`, GIỮ form.
 *
 * Cả bốn nhánh đều KHÔNG mất dữ liệu form (SPEC-14 §9).
 */
export type RoomBookingErrorAction = "show-conflicts" | "wait" | "retry-new-key" | "show-message";

export function roomBookingErrorAction(info: RoomErrorInfo): RoomBookingErrorAction {
  if (info.code === ROOM_ERROR_CODE.OVERLAP) return "show-conflicts";
  if (info.code === IDEMPOTENCY_ERROR_CODES.IN_PROGRESS) return "wait";
  if (info.code === IDEMPOTENCY_ERROR_CODES.KEY_REUSED) return "retry-new-key";
  return "show-message";
}
