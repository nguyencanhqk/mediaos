/** outbox `event_type` nội bộ — registrar (`notifications/room-noti-bridge.registrar.ts`) map → `eventCode` catalog 0555. */
export const ROOM_EVENT_CONFIRMED = "room.booking.confirmed";
export const ROOM_EVENT_CANCELLED = "room.booking.cancelled";

/**
 * S11-ROOM-BE-1 — payload outbox cho ROOM_BOOKING_CONFIRMED / ROOM_BOOKING_CANCELLED (SPEC-14 §17).
 *
 *   • `bookingId`   — neo (`sourceEntityId` + `dedupeKeyOf`), không phải biến template.
 *   • `actorUserId` — để engine loại actor (`is_system_event=false`) — KHÔNG phải biến template.
 *   • Biến template 0555 (E): CONFIRMED `organizer_name · room_name · title · time_range · booking_id`;
 *     CANCELLED `actor_name · room_name · title · time_range · booking_id`. `time_range` đã format theo tz công ty.
 * KHÔNG danh sách người tham dự, KHÔNG email (SPEC-14 §17/§18).
 */
export interface RoomBookingNotiPayload {
  bookingId: string;
  actorUserId: string;
  room_name: string;
  title: string;
  time_range: string;
  booking_id: string;
  organizer_name?: string;
  actor_name?: string;
  [key: string]: unknown;
}

export interface RoomBookingNotiInput {
  bookingId: string;
  actorUserId: string;
  roomName: string;
  title: string;
  timeRange: string;
}

/** `users.full_name` nullable — nhãn vai trò trung tính, KHÔNG quy cho "Hệ thống" (bài học ASSET gate MEDIUM). */
const ORGANIZER_FALLBACK = "Người tổ chức";
const ACTOR_FALLBACK = "Người huỷ lịch";

export function roomBookingConfirmedPayload(
  input: RoomBookingNotiInput,
  organizerName: string | null,
): RoomBookingNotiPayload {
  return {
    bookingId: input.bookingId,
    actorUserId: input.actorUserId,
    organizer_name: organizerName ?? ORGANIZER_FALLBACK,
    room_name: input.roomName,
    title: input.title,
    time_range: input.timeRange,
    booking_id: input.bookingId,
  };
}

export function roomBookingCancelledPayload(
  input: RoomBookingNotiInput,
  actorName: string | null,
): RoomBookingNotiPayload {
  return {
    bookingId: input.bookingId,
    actorUserId: input.actorUserId,
    actor_name: actorName ?? ACTOR_FALLBACK,
    room_name: input.roomName,
    title: input.title,
    time_range: input.timeRange,
    booking_id: input.bookingId,
  };
}
