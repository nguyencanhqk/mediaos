import { describe, expect, it } from "vitest";
import {
  ROOM_EQUIPMENT_ITEM_MAX_LEN,
  ROOM_EQUIPMENT_MAX_ITEMS,
  myRoomBookingRoleFilterSchema,
  roomBookingStatusFilterSchema,
  roomBookingStatusSchema,
  roomEquipmentSchema,
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
