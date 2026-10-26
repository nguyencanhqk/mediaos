/**
 * S7-CHAT-FE-3 — hàm thuần của badge tổng chưa đọc.
 *
 * Ca giữ chỗ quan trọng nhất: phòng **đã lưu trữ** KHÔNG được cộng vào tổng. `roomsById` chỉ chứa phòng
 * lưu trữ khi người dùng từng ghé tab "Xem phòng đã lưu trữ" — cộng vào là badge đổi số vì một thao tác
 * xem, không phải vì có tin mới, và phần dôi ra trỏ tới phòng mà dropdown không hiện.
 */
import { describe, expect, it } from "vitest";
import { chatRoomSchema, type ChatRoomDto } from "@mediaos/contracts";
import {
  formatUnreadBadge,
  locateUnreadAnchor,
  totalUnreadCount,
  unreadSnapshotOf,
  unseenCountBelow,
} from "./chat-unread";

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

// ── S20-CHAT-UNREAD-1 — mốc chưa đọc của một lần mở phòng ───────────────────────────────────────────

function msg(seq: number, recalled = false) {
  return { id: `m${seq}`, roomSeq: seq, recalledAt: recalled ? "2026-08-04T10:00:00.000Z" : null };
}

function seqRange(from: number, to: number) {
  const out: ReturnType<typeof msg>[] = [];
  for (let seq = from; seq <= to; seq += 1) out.push(msg(seq));
  return out;
}

describe("unreadSnapshotOf", () => {
  it("25 chưa đọc / lastMessageSeq 125 ⇒ firstUnreadSeq = 101", () => {
    expect(unreadSnapshotOf({ unreadCount: 25, lastMessageSeq: 125 })).toEqual({
      firstUnreadSeq: 101,
      count: 25,
    });
  });

  it("không có tin chưa đọc ⇒ null (hành vi cũ: xuống đáy)", () => {
    expect(unreadSnapshotOf({ unreadCount: 0, lastMessageSeq: 125 })).toBeNull();
  });

  it("server cũ thiếu một trong hai trường ⇒ null, không đoán", () => {
    expect(unreadSnapshotOf({ lastMessageSeq: 125 })).toBeNull();
    expect(unreadSnapshotOf({ unreadCount: 25 })).toBeNull();
    expect(unreadSnapshotOf({ unreadCount: 25, lastMessageSeq: null })).toBeNull();
  });

  it("payload phòng KHÔNG có `unreadCount`/`lastMessageSeq` vẫn qua `chatRoomSchema` (không ZodError)", () => {
    const legacy = room("legacy");
    delete legacy.unreadCount;
    delete legacy.lastMessageSeq;
    const parsed = chatRoomSchema.safeParse({
      ...legacy,
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && unreadSnapshotOf(parsed.data)).toBeNull();
  });

  it("số lệch nhịp (`unreadCount > lastMessageSeq`) ⇒ kẹp mốc về tin số 1", () => {
    expect(unreadSnapshotOf({ unreadCount: 9, lastMessageSeq: 5 })?.firstUnreadSeq).toBe(1);
  });
});

describe("locateUnreadAnchor", () => {
  it("mốc nằm trong danh sách ⇒ vạch trước đúng tin mốc", () => {
    expect(locateUnreadAnchor(seqRange(76, 125), 101, true)).toEqual({
      kind: "message",
      messageId: "m101",
      truncated: false,
    });
  });

  it("tin mốc đã thu hồi ⇒ vạch trước tin chưa đọc KẾ TIẾP còn hiển thị", () => {
    const list = seqRange(76, 125).map((m) =>
      m.roomSeq <= 102 && m.roomSeq >= 101 ? msg(m.roomSeq, true) : m,
    );
    expect(locateUnreadAnchor(list, 101, true)).toMatchObject({ messageId: "m103" });
  });

  it("tin mốc vắng khỏi trang (bị lọc) ⇒ tin đầu tiên SAU mốc", () => {
    const list = seqRange(76, 125).filter((m) => m.roomSeq !== 101);
    expect(locateUnreadAnchor(list, 101, true)).toMatchObject({ messageId: "m102" });
  });

  it("mốc ở trên tin cũ nhất, còn nạp được ⇒ older-needed (chưa đặt vạch)", () => {
    expect(locateUnreadAnchor(seqRange(76, 125), 66, true)).toEqual({ kind: "older-needed" });
  });

  it("mốc ở trên tin cũ nhất, hết đường nạp ⇒ tin cũ nhất còn hiển thị + truncated", () => {
    const list = [msg(76, true), ...seqRange(77, 125)];
    expect(locateUnreadAnchor(list, 66, false)).toEqual({
      kind: "message",
      messageId: "m77",
      truncated: true,
    });
  });

  it("mọi tin từ mốc trở đi đã thu hồi ⇒ none (như phòng không có tin chưa đọc)", () => {
    const list = [...seqRange(90, 100), msg(101, true), msg(102, true)];
    expect(locateUnreadAnchor(list, 101, false)).toEqual({ kind: "none" });
  });

  it("danh sách rỗng ⇒ none", () => {
    expect(locateUnreadAnchor([], 101, true)).toEqual({ kind: "none" });
  });
});

describe("unseenCountBelow", () => {
  it("đếm bằng hiệu room_seq — kể cả phần chưa nạp tới", () => {
    expect(unseenCountBelow(125, 100)).toBe(25);
    expect(unseenCountBelow(127, 100)).toBe(27);
  });

  it("đã thấy tới tin cuối (hoặc vượt) ⇒ 0; danh sách rỗng ⇒ 0", () => {
    expect(unseenCountBelow(125, 125)).toBe(0);
    expect(unseenCountBelow(120, 125)).toBe(0);
    expect(unseenCountBelow(null, 0)).toBe(0);
  });
});
