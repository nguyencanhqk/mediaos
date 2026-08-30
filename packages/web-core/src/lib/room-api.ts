import { z } from "zod";
import {
  roomResponseSchema,
  type RoomResponseDto,
  roomAvailabilityItemSchema,
  type RoomAvailabilityItemDto,
  roomUsageSummaryItemSchema,
  type RoomUsageSummaryItemDto,
  roomBookingResponseSchema,
  type RoomBookingResponseDto,
  myRoomBookingResponseSchema,
  type MyRoomBookingResponseDto,
  type ListRoomsQueryDto,
  type CreateRoomDto,
  type UpdateRoomDto,
  type RoomAvailabilityQueryDto,
  type RoomUsageSummaryQueryDto,
  type RoomBookingsWindowQueryDto,
  type ListRoomBookingsQueryDto,
  type CreateRoomBookingDto,
  type CancelRoomBookingDto,
  type MyRoomBookingsQueryDto,
} from "@mediaos/contracts";
import { apiFetch, apiFetchPaginated, type PaginatedResult } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * S11-ROOM-FE-1 — ROOM API client (SPEC-14 §15 / API-15, 13 route). MIRROR BE 3 controller:
 * `RoomsController` (8) · `RoomBookingsController` (4) · `MeRoomBookingsController` (1).
 *
 * ⚠️ **CHỈ `GET /rooms` phân trang.** Đo từ service 30/08/2026: `rooms.list()` trả `PaginatedResult`,
 * 12 route còn lại trả mảng/object TRẦN. Đi `apiFetch` cho route phân trang sẽ **vứt** block `pagination`
 * (memory `apifetch-drops-pagination-bare-array`) ⇒ màn quản trị mất `total` và phải đoán "còn trang sau"
 * bằng `items.length === per_page` — sai đúng ở trang cuối vừa bội số. Ngược lại, đi `apiFetchPaginated`
 * cho route trả mảng trần thì `pagination` là `undefined` và màn lịch dựng phân trang ảo trên dữ liệu
 * không phân trang. Hai đường KHÔNG hoán đổi được.
 *
 * Cửa sổ `[from, to)` là **ISO 8601 CÓ offset** (`roomIsoDateTimeSchema`) — thiếu offset ⇒ 400 ở Zod
 * server. Client luôn gửi `.toISOString()` (kết `Z`), quy đổi hiển thị sang múi công ty là việc của
 * `room-time.ts` ở tầng màn hình (UTC-at-rest, ADR-0008).
 *
 * company_id + data-scope là việc của SERVER — client chỉ gửi filter/id. Response validate Zod ở ranh
 * giới; shape sai ⇒ ném ngay (KHÔNG âm thầm render sai).
 *
 * `canCancel` / `isCompleted` trong DTO là **dẫn xuất SERVER** (SPEC-14 §10 ROOM-FUNC-006/010) — FE đọc
 * thẳng, KHÔNG dựng lại công thức từ đồng hồ máy hay từ scope suy đoán.
 */
export const roomApi = {
  // ── Phòng (ROOM-API-001..007) ───────────────────────────────────────────────────────────────────

  /**
   * GET /rooms — danh sách phòng, CÓ phân trang (`view:room`).
   * `includeInactive` chỉ dùng ở màn quản trị 004; màn đặt phòng KHÔNG gửi (phòng vô hiệu không nhận đặt).
   */
  listRooms: (query?: Partial<ListRoomsQueryDto>): Promise<PaginatedResult<RoomResponseDto[]>> =>
    apiFetchPaginated(`/rooms${buildQueryString(query ?? {})}`, z.array(roomResponseSchema)),

  /** GET /rooms/:id — chi tiết + `upcomingCount` (`view:room`). */
  getRoom: (id: string): Promise<RoomResponseDto> => apiFetch(`/rooms/${id}`, roomResponseSchema),

  /** POST /rooms — tạo phòng (`manage:room`). Tên trùng (không phân biệt hoa/thường) ⇒ 409 ROOM-ERR-009. */
  createRoom: (body: CreateRoomDto): Promise<RoomResponseDto> =>
    apiFetch(`/rooms`, roomResponseSchema, { method: "POST", body: JSON.stringify(body) }),

  /**
   * PATCH /rooms/:id — sửa / kích hoạt / vô hiệu (`manage:room`).
   * Body `.strict()` ở BE: gửi thừa khoá ⇒ 400, KHÔNG phải bị bỏ qua im lặng.
   * Vô hiệu khi còn lượt `Confirmed` chưa kết thúc ⇒ 409 ROOM-ERR-008 kèm `upcomingCount`.
   */
  updateRoom: (id: string, body: UpdateRoomDto): Promise<RoomResponseDto> =>
    apiFetch(`/rooms/${id}`, roomResponseSchema, { method: "PATCH", body: JSON.stringify(body) }),

  /** DELETE /rooms/:id — xoá MỀM (`manage:room`), 204. Còn lịch ⇒ 409 ROOM-ERR-008. */
  deleteRoom: (id: string): Promise<void> =>
    apiFetch(`/rooms/${id}`, z.undefined(), { method: "DELETE" }),

  /**
   * GET /rooms/availability — phòng trống trong `[from, to)` (`view:room`).
   * Server ĐÃ lọc `isActive` + KHÔNG `requiresApproval` + sức chứa + không giao lượt `Confirmed`
   * ⇒ FE dùng thẳng làm nguồn dropdown phòng của form đặt (SPEC-14 §9 màn 002).
   */
  availability: (query: RoomAvailabilityQueryDto): Promise<RoomAvailabilityItemDto[]> =>
    apiFetch(`/rooms/availability${buildQueryString(query)}`, z.array(roomAvailabilityItemSchema)),

  /**
   * GET /rooms/usage-summary — thống kê theo phòng trong `[from, to)` (`view:room`).
   * Đếm lượt `Confirmed` có `startsAt` TRONG cửa sổ người xem chọn (KHÔNG phải "chỉ lượt đã qua" —
   * đính chính SPEC-14 §10 ROOM-FUNC-009 ngày 30/08/2026). Gồm cả phòng vô hiệu/xoá mềm nếu có lượt.
   */
  usageSummary: (query: RoomUsageSummaryQueryDto): Promise<RoomUsageSummaryItemDto[]> =>
    apiFetch(`/rooms/usage-summary${buildQueryString(query)}`, z.array(roomUsageSummaryItemSchema)),

  /** GET /rooms/:id/bookings — lịch + lịch sử MỘT phòng trong cửa sổ (`view:room`). */
  listRoomBookings: (
    roomId: string,
    query: RoomBookingsWindowQueryDto,
  ): Promise<RoomBookingResponseDto[]> =>
    apiFetch(
      `/rooms/${roomId}/bookings${buildQueryString(query)}`,
      z.array(roomBookingResponseSchema),
    ),

  // ── Lượt đặt (ROOM-API-009..013) ────────────────────────────────────────────────────────────────

  /**
   * GET /room-bookings — lịch MỌI phòng trong `[from, to)` ≤ 31 ngày (`view:room`).
   * Nguồn của lưới tuần/ngày màn 001. Mặc định chỉ `Confirmed`.
   */
  listBookings: (query: ListRoomBookingsQueryDto): Promise<RoomBookingResponseDto[]> =>
    apiFetch(`/room-bookings${buildQueryString(query)}`, z.array(roomBookingResponseSchema)),

  /** GET /room-bookings/:id — chi tiết lượt + attendees + `canCancel` (`view:room`). */
  getBooking: (id: string): Promise<RoomBookingResponseDto> =>
    apiFetch(`/room-bookings/${id}`, roomBookingResponseSchema),

  /**
   * POST /room-bookings — đặt phòng (`book:room`).
   *
   * `idempotencyKey` do CLIENT sinh **khi mở form** (SPEC-14 §12 / API-15 §6.9) — server KHÔNG suy khoá
   * từ payload: khoá suy-từ-payload sẽ **phát lại** lượt vừa huỷ khi người dùng "huỷ rồi đặt lại y hệt
   * trong 15′" (memory `idempotency-key-must-be-content-derived`). Sinh MỚI ở đúng 3 mốc: mở form · sau
   * gửi thành công · sau lỗi `KEY_REUSED`.
   *
   * Tham số BẮT BUỘC (không `?`) dù interceptor cho phép vắng: quên gửi thì bấm-đúp tạo hai lượt mà
   * không có gì đỏ. Chống trùng **nghiệp vụ** vẫn là việc của EXCLUDE ở DB (409 ROOM-ERR-001), không
   * phải của idempotency.
   */
  createBooking: (
    body: CreateRoomBookingDto,
    idempotencyKey: string,
  ): Promise<RoomBookingResponseDto> =>
    apiFetch(
      `/room-bookings`,
      roomBookingResponseSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey },
    ),

  /**
   * POST /room-bookings/:id/cancel — huỷ (`cancel:room-booking`).
   * Scope Own ⇒ chỉ lượt mình tổ chức (403 `AUTH-ERR-SCOPE-DENIED`); đã huỷ / đã kết thúc ⇒ 409
   * ROOM-ERR-005. Lượt ĐANG diễn ra huỷ ĐƯỢC (trả phòng sớm).
   */
  cancelBooking: (id: string, body: CancelRoomBookingDto): Promise<RoomBookingResponseDto> =>
    apiFetch(`/room-bookings/${id}/cancel`, roomBookingResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * GET /me/room-bookings — lượt của chính mình (`view:room` @Own).
   * KHÔNG nhận tham số người dùng (resolve từ token — chống IDOR). Chọn ĐÚNG MỘT: `date` (YYYY-MM-DD
   * theo múi công ty) HOẶC `from`+`to`; gửi cả hai / thiếu cả hai ⇒ 400 ở Zod.
   */
  listMyBookings: (query: MyRoomBookingsQueryDto): Promise<MyRoomBookingResponseDto[]> =>
    apiFetch(`/me/room-bookings${buildQueryString(query)}`, z.array(myRoomBookingResponseSchema)),
};
