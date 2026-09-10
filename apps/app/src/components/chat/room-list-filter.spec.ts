/**
 * S17-CHAT-UX2-FE-1 — luật chip lọc nhanh (CHAT-DEC-021 · SPEC-15 §9a).
 *
 * Kiểm trên DỮ LIỆU, không trên DOM. Bất biến quan trọng nhất ở đây — «mỗi phòng xuất hiện ĐÚNG một
 * lần trên MỌI chip» — hỏng im lặng trên DOM: hai node cùng `key` ở hai `<ul>` anh em không sinh cảnh
 * báo nào (memory `duplicate-sibling-key-leaks-dom-node`).
 */
import { describe, expect, it } from "vitest";
import type { ChatRoomDto } from "@mediaos/contracts";
import {
  DEFAULT_ROOM_FILTER_CHIP,
  ROOM_FILTER_CHIPS,
  chipNeedsArchivedScope,
  chipUsesSections,
  filterRoomsByChip,
} from "./room-list-filter";

const COMPANY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function room(id: string, over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id,
    companyId: COMPANY,
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

describe("room-list-filter · hằng số + hai vị từ rẽ nhánh", () => {
  it("mặc định là «Tất cả» và «Tất cả» là chip DUY NHẤT giữ mục cố định", () => {
    expect(DEFAULT_ROOM_FILTER_CHIP).toBe("all");
    const usingSections = ROOM_FILTER_CHIPS.filter((c) => chipUsesSections(c));
    expect(usingSections).toEqual(["all"]);
  });

  it("«Lưu trữ» là chip DUY NHẤT đổi RỔ dữ liệu", () => {
    const needingArchived = ROOM_FILTER_CHIPS.filter((c) => chipNeedsArchivedScope(c));
    expect(needingArchived).toEqual(["archived"]);
  });

  it("KHÔNG có chip «Ưa thích» — §9a chốt nó ≡ «Đã ghim»", () => {
    expect(ROOM_FILTER_CHIPS as readonly string[]).not.toContain("favorite");
    expect(ROOM_FILTER_CHIPS as readonly string[]).not.toContain("pinned");
  });
});

describe("filterRoomsByChip · từng chip trả đúng tập", () => {
  const rooms = [
    room("dm", { roomType: "direct" }),
    room("g", { roomType: "group" }),
    room("dep", { roomType: "department" }),
    room("prj", { roomType: "project" }),
  ];

  it("«Tất cả» giữ nguyên rổ (không lọc thêm gì)", () => {
    expect(filterRoomsByChip(rooms, "all").map((r) => r.id)).toEqual(["dm", "g", "dep", "prj"]);
  });

  it("«Riêng» / «Nhóm» lọc đúng một `roomType`", () => {
    expect(filterRoomsByChip(rooms, "direct").map((r) => r.id)).toEqual(["dm"]);
    expect(filterRoomsByChip(rooms, "group").map((r) => r.id)).toEqual(["g"]);
  });

  it("«Phòng ban · Dự án» gộp ĐÚNG hai loại phòng dẫn xuất", () => {
    expect(filterRoomsByChip(rooms, "deptproject").map((r) => r.id)).toEqual(["dep", "prj"]);
  });

  it("«Lưu trữ» KHÔNG tự lọc — rổ đã do cấp trên đổi (`listRooms({archived:true})`)", () => {
    const archived = [room("old", { isArchived: true })];
    expect(filterRoomsByChip(archived, "archived").map((r) => r.id)).toEqual(["old"]);
  });

  /**
   * Ca đắt nhất file này: `markRoomUnread` CỐ Ý không đổi `unreadCount` (con trỏ `last_read_seq` chỉ
   * tiến — SPEC-15 §13.2). Một bản luật thứ hai `(unreadCount ?? 0) > 0` viết ngay trong component sẽ
   * giấu đúng phòng người dùng vừa tự đánh dấu, trong khi dòng của nó vẫn đang in ĐẬM ngay trước mắt họ.
   */
  it("«Chưa đọc» đi qua `isRoomUnreadLooking`: phòng ĐÁNH DẤU THỦ CÔNG (badge 0) VẪN có trong tập", () => {
    const list = [
      room("badge", { unreadCount: 3 }),
      room("manual", { unreadCount: 0, markedUnreadAt: "2026-08-04T10:00:00.000Z" }),
      room("read", { unreadCount: 0 }),
    ];
    expect(filterRoomsByChip(list, "unread").map((r) => r.id)).toEqual(["badge", "manual"]);
  });
});

describe("filterRoomsByChip · bất biến áp cho MỌI chip", () => {
  /**
   * Phòng `both` khớp NHIỀU tiêu chí cùng lúc (vừa ghim, vừa chưa đọc, vừa là DM). §9a: nó vẫn phải
   * xuất hiện ĐÚNG một lần trong danh sách phẳng của mỗi chip.
   */
  const rooms = [
    room("both", {
      roomType: "direct",
      unreadCount: 4,
      pinnedAt: "2026-08-04T09:00:00.000Z",
      markedUnreadAt: "2026-08-04T09:30:00.000Z",
    }),
    room("g", { roomType: "group", unreadCount: 1 }),
    room("dep", { roomType: "department" }),
  ];

  it("mỗi `id` xuất hiện ĐÚNG MỘT lần ở mọi chip", () => {
    for (const chip of ROOM_FILTER_CHIPS) {
      const ids = filterRoomsByChip(rooms, chip).map((r) => r.id);
      expect(new Set(ids).size, `chip "${chip}" nhân bản phòng`).toBe(ids.length);
    }
  });

  it("chip ≠ «Tất cả» GIỮ NGUYÊN thứ tự đầu vào — ghim KHÔNG được đẩy lên đầu", () => {
    // Đầu vào theo hoạt động: g (mới nhất) → both (đã ghim) → dep.
    const byActivity = [rooms[1], rooms[0], rooms[2]];
    expect(filterRoomsByChip(byActivity, "unread").map((r) => r.id)).toEqual(["g", "both"]);
    expect(filterRoomsByChip(byActivity, "direct").map((r) => r.id)).toEqual(["both"]);
  });

  it("trả MẢNG MỚI, không phải chính mảng đầu vào (caller sắp/cắt được mà không đụng store)", () => {
    const input = [room("a")];
    expect(filterRoomsByChip(input, "all")).not.toBe(input);
  });
});
