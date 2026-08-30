import { describe, expect, it } from "vitest";
import {
  ROOM_CONFLICTS_MAX,
  ROOM_EQUIPMENT_ITEM_MAX_LEN,
  ROOM_EQUIPMENT_MAX_ITEMS,
  ROOM_MAX_ATTENDEES,
  ROOM_PAGE_DEFAULT,
  createRoomBookingSchema,
  listRoomBookingsQuerySchema,
  listRoomsQuerySchema,
  myRoomBookingRoleFilterSchema,
  myRoomBookingsQuerySchema,
  parseRoomConflictsDetail,
  roomBookingStatusFilterSchema,
  roomBookingStatusSchema,
  roomEquipmentSchema,
  roomIsoDateTimeSchema,
  updateRoomSchema,
} from "./room";

/**
 * PIN HAI CHIỀU enum ↔ CHECK migration 0552 (DB-16 §7). Mảng bên dưới là LITERAL chép từ SQL — cố ý KHÔNG import từ
 * schema drizzle hay từ chính `room.ts` (assert hằng số bằng chính nó là tautology). Đổi CHECK ở DB ⇒ phải đổi cả đây
 * lẫn enum, cùng commit.
 */
describe("contracts/room — enum mirror CHECK 0552 đúng bằng", () => {
  it("roomBookingStatusSchema == chk_room_bookings_status (2) — Completed KHÔNG phải trạng thái lưu", () => {
    expect(roomBookingStatusSchema.options).toEqual(["Confirmed", "Cancelled"]);
    expect(roomBookingStatusSchema.safeParse("Completed").success).toBe(false);
  });

  it("roomBookingStatusFilterSchema (chỉ Zod) = status ∪ {all}", () => {
    expect(roomBookingStatusFilterSchema.options).toEqual(["Confirmed", "Cancelled", "all"]);
  });

  it("myRoomBookingRoleFilterSchema (chỉ Zod) = organizer · attendee · all", () => {
    expect(myRoomBookingRoleFilterSchema.options).toEqual(["organizer", "attendee", "all"]);
  });

  it("roomEquipmentSchema: ≤ 20 mục, mỗi mục 1–40 ký tự (DB không CHECK — chốt ở đây)", () => {
    expect(ROOM_EQUIPMENT_MAX_ITEMS).toBe(20);
    expect(ROOM_EQUIPMENT_ITEM_MAX_LEN).toBe(40);
    const ok = Array.from({ length: 20 }, (_, i) => `Thiết bị ${i}`);
    expect(roomEquipmentSchema.safeParse(ok).success).toBe(true);
    expect(roomEquipmentSchema.safeParse([...ok, "thứ 21"]).success).toBe(false);
    expect(roomEquipmentSchema.safeParse(["x".repeat(41)]).success).toBe(false);
    expect(roomEquipmentSchema.safeParse(["   "]).success).toBe(false);
    expect(roomEquipmentSchema.parse([" TV "])).toEqual(["TV"]);
  });
});
// ─── S11-ROOM-BE-1 — DTO request/response ───────────────────────────────────────────────────────────

describe("contracts/room — DTO S11-ROOM-BE-1 (API-15)", () => {
  it("updateRoomSchema `.strict()`: khoá lạ ⇒ lỗi (không strip im lặng); partial hợp lệ", () => {
    expect(updateRoomSchema.safeParse({ name: "A", isActive: false }).success).toBe(true);
    expect(updateRoomSchema.safeParse({ deletedAt: null }).success).toBe(false);
    // PATCH rỗng ⇒ lỗi (silent-failure gate L2 — không UPDATE/audit giả).
    expect(updateRoomSchema.safeParse({}).success).toBe(false);
    expect(updateRoomSchema.safeParse({ companyId: "x" }).success).toBe(false);
  });

  it("roomIsoDateTimeSchema đòi offset: `Z`/`+07:00` qua, thiếu offset/ngày trần ⇒ lỗi", () => {
    expect(roomIsoDateTimeSchema.safeParse("2026-09-02T02:00:00Z").success).toBe(true);
    expect(roomIsoDateTimeSchema.safeParse("2026-09-02T09:00:00+07:00").success).toBe(true);
    expect(roomIsoDateTimeSchema.safeParse("2026-09-02T09:00:00").success).toBe(false);
    expect(roomIsoDateTimeSchema.safeParse("2026-09-02").success).toBe(false);
  });

  it("myRoomBookingsQuerySchema: đúng MỘT trong `date` | `from+to`; KHÔNG có `userId` (bị strip)", () => {
    const iso = "2026-09-02T00:00:00Z";
    expect(myRoomBookingsQuerySchema.safeParse({ date: "2026-09-02" }).success).toBe(true);
    expect(myRoomBookingsQuerySchema.safeParse({ from: iso, to: iso }).success).toBe(true);
    expect(myRoomBookingsQuerySchema.safeParse({}).success).toBe(false);
    expect(
      myRoomBookingsQuerySchema.safeParse({
        date: "2026-09-02",
        from: iso,
        to: iso,
      }).success,
    ).toBe(false);
    expect(myRoomBookingsQuerySchema.safeParse({ from: iso }).success).toBe(false);
    expect(myRoomBookingsQuerySchema.safeParse({ date: "02/09/2026" }).success).toBe(false);
    const parsed = myRoomBookingsQuerySchema.parse({
      date: "2026-09-02",
      userId: "x",
      role: "attendee",
    });
    expect("userId" in parsed).toBe(false);
    expect(parsed.role).toBe("attendee");
    expect(myRoomBookingsQuerySchema.parse({ date: "2026-09-02" }).role).toBe("all");
  });

  it("query list/bool preprocess idempotent: roomId CSV|mảng|chuỗi, includeInactive 'false' ⇒ false", () => {
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    const base = { from: "2026-09-02T00:00:00Z", to: "2026-09-03T00:00:00Z" };
    expect(listRoomBookingsQuerySchema.parse({ ...base, roomId: `${a},${b}` }).roomId).toEqual([
      a,
      b,
    ]);
    expect(listRoomBookingsQuerySchema.parse({ ...base, roomId: a }).roomId).toEqual([a]);
    expect(listRoomBookingsQuerySchema.parse({ ...base, roomId: [a] }).roomId).toEqual([a]);
    expect(listRoomBookingsQuerySchema.parse(base).status).toBe("Confirmed");
    expect(listRoomsQuerySchema.parse({ includeInactive: "false" }).includeInactive).toBe(false);
    expect(listRoomsQuerySchema.parse({ includeInactive: true }).includeInactive).toBe(true);
    expect(listRoomsQuerySchema.parse({}).per_page).toBe(ROOM_PAGE_DEFAULT);
  });

  it("createRoomBookingSchema: attendees ≤ 50 (Zod), KHÔNG dedupe (service 422 006)", () => {
    const u = (i: number) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`;
    const base = {
      roomId: u(1),
      title: "Họp",
      startsAt: "2026-09-02T02:00:00Z",
      endsAt: "2026-09-02T03:00:00Z",
    };
    expect(
      createRoomBookingSchema.safeParse({
        ...base,
        attendeeUserIds: [u(2), u(2)],
      }).success,
    ).toBe(true);
    expect(
      createRoomBookingSchema.safeParse({
        ...base,
        attendeeUserIds: Array.from({ length: ROOM_MAX_ATTENDEES + 1 }, (_, i) => u(i + 2)),
      }).success,
    ).toBe(false);
  });

  it("parseRoomConflictsDetail: bóc details mảng ErrorDetail ⇒ object có kiểu; sai hình ⇒ malformed", () => {
    const c = {
      bookingId: "11111111-1111-4111-8111-111111111111",
      title: "Họp sprint",
      startsAt: "2026-09-02T02:00:00.000Z",
      endsAt: "2026-09-02T03:30:00.000Z",
      organizerName: null,
    };
    const details = [
      { field: "kind", message: "overlap", rule: "room" },
      { field: "conflicts", message: JSON.stringify([c]), rule: "room" },
      { field: "nextFreeFrom", message: "null", rule: "room" },
    ];
    expect(parseRoomConflictsDetail(details)).toEqual({
      kind: "overlap",
      conflicts: [c],
      nextFreeFrom: null,
    });
    expect(
      parseRoomConflictsDetail([
        ...details.slice(0, 2),
        {
          field: "nextFreeFrom",
          message: "2026-09-02T03:30:00.000Z",
          rule: "room",
        },
      ])?.nextFreeFrom,
    ).toBe("2026-09-02T03:30:00.000Z");
    expect(
      parseRoomConflictsDetail([{ field: "kind", message: "room-inactive", rule: "room" }]),
    ).toBeNull();
    expect(parseRoomConflictsDetail(null)).toBeNull();
    expect(
      parseRoomConflictsDetail([
        { field: "kind", message: "overlap", rule: "room" },
        { field: "conflicts", message: "{not-json", rule: "room" },
      ])?.malformed,
    ).toBe(true);
    expect(ROOM_CONFLICTS_MAX).toBe(20);
    // Hỏng hình ⇒ malformed:true (phân biệt với "không phải overlap" = null) — gate M3.
    expect(
      parseRoomConflictsDetail([
        { field: "kind", message: "overlap", rule: "room" },
        { field: "conflicts", message: "{[", rule: "room" },
      ]),
    ).toEqual({ kind: "overlap", conflicts: [], nextFreeFrom: null, malformed: true });
    expect(
      parseRoomConflictsDetail([
        { field: "kind", message: "overlap", rule: "room" },
        { field: "conflicts", message: JSON.stringify([{}]), rule: "room" },
      ])?.malformed,
    ).toBe(true);
  });
});
