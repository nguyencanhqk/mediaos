import type {
  MyRoomBookingResponseDto,
  RoomAvailabilityItemDto,
  RoomBookingConflictDto,
  RoomBookingResponseDto,
  RoomPersonDto,
  RoomResponseDto,
  RoomUsageSummaryItemDto,
} from "@mediaos/contracts";
import type { MeetingRoom } from "../db/schema/rooms";
import type { MyRoomBookingRow, OverlapRow, RoomBookingRow } from "./room-bookings.repository";
import { isBookingCompleted } from "./room-time";
import type { RoomUsageRow } from "./rooms.repository";
import type { RoomPeopleMap } from "./rooms.types";

/**
 * S11-ROOM-BE-1 — mapper THUẦN row → DTO (SPEC-14 §13.6 · API-15 §5.1/§7). Không DB, không Nest; `now` truyền vào.
 * `isCompleted`/`canCancel` là DẪN XUẤT ở server (SPEC-01 §17.10 — FE không suy từ đồng hồ máy).
 * DTO người CHỈ `userId · displayName · employeeCode` (SPEC-14 §18 — không email/số điện thoại).
 */

export interface BookingDtoCtx {
  now: Date;
  actorUserId: string;
  /** Scope `('cancel','room-booking')` của actor — `null` = không có cặp ⇒ `canCancel=false`. */
  cancelScope: string | null;
}

const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : typeof d === "string" ? new Date(d).toISOString() : d.toISOString();

export function toRoomDto(row: MeetingRoom, upcomingCount?: number): RoomResponseDto {
  const dto: RoomResponseDto = {
    id: row.id,
    name: row.name,
    location: row.location ?? null,
    capacity: row.capacity,
    equipment: row.equipment ?? [],
    description: row.description ?? null,
    requiresApproval: row.requiresApproval,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  return upcomingCount === undefined ? dto : { ...dto, upcomingCount };
}

export function toAvailabilityItemDto(row: MeetingRoom): RoomAvailabilityItemDto {
  return {
    id: row.id,
    name: row.name,
    location: row.location ?? null,
    capacity: row.capacity,
    equipment: row.equipment ?? [],
  };
}

/** `hoursBooked` có thể về dạng chuỗi (numeric) tuỳ driver — ép `Number()` (plan-review M5). */
export function toUsageSummaryItemDto(row: RoomUsageRow): RoomUsageSummaryItemDto {
  return {
    roomId: row.roomId,
    name: row.name,
    bookingsCount: Number(row.bookingsCount),
    hoursBooked: Number(row.hoursBooked),
    cancelledCount: Number(row.cancelledCount),
  };
}

/** Người theo id: có trong map ⇒ tên/mã theo scope; không có (xoá mềm/khác tenant) ⇒ chỉ `userId`. */
export function toPersonDto(userId: string, people: RoomPeopleMap): RoomPersonDto {
  const p = people.get(userId);
  return { userId, displayName: p?.displayName ?? null, employeeCode: p?.employeeCode ?? null };
}

/** `canCancel` (SPEC-14 §13.3): có cặp ∧ (Company/System ∨ organizer = me) ∧ Confirmed ∧ endsAt > now. */
export function computeCanCancel(
  row: Pick<RoomBookingRow, "status" | "endsAt" | "organizerUserId">,
  ctx: BookingDtoCtx,
): boolean {
  if (ctx.cancelScope === null) return false;
  const inScope =
    ctx.cancelScope === "Company" ||
    ctx.cancelScope === "System" ||
    row.organizerUserId === ctx.actorUserId;
  return (
    inScope && row.status === "Confirmed" && new Date(row.endsAt).getTime() > ctx.now.getTime()
  );
}

export function toBookingDto(
  row: RoomBookingRow,
  attendeeIds: readonly string[],
  people: RoomPeopleMap,
  ctx: BookingDtoCtx,
): RoomBookingResponseDto {
  const endsAt = new Date(row.endsAt);
  return {
    id: row.id,
    room: {
      id: row.roomId,
      name: row.roomName,
      location: row.roomLocation ?? null,
      capacity: Number(row.roomCapacity),
    },
    title: row.title,
    description: row.description ?? null,
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: endsAt.toISOString(),
    organizer: toPersonDto(row.organizerUserId, people),
    bookedBy: row.bookedByUserId ? toPersonDto(row.bookedByUserId, people) : null,
    attendees: attendeeIds.map((id) => toPersonDto(id, people)),
    status: row.status,
    isCompleted: isBookingCompleted(row.status, endsAt, ctx.now),
    canCancel: computeCanCancel(row, ctx),
    cancelledAt: iso(row.cancelledAt),
    cancelledBy: row.cancelledBy ? toPersonDto(row.cancelledBy, people) : null,
    cancelReason: row.cancelReason ?? null,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export function toMyBookingDto(
  row: MyRoomBookingRow,
  attendeeIds: readonly string[],
  people: RoomPeopleMap,
  ctx: BookingDtoCtx,
): MyRoomBookingResponseDto {
  return { ...toBookingDto(row, attendeeIds, people, ctx), myRole: row.myRole };
}

/** `details.conflicts[]` của ROOM-ERR-001 — `organizerName` theo scope danh tính của actor (plan-review B1). */
export function toConflictDto(row: OverlapRow, people: RoomPeopleMap): RoomBookingConflictDto {
  return {
    bookingId: row.id,
    title: row.title,
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: new Date(row.endsAt).toISOString(),
    organizerName: people.get(row.organizerUserId)?.displayName ?? null,
  };
}

/** Tất cả userId xuất hiện trong một tập lượt (organizer · bookedBy · cancelledBy · attendees) — MỘT lần chiếu tên. */
export function collectPeopleIds(
  rows: readonly RoomBookingRow[],
  attendees: ReadonlyMap<string, string[]>,
): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.organizerUserId);
    if (r.bookedByUserId) ids.add(r.bookedByUserId);
    if (r.cancelledBy) ids.add(r.cancelledBy);
    for (const a of attendees.get(r.id) ?? []) ids.add(a);
  }
  return [...ids];
}
