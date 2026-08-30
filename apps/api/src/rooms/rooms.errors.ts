import {
  ConflictException,
  ForbiddenException,
  type HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { ErrorDetail, RoomBookingConflictDto } from "@mediaos/contracts";

/**
 * S11-ROOM-BE-1 — mã lỗi ROOM (SPEC-14 §12 · API-15 §7.4 · quy ước SPEC-01 §9 `MODULE-ERR-XXX`).
 *
 * MỘT CHỖ định nghĩa mã + thông điệp ⇒ int-spec assert theo `error.code`, không theo câu chữ.
 *
 * Hình dạng ném: `new XxxException({ code, message, details })` — `AllExceptionsFilter` đọc `payload.code` và CHỈ cho
 * `details` đi ra khi là mảng `ErrorDetail {field,message,rule}`. Vì thế `details.kind`/`conflicts`/`nextFreeFrom`/
 * `capacity`/`headcount`/`upcomingCount` của SPEC-14 §12 biểu diễn thành phần tử `{field, message, rule:"room"}`
 * (`conflicts` = JSON string) — test neo `details.find(d => d.field === "kind").message`
 * (memory `error-details-must-be-errordetail-array`; đính chính API-15 §7.4 + SPEC-14 §12 cùng PR).
 *
 * Sentinel 404 trên dây = `ROOM-ERR-NOT-FOUND` (ROOM-ERR-003 là MÃ QUY TẮC để tra cứu — API-15 §7.4).
 * Ngoài scope GHI ⇒ 403 `AUTH-ERR-SCOPE-DENIED` (lịch công khai trong company — SPEC-14 §11/§18), KHÔNG 404.
 */
export const ROOM_ERR_CODE = {
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
} as const;

export type RoomErrCode = (typeof ROOM_ERR_CODE)[keyof typeof ROOM_ERR_CODE];

export const AUTH_ERR_SCOPE_DENIED = "AUTH-ERR-SCOPE-DENIED";

export const ROOM_ERR = {
  OVERLAP: (roomName: string) =>
    `ROOM-ERR-001: phòng "${roomName}" đã có lịch trong khung giờ này.`,
  WINDOW: {
    "end-before-start": "ROOM-ERR-002: giờ kết thúc phải sau giờ bắt đầu.",
    "in-past": "ROOM-ERR-002: không thể đặt lịch trong quá khứ.",
    "too-short": "ROOM-ERR-002: lượt đặt tối thiểu 15 phút.",
    "too-long": "ROOM-ERR-002: lượt đặt tối đa 8 giờ.",
    "too-far": "ROOM-ERR-002: chỉ đặt trước tối đa 90 ngày.",
    "range-too-wide":
      "ROOM-ERR-002: cửa sổ tra cứu không hợp lệ (to phải sau from và không quá giới hạn ngày).",
  } as const,
  ROOM_INACTIVE: "ROOM-ERR-004: phòng đang vô hiệu — không nhận đặt.",
  APPROVAL_NOT_SUPPORTED:
    "ROOM-ERR-004: phòng này yêu cầu duyệt — v1 chưa hỗ trợ luồng duyệt, không nhận đặt.",
  ALREADY_CANCELLED: "ROOM-ERR-005: lượt đặt đã bị huỷ trước đó.",
  ALREADY_ENDED: "ROOM-ERR-005: lượt đặt đã kết thúc — không thể huỷ.",
  ATTENDEE: {
    "attendee-not-found": "ROOM-ERR-006: người tham dự không tồn tại trong công ty.",
    "attendee-inactive": "ROOM-ERR-006: người tham dự không còn hoạt động.",
    "attendee-duplicate":
      "ROOM-ERR-006: danh sách người tham dự có người trùng (hoặc trùng người tổ chức).",
    "too-many-attendees": "ROOM-ERR-006: tối đa 50 người tham dự.",
  } as const,
  CAPACITY: (capacity: number, headcount: number) =>
    `ROOM-ERR-007: vượt sức chứa — phòng chứa ${capacity} người, lượt có ${headcount} người.`,
  ROOM_HAS_UPCOMING: (n: number) =>
    `ROOM-ERR-008: phòng còn ${n} lượt đặt sắp tới — huỷ các lượt trước khi vô hiệu/xoá phòng.`,
  NAME_TAKEN: (name: string) => `ROOM-ERR-009: đã có phòng tên "${name}" trong công ty.`,
  BOOK_ON_BEHALF_DENIED:
    "ROOM-ERR-010: bạn chỉ được đặt phòng cho chính mình (không có quyền đặt hộ).",
  ORGANIZER_NOT_FOUND: "ROOM-ERR-010: người tổ chức không tồn tại trong công ty.",
  ORGANIZER_INACTIVE: "ROOM-ERR-010: người tổ chức không còn hoạt động.",
  NOT_FOUND_ROOM: "ROOM-ERR-NOT-FOUND: không tìm thấy phòng họp.",
  NOT_FOUND_BOOKING: "ROOM-ERR-NOT-FOUND: không tìm thấy lượt đặt phòng.",
  SCOPE_DENIED_CANCEL: "AUTH-ERR-SCOPE-DENIED: bạn chỉ được huỷ lượt do chính mình tổ chức.",
} as const;

export type RoomWindowKind = keyof typeof ROOM_ERR.WINDOW;
export type RoomAttendeeKind = keyof typeof ROOM_ERR.ATTENDEE;

/** `details` theo hợp đồng `ErrorDetail[]` — `kind` + các cặp phụ (`capacity` · `headcount` · `upcomingCount`…). */
export function roomDetails(
  kind: string,
  extra: Record<string, string | number | boolean | null | undefined> = {},
): ErrorDetail[] {
  const out: ErrorDetail[] = [{ field: "kind", message: kind, rule: "room" }];
  for (const [field, value] of Object.entries(extra)) {
    if (value === null || value === undefined) continue;
    out.push({ field, message: String(value), rule: "room" });
  }
  return out;
}

/** Payload chuẩn cho HttpException của ROOM (filter đọc `code` + `details`). */
export function roomErrorBody(
  code: string,
  message: string,
  details?: ErrorDetail[],
): { code: string; message: string; details?: ErrorDetail[] } {
  return details ? { code, message, details } : { code, message };
}

export const notFoundRoom = (): NotFoundException =>
  new NotFoundException(roomErrorBody(ROOM_ERR_CODE.NOT_FOUND, ROOM_ERR.NOT_FOUND_ROOM));
export const notFoundBooking = (): NotFoundException =>
  new NotFoundException(roomErrorBody(ROOM_ERR_CODE.NOT_FOUND, ROOM_ERR.NOT_FOUND_BOOKING));

export const conflict = (code: RoomErrCode, message: string, details?: ErrorDetail[]) =>
  new ConflictException(roomErrorBody(code, message, details));

export const unprocessable = (code: RoomErrCode, message: string, details?: ErrorDetail[]) =>
  new UnprocessableEntityException(roomErrorBody(code, message, details));

export const windowError = (kind: RoomWindowKind): UnprocessableEntityException =>
  unprocessable(ROOM_ERR_CODE.WINDOW, ROOM_ERR.WINDOW[kind], roomDetails(kind));

export const attendeeError = (
  kind: RoomAttendeeKind,
  userId?: string,
): UnprocessableEntityException =>
  unprocessable(ROOM_ERR_CODE.ATTENDEE, ROOM_ERR.ATTENDEE[kind], roomDetails(kind, { userId }));

/** ROOM-ERR-010 vế 403 — scope `book` = Own mà `organizerUserId ≠` caller. */
export const bookOnBehalfDenied = (): ForbiddenException =>
  new ForbiddenException(
    roomErrorBody(
      ROOM_ERR_CODE.ORGANIZER,
      ROOM_ERR.BOOK_ON_BEHALF_DENIED,
      roomDetails("book-on-behalf-denied"),
    ),
  );

/** `cancel@Own` trên lượt người khác — 403 `AUTH-ERR-SCOPE-DENIED` (SPEC-14 §13.3). Mã đặt trong payload để lên dây. */
export const cancelScopeDenied = (): ForbiddenException =>
  new ForbiddenException(roomErrorBody(AUTH_ERR_SCOPE_DENIED, ROOM_ERR.SCOPE_DENIED_CANCEL));

/** ROOM-ERR-001 — `conflicts` (JSON) + `nextFreeFrom` (ISO hoặc "null") theo hình `ErrorDetail[]`. */
export function overlapError(
  roomName: string,
  conflicts: RoomBookingConflictDto[],
  nextFreeFrom: Date | null,
): ConflictException {
  const details: ErrorDetail[] = [
    { field: "kind", message: "overlap", rule: "room" },
    { field: "conflicts", message: JSON.stringify(conflicts), rule: "room" },
    {
      field: "nextFreeFrom",
      message: nextFreeFrom ? nextFreeFrom.toISOString() : "null",
      rule: "room",
    },
  ];
  return conflict(ROOM_ERR_CODE.OVERLAP, ROOM_ERR.OVERLAP(roomName), details);
}

// ── Lỗi Postgres → ROOM-ERR ──────────────────────────────────────────────────────────────────────

export const OVERLAP_EXCLUSION_CONSTRAINT = "room_bookings_no_overlap_excl";
export const ROOM_NAME_UNIQUE_CONSTRAINT = "uq_meeting_rooms_company_name_active";
export const ATTENDEE_UNIQUE_CONSTRAINT = "uq_room_booking_attendees_booking_user";

/**
 * Bóc lỗi Postgres THẬT ra khỏi vỏ `DrizzleQueryError` (khuôn `assets.errors.ts#pgErrorOf`): `err.code` lớp ngoài
 * `undefined`, mã `23P01`/`23505` nằm ở `err.cause`. Cận trên 5 tầng `cause` (chuỗi tự tham chiếu sẽ treo).
 */
export function pgErrorOf(err: unknown): { code?: unknown; constraint?: unknown } | null {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur; depth += 1) {
    const e = cur as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof e.code === "string") return e;
    cur = e.cause;
  }
  return null;
}

/**
 * `true` khi lỗi là vi phạm EXCLUDE `room_bookings_no_overlap_excl` (23P01) — CHỐT CUỐI chống trùng lịch (SPEC-14
 * §3.1). Caller (service) KHÔNG map thẳng thành 409 ở đây vì cần truy vấn lại `conflicts` + `nextFreeFrom` trong
 * một tx MỚI (tx hiện tại đã abort — 25P02) rồi mới ném `overlapError`.
 */
export function isOverlapExclusion(err: unknown): boolean {
  const e = pgErrorOf(err);
  return !!e && e.code === "23P01" && e.constraint === OVERLAP_EXCLUSION_CONSTRAINT;
}

/**
 * Map lỗi DB theo **TÊN CONSTRAINT** (không nuốt mọi `23505` thành một mã): `uq_meeting_rooms_company_name_active`
 * ⇒ 409 ROOM-ERR-009 `name-taken` · `uq_room_booking_attendees_booking_user` ⇒ 422 ROOM-ERR-006 `attendee-duplicate`.
 * Trả `null` khi KHÔNG phải lỗi ROOM đã biết ⇒ caller `throw err` nguyên bản (filter ⇒ 500 có log).
 * 23P01 KHÔNG map ở đây (xem `isOverlapExclusion`).
 */
export function mapRoomPgError(err: unknown, ctx: { name?: string } = {}): HttpException | null {
  const e = pgErrorOf(err);
  if (!e || typeof e.code !== "string") return null;
  const constraint = typeof e.constraint === "string" ? e.constraint : "";
  if (e.code === "23505") {
    switch (constraint) {
      case ROOM_NAME_UNIQUE_CONSTRAINT:
        return conflict(
          ROOM_ERR_CODE.NAME_TAKEN,
          ROOM_ERR.NAME_TAKEN(ctx.name ?? "?"),
          roomDetails("name-taken"),
        );
      case ATTENDEE_UNIQUE_CONSTRAINT:
        return attendeeError("attendee-duplicate");
      default:
        return null;
    }
  }
  return null;
}
