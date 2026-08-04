/**
 * S7-CHAT-FE-5 — hàm thuần của hai màn đọc-vượt. Gọi hàm, không dựng DOM.
 */
import { describe, expect, it } from "vitest";
import type { ChatOversightAuditEntryDto } from "@mediaos/contracts";
import {
  dayKeyOf,
  distinctActors,
  filterAuditEntries,
  formatBytes,
  formatCriteria,
  formatDateTime,
  formatDateTimeShort,
  olderCursorOf,
  roomLabel,
} from "./chat-oversight-format";

const entry = (over: Partial<ChatOversightAuditEntryDto>): ChatOversightAuditEntryDto => ({
  id: "77777777-7777-4777-8777-777777777777",
  actorUserId: "22222222-2222-4222-8222-222222222222",
  actorName: "Nguyễn Văn A",
  roomId: null,
  roomCode: null,
  roomName: null,
  resultStatus: "Success",
  endpoint: "018a",
  criteria: null,
  createdAt: "2026-08-04T03:00:00.000Z",
  ...over,
});

describe("formatDateTime / formatDateTimeShort", () => {
  it("mốc hỏng ⇒ chuỗi RỖNG, không phải 'Invalid Date'", () => {
    expect(formatDateTime("khong-phai-ngay")).toBe("");
    expect(formatDateTimeShort("khong-phai-ngay")).toBe("");
  });

  it("bản ngắn = bản đầy bỏ phần giây", () => {
    const iso = new Date(2026, 7, 4, 9, 5, 7).toISOString();
    expect(formatDateTime(iso)).toBe("04/08/2026 09:05:07");
    expect(formatDateTimeShort(iso)).toBe("04/08/2026 09:05");
  });
});

describe("dayKeyOf — giờ ĐỊA PHƯƠNG, không UTC", () => {
  it("06:30 sáng giờ máy vẫn thuộc CHÍNH ngày đó (dùng toISOString sẽ lùi 1 ngày ở UTC+7)", () => {
    const local = new Date(2026, 7, 4, 6, 30, 0);
    expect(dayKeyOf(local.toISOString())).toBe("2026-08-04");
  });

  it("23:30 đêm không bị đẩy sang ngày hôm sau", () => {
    const local = new Date(2026, 7, 4, 23, 30, 0);
    expect(dayKeyOf(local.toISOString())).toBe("2026-08-04");
  });

  it("mốc hỏng ⇒ rỗng", () => {
    expect(dayKeyOf("x")).toBe("");
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1024 * 1024 * 3, "3.0 MB"],
  ])("%i B ⇒ %s", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it("giá trị lạ ⇒ rỗng", () => {
    expect(formatBytes(Number.NaN)).toBe("");
    expect(formatBytes(-1)).toBe("");
  });
});

describe("roomLabel", () => {
  it("phòng direct KHÔNG tên ⇒ rơi về MÃ phòng, không bịa tên", () => {
    expect(roomLabel({ name: null, roomCode: "ROOM-009" })).toBe("ROOM-009");
  });

  it("tên toàn khoảng trắng cũng rơi về mã (chuỗi rỗng làm ô trống trên bảng)", () => {
    expect(roomLabel({ name: "   ", roomCode: "ROOM-009" })).toBe("ROOM-009");
  });

  it("có tên thì dùng tên", () => {
    expect(roomLabel({ name: "Kỹ thuật", roomCode: "ROOM-001" })).toBe("Kỹ thuật");
  });
});

describe("formatCriteria", () => {
  it("null ⇒ rỗng; object ⇒ 'khoá: giá trị' nối bằng ·", () => {
    expect(formatCriteria(null)).toBe("");
    expect(formatCriteria({ q: "ky thuat", roomType: "group" })).toBe(
      "q: ky thuat · roomType: group",
    );
  });

  it("giá trị null/undefined bị bỏ, giá trị object được stringify (không nuốt bằng chứng)", () => {
    expect(formatCriteria({ q: "a", roomType: null })).toBe("q: a");
    expect(formatCriteria({ range: { from: 1, to: 2 } })).toBe('range: {"from":1,"to":2}');
  });
});

describe("filterAuditEntries — CLIENT-SIDE, trên các dòng ĐÃ TẢI", () => {
  const other = "99999999-9999-4999-8999-999999999999";
  const rows = [
    entry({ id: "a", createdAt: new Date(2026, 7, 1, 10, 0).toISOString() }),
    entry({ id: "b", createdAt: new Date(2026, 7, 4, 10, 0).toISOString() }),
    entry({
      id: "c",
      actorUserId: other,
      actorName: "Trần Thị B",
      createdAt: new Date(2026, 7, 6, 10, 0).toISOString(),
    }),
  ];

  it("không đặt gì ⇒ trả nguyên", () => {
    expect(filterAuditEntries(rows, { actorUserId: "", from: "", to: "" })).toHaveLength(3);
  });

  it("lọc theo NGƯỜI dùng id (tên trùng nhau được, id thì không)", () => {
    const out = filterAuditEntries(rows, { actorUserId: other, from: "", to: "" });
    expect(out.map((r) => r.id)).toEqual(["c"]);
  });

  it("khoảng ngày BAO GỒM cả hai đầu mút", () => {
    const out = filterAuditEntries(rows, {
      actorUserId: "",
      from: "2026-08-04",
      to: "2026-08-06",
    });
    expect(out.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("dòng có mốc HỎNG không bị giấu đi khi lọc theo ngày — audit hỏng vẫn là bằng chứng", () => {
    const broken = entry({ id: "x", createdAt: "khong-phai-ngay" });
    const out = filterAuditEntries([...rows, broken], {
      actorUserId: "",
      from: "2026-08-04",
      to: "2026-08-04",
    });
    expect(out.map((r) => r.id)).toEqual(["b", "x"]);
  });
});

describe("distinctActors", () => {
  it("gộp theo id, bỏ dòng không có actor, giữ tên KHÔNG rỗng đầu tiên gặp được", () => {
    const rows = [
      entry({ id: "1", actorUserId: "u1", actorName: null }),
      entry({ id: "2", actorUserId: "u1", actorName: "Nguyễn Văn A" }),
      entry({ id: "3", actorUserId: null, actorName: null }),
    ];
    expect(distinctActors(rows)).toEqual([{ userId: "u1", name: "Nguyễn Văn A" }]);
  });
});

describe("olderCursorOf", () => {
  it("trang rỗng ⇒ null (đã hết lịch sử)", () => {
    expect(olderCursorOf([])).toBeNull();
  });

  it("trả roomSeq NHỎ NHẤT — `beforeSeq` loại trừ nên đây là con trỏ trang cũ hơn", () => {
    expect(olderCursorOf([{ roomSeq: 10 }, { roomSeq: 11 }, { roomSeq: 12 }])).toBe(10);
  });
});
