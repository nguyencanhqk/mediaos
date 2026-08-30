/**
 * S11-ROOM-FE-1 — neo cách bóc lỗi ROOM.
 *
 * Ca có giá trị nhất là ca ĐỐI CHỨNG hình dạng: `details` viết như OBJECT (`{kind: "..."}`) — hình mà
 * bảng SPEC-14 §12 gợi ý bằng lối viết `details.kind` và là cái người ta hay code theo — phải trả
 * `kind === null`. Parser "rộng lượng" chấp nhận cả hai hình sẽ che mất drift thật giữa FE và
 * `AllExceptionsFilter` (memory `error-details-must-be-errordetail-array`).
 *
 * Ca thứ hai: ROOM-ERR-001 với `conflicts` HỎNG HÌNH phải ra `malformed: true`, KHÔNG ra `null` —
 * `null` sẽ bị UI đọc thành "không trùng lịch" và đóng dialog như thể đặt thành công.
 *
 * Danh sách `kind` neo ở đây ĐO TỪ CODE BE (`grep 'roomDetails("'` + `ROOM_ERR.WINDOW`/`.ATTENDEE`),
 * KHÔNG chép bảng spec.
 */
import { describe, it, expect } from "vitest";
import { ApiError } from "@mediaos/web-core";
import { IDEMPOTENCY_ERROR_CODES } from "@mediaos/contracts";
import {
  parseRoomError,
  roomErrorI18nKey,
  readRoomConflicts,
  readDetailInt,
  roomBookingErrorAction,
  ROOM_ERROR_CODE,
  ROOM_ERROR_KINDS,
} from "./room-errors";
import roomsVi from "@/i18n/locales/vi/rooms";

function apiError(
  code: string,
  status: number,
  details?: unknown,
  message = "loi tu server",
): ApiError {
  return new ApiError({ status, code, message, details });
}

/** `roomDetails()` của BE: mọi giá trị qua `String(value)`, kèm `rule: "room"`. */
function details(kind: string, extra: Record<string, string | number | boolean> = {}) {
  return [
    { field: "kind", message: kind, rule: "room" },
    ...Object.entries(extra).map(([field, v]) => ({ field, message: String(v), rule: "room" })),
  ];
}

describe("room-errors — hình dạng details", () => {
  it("mảng ErrorDetail ⇒ bóc được kind", () => {
    const info = parseRoomError(apiError(ROOM_ERROR_CODE.CANCEL, 409, details("already-ended")));
    expect(info.kind).toBe("already-ended");
    expect(info.code).toBe("ROOM-ERR-005");
    expect(info.status).toBe(409);
  });

  it("ĐỐI CHỨNG: details viết như OBJECT ⇒ kind = null (không âm thầm chấp nhận hình sai)", () => {
    const info = parseRoomError(apiError(ROOM_ERROR_CODE.CANCEL, 409, { kind: "already-ended" }));
    expect(info.kind).toBeNull();
    // Vẫn rơi được về khoá theo `code` — người dùng thấy câu đúng nghĩa, không phải "generic".
    expect(roomErrorI18nKey(info)).toBe("errors.cancelInvalid");
  });

  it("details vắng ⇒ kind null, fields rỗng, không ném", () => {
    const info = parseRoomError(apiError(ROOM_ERROR_CODE.NOT_FOUND, 404));
    expect(info.kind).toBeNull();
    expect(info.fields.size).toBe(0);
    expect(roomErrorI18nKey(info)).toBe("errors.notFound");
  });

  it("lỗi KHÔNG phải ApiError (mất mạng) ⇒ generic, không ném", () => {
    const info = parseRoomError(new TypeError("Failed to fetch"));
    expect(info.code).toBeNull();
    expect(roomErrorI18nKey(info)).toBe("errors.generic");
  });

  it("đọc số nguyên từ details (capacity/headcount về dưới dạng CHUỖI)", () => {
    const info = parseRoomError(
      apiError(
        ROOM_ERROR_CODE.CAPACITY,
        422,
        details("over-capacity", { capacity: 6, headcount: 9 }),
      ),
    );
    expect(readDetailInt(info, "capacity")).toBe(6);
    expect(readDetailInt(info, "headcount")).toBe(9);
    expect(readDetailInt(info, "khong-co")).toBeNull();
  });
});

describe("room-errors — ROOM-ERR-001 conflicts", () => {
  const conflict = {
    bookingId: "11111111-1111-4111-8111-111111111111",
    title: "Họp tuần",
    startsAt: "2026-09-02T02:00:00.000Z",
    endsAt: "2026-09-02T03:00:00.000Z",
    organizerName: "Nguyễn Văn A",
  };

  it("bóc được conflicts + nextFreeFrom", () => {
    const info = parseRoomError(
      apiError(ROOM_ERROR_CODE.OVERLAP, 409, [
        { field: "kind", message: "overlap", rule: "room" },
        { field: "conflicts", message: JSON.stringify([conflict]), rule: "room" },
        { field: "nextFreeFrom", message: "2026-09-02T03:00:00.000Z", rule: "room" },
      ]),
    );
    const parsed = readRoomConflicts(info);
    expect(parsed?.conflicts).toHaveLength(1);
    expect(parsed?.conflicts[0]?.title).toBe("Họp tuần");
    expect(parsed?.nextFreeFrom).toBe("2026-09-02T03:00:00.000Z");
    expect(parsed?.malformed).toBeUndefined();
  });

  it('nextFreeFrom = "null" (chuỗi) ⇒ null thật', () => {
    const info = parseRoomError(
      apiError(ROOM_ERROR_CODE.OVERLAP, 409, [
        { field: "kind", message: "overlap", rule: "room" },
        { field: "conflicts", message: "[]", rule: "room" },
        { field: "nextFreeFrom", message: "null", rule: "room" },
      ]),
    );
    expect(readRoomConflicts(info)?.nextFreeFrom).toBeNull();
  });

  it("conflicts HỎNG JSON ⇒ malformed:true, KHÔNG phải null (null sẽ bị đọc thành 'không trùng')", () => {
    const info = parseRoomError(
      apiError(ROOM_ERROR_CODE.OVERLAP, 409, [
        { field: "kind", message: "overlap", rule: "room" },
        { field: "conflicts", message: "{khong-phai-json", rule: "room" },
        { field: "nextFreeFrom", message: "null", rule: "room" },
      ]),
    );
    const parsed = readRoomConflicts(info);
    expect(parsed).not.toBeNull();
    expect(parsed?.malformed).toBe(true);
    expect(parsed?.conflicts).toEqual([]);
  });

  it("ROOM-ERR-001 mà details vắng hẳn ⇒ vẫn ra khung malformed (server nói trùng thì là trùng)", () => {
    const parsed = readRoomConflicts(parseRoomError(apiError(ROOM_ERROR_CODE.OVERLAP, 409)));
    expect(parsed?.malformed).toBe(true);
  });

  it("lỗi KHÁC ROOM-ERR-001 ⇒ null (không dựng khung trùng lịch giả)", () => {
    const info = parseRoomError(apiError(ROOM_ERROR_CODE.CANCEL, 409, details("already-ended")));
    expect(readRoomConflicts(info)).toBeNull();
  });
});

describe("room-errors — ba nhánh của form đặt phòng (SPEC-14 §9 màn 002)", () => {
  it("ROOM-ERR-001 ⇒ show-conflicts", () => {
    expect(roomBookingErrorAction(parseRoomError(apiError(ROOM_ERROR_CODE.OVERLAP, 409)))).toBe(
      "show-conflicts",
    );
  });

  it("IN_PROGRESS ⇒ wait — KHÔNG sinh khoá mới (sinh mới biến bấm-đúp thành hai lượt thật)", () => {
    const info = parseRoomError(apiError(IDEMPOTENCY_ERROR_CODES.IN_PROGRESS, 409));
    expect(roomBookingErrorAction(info)).toBe("wait");
  });

  it("KEY_REUSED ⇒ retry-new-key", () => {
    const info = parseRoomError(apiError(IDEMPOTENCY_ERROR_CODES.KEY_REUSED, 409));
    expect(roomBookingErrorAction(info)).toBe("retry-new-key");
  });

  it("409 khác (room-inactive) ⇒ show-message — KHÔNG rẽ theo status", () => {
    const info = parseRoomError(
      apiError(ROOM_ERROR_CODE.ROOM_NOT_BOOKABLE, 409, details("room-inactive")),
    );
    expect(roomBookingErrorAction(info)).toBe("show-message");
    expect(roomErrorI18nKey(info)).toBe("errors.roomInactive");
  });

  it("403 book-on-behalf-denied ⇒ show-message với câu riêng", () => {
    const info = parseRoomError(
      apiError(ROOM_ERROR_CODE.ORGANIZER, 403, details("book-on-behalf-denied")),
    );
    expect(roomBookingErrorAction(info)).toBe("show-message");
    expect(roomErrorI18nKey(info)).toBe("errors.bookOnBehalfDenied");
  });

  it("422 organizer-not-found ⇒ câu KHÁC 403 dù cùng mã ROOM-ERR-010", () => {
    const info = parseRoomError(
      apiError(ROOM_ERROR_CODE.ORGANIZER, 422, details("organizer-not-found")),
    );
    expect(roomErrorI18nKey(info)).toBe("errors.organizerNotFound");
  });
});

describe("room-errors — phủ i18n", () => {
  it("mọi kind BE phát ra đều có khoá i18n RIÊNG và khoá đó tồn tại trong bundle vi", () => {
    const keys = new Set<string>();
    for (const kind of ROOM_ERROR_KINDS) {
      const info = parseRoomError(apiError("ROOM-ERR-XXX", 409, details(kind)));
      const key = roomErrorI18nKey(info);
      expect(key).not.toBe("errors.generic");
      keys.add(key);
      // Khoá phải giải được trong bundle vi — thiếu bản dịch thì UI hiện nguyên chuỗi "errors.xxx".
      const leaf = key
        .split(".")
        .reduce<unknown>(
          (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
          roomsVi as unknown,
        );
      expect(typeof leaf, `thiếu bản dịch cho ${key} (kind ${kind})`).toBe("string");
    }
    // KHÔNG hai kind nào dùng chung một khoá: dùng chung là mất khả năng phân biệt ngay trên UI.
    expect(keys.size).toBe(ROOM_ERROR_KINDS.length);
  });

  it("mọi khoá tra theo code cũng tồn tại trong bundle vi", () => {
    const codes = [...Object.values(ROOM_ERROR_CODE), ...Object.values(IDEMPOTENCY_ERROR_CODES)];
    for (const code of codes) {
      const key = roomErrorI18nKey(parseRoomError(apiError(code, 409)));
      const leaf = key
        .split(".")
        .reduce<unknown>(
          (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
          roomsVi as unknown,
        );
      expect(typeof leaf, `thiếu bản dịch cho ${key} (code ${code})`).toBe("string");
    }
  });
});
