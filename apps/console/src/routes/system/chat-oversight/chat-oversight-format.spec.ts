/**
 * S7-CHAT-FE-5 — hàm thuần của hai màn đọc-vượt. Gọi hàm, không dựng DOM.
 */
import { describe, expect, it } from "vitest";
import type { ChatOversightAuditEntryDto } from "@mediaos/contracts";
import {
  auditFilterParams,
  distinctActors,
  formatBytes,
  formatCriteria,
  formatDateTime,
  formatDateTimeShort,
  mergeActorOptions,
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

/*
 * `dayKeyOf` và `filterAuditEntries` đã bị GỠ ở `S7-CHAT-BE-9` — bộ lọc chuyển hẳn sang server.
 *
 * ⚠️ Ca test của chúng KHÔNG biến mất mà chuyển tầng, đúng chỗ hành vi bây giờ sống:
 *   · "khoảng ngày BAO GỒM cả hai đầu mút" → `apps/api/src/chat/chat-oversight-audit-filter.spec.ts`
 *     (biên trên nửa mở ở 00:00 ngày kế) + int-spec ca 26e (quy đổi theo TZ CÔNG TY, không phải giờ máy);
 *   · "lọc theo NGƯỜI dùng id"             → int-spec ca 26d;
 * Xoá ca test mà không có ca thay thế ở tầng mới là cách phổ biến nhất để một hành vi lặng lẽ mất canh
 * (memory `review-gate-blind-to-deletions`).
 */

describe("auditFilterParams — ô trống bị BỎ khỏi query, không gửi chuỗi rỗng", () => {
  it("không điền gì ⇒ không tham số nào", () => {
    expect(auditFilterParams({ actorUserId: "", from: "", to: "" })).toEqual({});
  });

  it('chỉ gửi ô đã điền — `""` gửi lên là 400 (server khai `.uuid()` / `YYYY-MM-DD`)', () => {
    expect(auditFilterParams({ actorUserId: "u1", from: "", to: "2026-08-04" })).toEqual({
      actorUserId: "u1",
      to: "2026-08-04",
    });
  });

  it("`from`/`to` giữ NGUYÊN dạng ngày — client KHÔNG tự quy đổi sang mốc UTC", () => {
    const out = auditFilterParams({ actorUserId: "", from: "2026-08-04", to: "2026-08-05" });
    expect(out).toEqual({ from: "2026-08-04", to: "2026-08-05" });
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

describe("mergeActorOptions — tích luỹ ĐƠN ĐIỆU", () => {
  const A = { userId: "u1", name: "Nguyễn Văn A" };
  const B = { userId: "u2", name: "Trần Thị B" };

  it("[crown] lọc theo MỘT người không làm những người khác biến mất khỏi ô chọn", () => {
    const both = mergeActorOptions([], [A, B]);
    // Server lọc theo B ⇒ trang trả về chỉ còn B. Option của A phải còn, nếu không người dùng kẹt.
    const afterFilter = mergeActorOptions(both, [B]);
    expect(afterFilter.map((a) => a.userId)).toEqual(["u1", "u2"]);
  });

  it("không có gì mới ⇒ trả về CHÍNH mảng cũ (setState bail-out, effect không tự kích lại)", () => {
    const prev = mergeActorOptions([], [A]);
    expect(mergeActorOptions(prev, [A])).toBe(prev);
    expect(mergeActorOptions(prev, [])).toBe(prev);
  });

  it("tên đến muộn được nhận, nhưng tên đã có KHÔNG bị ghi đè bằng null", () => {
    const seeded = mergeActorOptions([], [{ userId: "u1", name: null }]);
    const named = mergeActorOptions(seeded, [A]);
    expect(named).toEqual([A]);
    expect(mergeActorOptions(named, [{ userId: "u1", name: null }])).toBe(named);
  });

  it("sắp theo tên (vi), rơi về id khi thiếu tên", () => {
    expect(mergeActorOptions([], [B, A]).map((a) => a.userId)).toEqual(["u1", "u2"]);
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
