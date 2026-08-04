/**
 * S7-CHAT-FE-3 — hàm thuần của badge tổng chưa đọc.
 *
 * Ca giữ chỗ quan trọng nhất: phòng **đã lưu trữ** KHÔNG được cộng vào tổng. `roomsById` chỉ chứa phòng
 * lưu trữ khi người dùng từng ghé tab "Xem phòng đã lưu trữ" — cộng vào là badge đổi số vì một thao tác
 * xem, không phải vì có tin mới, và phần dôi ra trỏ tới phòng mà dropdown không hiện.
 */
import { describe, expect, it } from "vitest";
import type { ChatRoomDto } from "@mediaos/contracts";
import { formatUnreadBadge, pickDropdownRooms, totalUnreadCount } from "./chat-unread";

function room(id: string, over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: `Phòng ${id}`,
    roomCode: `CHAT-${id}`,
    description: null,
    lastMessageAt: "2026-08-04T10:00:00.000Z",
    lastMessageSeq: 5,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

describe("totalUnreadCount", () => {
  it("cộng dồn unreadCount của phòng đang hoạt động", () => {
    const rooms = {
      a: room("a", { unreadCount: 3 }),
      b: room("b", { unreadCount: 4 }),
      c: room("c", { unreadCount: 0 }),
    };
    expect(totalUnreadCount(rooms)).toBe(7);
  });

  it("KHÔNG cộng phòng đã lưu trữ", () => {
    const rooms = {
      a: room("a", { unreadCount: 3 }),
      b: room("b", { unreadCount: 99, isArchived: true }),
    };
    expect(totalUnreadCount(rooms)).toBe(3);
  });

  it("`unreadCount` vắng mặt (optional trong DTO) đếm là 0, không NaN", () => {
    const rooms = { a: room("a", { unreadCount: undefined }), b: room("b", { unreadCount: 2 }) };
    expect(totalUnreadCount(rooms)).toBe(2);
  });

  it("store rỗng ⇒ 0", () => {
    expect(totalUnreadCount({})).toBe(0);
  });
});

describe("formatUnreadBadge", () => {
  it("hiện số khi ≤ 99", () => {
    expect(formatUnreadBadge(1)).toBe("1");
    expect(formatUnreadBadge(99)).toBe("99");
  });

  it("trên 99 ⇒ '99+'", () => {
    expect(formatUnreadBadge(100)).toBe("99+");
    expect(formatUnreadBadge(4321)).toBe("99+");
  });

  it("0 hoặc âm ⇒ chuỗi rỗng (call-site không vẽ badge)", () => {
    expect(formatUnreadBadge(0)).toBe("");
    expect(formatUnreadBadge(-2)).toBe("");
  });
});

describe("pickDropdownRooms", () => {
  it("phòng CÓ tin chưa đọc lên trước, trong từng nhóm giữ thứ tự roomOrder", () => {
    const rooms = {
      a: room("a", { unreadCount: 0 }),
      b: room("b", { unreadCount: 1 }),
      c: room("c", { unreadCount: 0 }),
      d: room("d", { unreadCount: 12 }),
    };
    // roomOrder = mới nhất trước. `b` đứng trước `d` trong roomOrder ⇒ giữ nguyên thứ tự đó dù `d` có
    // nhiều tin chưa đọc hơn: sắp theo số chưa đọc đẩy phòng cũ lên trên phòng vừa có tin.
    const picked = pickDropdownRooms(rooms, ["a", "b", "c", "d"], 10);
    expect(picked.map((r) => r.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("loại phòng đã lưu trữ và phòng không còn trong store", () => {
    const rooms = {
      a: room("a", { unreadCount: 1 }),
      z: room("z", { unreadCount: 5, isArchived: true }),
    };
    const picked = pickDropdownRooms(rooms, ["a", "z", "da-roi-phong"], 10);
    expect(picked.map((r) => r.id)).toEqual(["a"]);
  });

  it("cắt theo limit", () => {
    const rooms = Object.fromEntries(["a", "b", "c"].map((id) => [id, room(id)]));
    expect(pickDropdownRooms(rooms, ["a", "b", "c"], 2)).toHaveLength(2);
  });
});
