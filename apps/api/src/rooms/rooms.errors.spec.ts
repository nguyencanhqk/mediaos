import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  ATTENDEE_UNIQUE_CONSTRAINT,
  AUTH_ERR_SCOPE_DENIED,
  OVERLAP_EXCLUSION_CONSTRAINT,
  ROOM_ERR_CODE,
  ROOM_NAME_UNIQUE_CONSTRAINT,
  bookOnBehalfDenied,
  cancelScopeDenied,
  isOverlapExclusion,
  mapRoomPgError,
  overlapError,
  pgErrorOf,
  roomDetails,
} from "./rooms.errors";

/** Mô phỏng vỏ drizzle: `DrizzleQueryError { cause: PgError { code, constraint } }` — lồng n tầng. */
function wrapped(depth: number, code: string, constraint?: string): Error {
  let inner: Error & { code?: string; constraint?: string } = Object.assign(new Error("pg"), {
    code,
    constraint,
  });
  for (let i = 0; i < depth; i += 1) {
    inner = Object.assign(new Error(`wrap-${i}`), { cause: inner });
  }
  return inner;
}

const body = (e: { getResponse(): unknown }) =>
  e.getResponse() as { code: string; details?: Array<{ field: string; message: string }> };
const kindOf = (e: { getResponse(): unknown }) =>
  body(e).details?.find((d) => d.field === "kind")?.message;

describe("rooms.errors — pgErrorOf bóc qua cause (1–3 tầng)", () => {
  it.each([1, 2, 3])("%i tầng cause ⇒ thấy code + constraint", (depth) => {
    const e = pgErrorOf(wrapped(depth, "23P01", OVERLAP_EXCLUSION_CONSTRAINT));
    expect(e?.code).toBe("23P01");
    expect(e?.constraint).toBe(OVERLAP_EXCLUSION_CONSTRAINT);
  });
  it("không có code ở tầng nào ⇒ null; chuỗi tự tham chiếu không treo", () => {
    expect(pgErrorOf(new Error("x"))).toBeNull();
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(pgErrorOf(loop)).toBeNull();
  });
});

describe("rooms.errors — isOverlapExclusion (23P01 đúng constraint)", () => {
  it("23P01 + room_bookings_no_overlap_excl ⇒ true (qua 2 tầng cause)", () => {
    expect(isOverlapExclusion(wrapped(2, "23P01", OVERLAP_EXCLUSION_CONSTRAINT))).toBe(true);
  });
  it("23P01 constraint khác / 23505 / lỗi thường ⇒ false", () => {
    expect(isOverlapExclusion(wrapped(1, "23P01", "other_excl"))).toBe(false);
    expect(isOverlapExclusion(wrapped(1, "23505", OVERLAP_EXCLUSION_CONSTRAINT))).toBe(false);
    expect(isOverlapExclusion(new Error("nope"))).toBe(false);
  });
});

describe("rooms.errors — mapRoomPgError theo TÊN constraint", () => {
  it("23505 uq_meeting_rooms_company_name_active ⇒ 409 ROOM-ERR-009 name-taken (tên trong thông điệp)", () => {
    const e = mapRoomPgError(wrapped(2, "23505", ROOM_NAME_UNIQUE_CONSTRAINT), { name: "Mercury" });
    expect(e).toBeInstanceOf(ConflictException);
    expect(body(e!).code).toBe(ROOM_ERR_CODE.NAME_TAKEN);
    expect(kindOf(e!)).toBe("name-taken");
    expect((e as ConflictException).message).toContain("Mercury");
  });
  it("23505 uq_room_booking_attendees_booking_user ⇒ 422 ROOM-ERR-006 attendee-duplicate", () => {
    const e = mapRoomPgError(wrapped(1, "23505", ATTENDEE_UNIQUE_CONSTRAINT));
    expect(e).toBeInstanceOf(UnprocessableEntityException);
    expect(body(e!).code).toBe(ROOM_ERR_CODE.ATTENDEE);
    expect(kindOf(e!)).toBe("attendee-duplicate");
  });
  it("23505 constraint lạ / 23514 / 23P01 / lỗi thường ⇒ null (caller ném nguyên bản)", () => {
    expect(mapRoomPgError(wrapped(1, "23505", "room_bookings_company_id_id_uq"))).toBeNull();
    expect(mapRoomPgError(wrapped(1, "23514", "chk_room_bookings_cancel_pair"))).toBeNull();
    expect(mapRoomPgError(wrapped(1, "23P01", OVERLAP_EXCLUSION_CONSTRAINT))).toBeNull();
    expect(mapRoomPgError(new Error("x"))).toBeNull();
  });
});

describe("rooms.errors — hình dạng details ErrorDetail[]", () => {
  it("roomDetails: kind + cặp phụ, bỏ null/undefined", () => {
    expect(roomDetails("x", { capacity: 6, headcount: 7, note: null, u: undefined })).toEqual([
      { field: "kind", message: "x", rule: "room" },
      { field: "capacity", message: "6", rule: "room" },
      { field: "headcount", message: "7", rule: "room" },
    ]);
  });
  it("overlapError: conflicts JSON + nextFreeFrom ISO/'null'", () => {
    const c = [
      {
        bookingId: "11111111-1111-4111-8111-111111111111",
        title: "Họp",
        startsAt: "2026-09-02T02:00:00.000Z",
        endsAt: "2026-09-02T03:00:00.000Z",
        organizerName: "Lê C",
      },
    ];
    const e1 = overlapError("Mercury", c, new Date("2026-09-02T03:00:00Z"));
    const d1 = body(e1).details!;
    expect(body(e1).code).toBe(ROOM_ERR_CODE.OVERLAP);
    expect(JSON.parse(d1.find((d) => d.field === "conflicts")!.message)).toEqual(c);
    expect(d1.find((d) => d.field === "nextFreeFrom")!.message).toBe("2026-09-02T03:00:00.000Z");
    const e2 = overlapError("Mercury", [], null);
    expect(body(e2).details!.find((d) => d.field === "nextFreeFrom")!.message).toBe("null");
  });
  it("bookOnBehalfDenied ⇒ 403 ROOM-ERR-010 book-on-behalf-denied; cancelScopeDenied ⇒ 403 AUTH-ERR-SCOPE-DENIED", () => {
    const a = bookOnBehalfDenied();
    expect(a).toBeInstanceOf(ForbiddenException);
    expect(body(a).code).toBe(ROOM_ERR_CODE.ORGANIZER);
    expect(kindOf(a)).toBe("book-on-behalf-denied");
    const b = cancelScopeDenied();
    expect(b).toBeInstanceOf(ForbiddenException);
    expect(body(b).code).toBe(AUTH_ERR_SCOPE_DENIED);
  });
});
