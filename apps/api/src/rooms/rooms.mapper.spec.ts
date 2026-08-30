import { describe, expect, it } from "vitest";
import type { RoomBookingRow } from "./room-bookings.repository";
import {
  collectPeopleIds,
  computeCanCancel,
  toBookingDto,
  toConflictDto,
  toUsageSummaryItemDto,
} from "./rooms.mapper";
import type { RoomPeopleMap, RoomPersonRef } from "./rooms.types";

const NOW = new Date("2026-09-01T02:00:00Z");
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ATT = "33333333-3333-4333-8333-333333333333";

function row(over: Partial<RoomBookingRow> = {}): RoomBookingRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    roomId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    roomName: "Mercury",
    roomLocation: "Tầng 3",
    roomCapacity: 6,
    title: "Họp",
    description: null,
    startsAt: new Date("2026-09-01T03:00:00Z"),
    endsAt: new Date("2026-09-01T04:00:00Z"),
    organizerUserId: OTHER,
    bookedByUserId: OTHER,
    status: "Confirmed",
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: new Date("2026-08-30T00:00:00Z"),
    ...over,
  };
}

const people: RoomPeopleMap = new Map<string, RoomPersonRef>([
  [ME, { userId: ME, displayName: "Tôi", employeeCode: "NV-1" }],
  [OTHER, { userId: OTHER, displayName: "Người khác", employeeCode: null }],
]);

describe("rooms.mapper — canCancel (SPEC-14 §13.3) 6 tổ hợp", () => {
  it("không có cặp cancel ⇒ false dù là organizer", () => {
    expect(
      computeCanCancel(row({ organizerUserId: ME }), {
        now: NOW,
        actorUserId: ME,
        cancelScope: null,
      }),
    ).toBe(false);
  });
  it("Own + organizer = me ⇒ true; Own + organizer khác ⇒ false", () => {
    expect(
      computeCanCancel(row({ organizerUserId: ME }), {
        now: NOW,
        actorUserId: ME,
        cancelScope: "Own",
      }),
    ).toBe(true);
    expect(computeCanCancel(row(), { now: NOW, actorUserId: ME, cancelScope: "Own" })).toBe(false);
  });
  it("Company ⇒ true với lượt người khác", () => {
    expect(computeCanCancel(row(), { now: NOW, actorUserId: ME, cancelScope: "Company" })).toBe(
      true,
    );
  });
  it("Cancelled ⇒ false; đã kết thúc ⇒ false; đang diễn ra ⇒ true", () => {
    expect(
      computeCanCancel(row({ status: "Cancelled" }), {
        now: NOW,
        actorUserId: ME,
        cancelScope: "Company",
      }),
    ).toBe(false);
    expect(
      computeCanCancel(
        row({
          startsAt: new Date("2026-09-01T00:00:00Z"),
          endsAt: new Date("2026-09-01T01:00:00Z"),
        }),
        {
          now: NOW,
          actorUserId: ME,
          cancelScope: "Company",
        },
      ),
    ).toBe(false);
    expect(
      computeCanCancel(
        row({
          startsAt: new Date("2026-09-01T01:30:00Z"),
          endsAt: new Date("2026-09-01T02:30:00Z"),
        }),
        {
          now: NOW,
          actorUserId: ME,
          cancelScope: "Company",
        },
      ),
    ).toBe(true);
  });
});

describe("rooms.mapper — toBookingDto", () => {
  it("isCompleted dẫn xuất; người ngoài map chỉ có userId; KHÔNG khoá email; ISO chuẩn", () => {
    const dto = toBookingDto(
      row({ startsAt: new Date("2026-09-01T00:00:00Z"), endsAt: new Date("2026-09-01T01:00:00Z") }),
      [ATT, ME],
      people,
      { now: NOW, actorUserId: ME, cancelScope: "Company" },
    );
    expect(dto.isCompleted).toBe(true);
    expect(dto.canCancel).toBe(false);
    expect(dto.organizer).toEqual({ userId: OTHER, displayName: "Người khác", employeeCode: null });
    expect(dto.attendees[0]).toEqual({ userId: ATT, displayName: null, employeeCode: null });
    expect(dto.attendees[1]).toEqual({ userId: ME, displayName: "Tôi", employeeCode: "NV-1" });
    expect(dto.startsAt).toBe("2026-09-01T00:00:00.000Z");
    expect(JSON.stringify(dto)).not.toMatch(/email|phone/i);
    expect(dto.cancelledBy).toBeNull();
  });
  it("cancelledBy/cancelledAt/cancelReason khi Cancelled", () => {
    const dto = toBookingDto(
      row({
        status: "Cancelled",
        cancelledAt: new Date("2026-08-31T00:00:00Z"),
        cancelledBy: ME,
        cancelReason: "bận",
      }),
      [],
      people,
      { now: NOW, actorUserId: ME, cancelScope: "Company" },
    );
    expect(dto.status).toBe("Cancelled");
    expect(dto.isCompleted).toBe(false);
    expect(dto.cancelledBy?.displayName).toBe("Tôi");
    expect(dto.cancelledAt).toBe("2026-08-31T00:00:00.000Z");
    expect(dto.cancelReason).toBe("bận");
  });
});

describe("rooms.mapper — phụ trợ", () => {
  it("toConflictDto lấy organizerName từ map (null khi ngoài scope)", () => {
    const base = {
      id: "x",
      title: "t",
      startsAt: new Date("2026-09-01T03:00:00Z"),
      endsAt: new Date("2026-09-01T04:00:00Z"),
    };
    expect(toConflictDto({ ...base, organizerUserId: OTHER }, people).organizerName).toBe(
      "Người khác",
    );
    expect(toConflictDto({ ...base, organizerUserId: ATT }, people).organizerName).toBeNull();
  });
  it("collectPeopleIds gom organizer/bookedBy/cancelledBy/attendees không trùng", () => {
    const ids = collectPeopleIds(
      [row({ cancelledBy: ME }), row({ id: "b2", organizerUserId: ME })],
      new Map([["b2", [ATT, OTHER]]]),
    );
    expect(ids.sort()).toEqual([ME, OTHER, ATT].sort());
  });
  it("toUsageSummaryItemDto ép số (numeric về chuỗi)", () => {
    const d = toUsageSummaryItemDto({
      roomId: "r",
      name: "n",
      bookingsCount: 2,
      hoursBooked: "1.50" as unknown as number,
      cancelledCount: 1,
    });
    expect(d.hoursBooked).toBe(1.5);
    expect(typeof d.bookingsCount).toBe("number");
  });
});
