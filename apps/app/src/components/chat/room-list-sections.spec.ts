/**
 * S8-CHAT-UX-FE-1 — luật chia mục. Ca quan trọng nhất KHÔNG phải "chia đúng 5 mục" mà là hai thứ hỏng
 * im lặng: (a) một phòng lọt HAI mục, (b) một phòng BIẾN MẤT khỏi mọi mục.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ChatRoomDto } from "@mediaos/contracts";
import {
  ROOM_SECTION_KEYS,
  buildRoomSections,
  collapsedStorageKey,
  readCollapsedSections,
  writeCollapsedSections,
} from "./room-list-sections";

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

describe("buildRoomSections — CHAT-DEC-013", () => {
  it("mỗi phòng xuất hiện ĐÚNG một lần trên toàn bộ các mục", () => {
    const rooms = [
      room("d1", { roomType: "direct" }),
      room("g1", { roomType: "group" }),
      room("dep1", { roomType: "department" }),
      room("p1", { roomType: "project" }),
      room("d2", { roomType: "direct" }),
    ];

    const ids = buildRoomSections(rooms).flatMap((s) => s.rooms.map((r) => r.id));

    expect(ids).toHaveLength(rooms.length);
    expect(new Set(ids).size).toBe(rooms.length);
    expect(new Set(ids)).toEqual(new Set(rooms.map((r) => r.id)));
  });

  it("ghim THẮNG loại phòng — phòng đã ghim KHÔNG còn nằm ở mục loại của nó", () => {
    const rooms = [room("g1", { roomType: "group" }), room("g2", { roomType: "group" })];

    const sections = buildRoomSections(rooms, (r) => r.id === "g1");

    expect(sections.map((s) => s.key)).toEqual(["pinned", "group"]);
    expect(sections[0].rooms.map((r) => r.id)).toEqual(["g1"]);
    expect(sections[1].rooms.map((r) => r.id)).toEqual(["g2"]);
  });

  it("mặc định KHÔNG có mục ghim — cột pinned_at chưa tồn tại, không được bịa mục ma", () => {
    const sections = buildRoomSections([room("g1"), room("g2")]);

    expect(sections.map((s) => s.key)).not.toContain("pinned");
  });

  it("mục RỖNG bị loại khỏi kết quả (không hiện tiêu đề trống)", () => {
    const sections = buildRoomSections([room("d1", { roomType: "direct" })]);

    expect(sections.map((s) => s.key)).toEqual(["direct"]);
  });

  it("giữ nguyên thứ tự đầu vào bên trong mỗi mục — hàm chỉ chia rổ, KHÔNG sắp xếp lại", () => {
    const rooms = [
      room("g3", { roomType: "group" }),
      room("d1", { roomType: "direct" }),
      room("g1", { roomType: "group" }),
      room("g2", { roomType: "group" }),
    ];

    const groups = buildRoomSections(rooms).find((s) => s.key === "group");

    expect(groups?.rooms.map((r) => r.id)).toEqual(["g3", "g1", "g2"]);
  });

  it("các mục xếp theo ROOM_SECTION_KEYS, không theo thứ tự phòng gặp đầu tiên", () => {
    const rooms = [
      room("p1", { roomType: "project" }),
      room("d1", { roomType: "direct" }),
      room("dep1", { roomType: "department" }),
    ];

    const keys = buildRoomSections(rooms).map((s) => s.key);

    expect(keys).toEqual(["direct", "department", "project"]);
    expect(keys).toEqual(ROOM_SECTION_KEYS.filter((k) => keys.includes(k)));
  });

  it("cộng dồn tin chưa đọc theo mục — dấu vết chưa đọc không được mất khi mục bị thu", () => {
    const rooms = [
      room("g1", { roomType: "group", unreadCount: 3 }),
      room("g2", { roomType: "group", unreadCount: 4 }),
      room("g3", { roomType: "group" }), // unreadCount = 0
      room("d1", { roomType: "direct", unreadCount: 1 }),
    ];

    const sections = buildRoomSections(rooms);

    expect(sections.find((s) => s.key === "group")?.unreadTotal).toBe(7);
    expect(sections.find((s) => s.key === "direct")?.unreadTotal).toBe(1);
  });

  it("unreadCount vắng mặt tính là 0, KHÔNG phải NaN", () => {
    const noUnread = room("g1");
    delete (noUnread as { unreadCount?: number }).unreadCount;

    expect(buildRoomSections([noUnread])[0].unreadTotal).toBe(0);
  });

  it("loại phòng LẠ (server thêm room_type mới) vẫn hiện ra, xếp CUỐI — không biến mất", () => {
    const rooms = [
      room("g1", { roomType: "group" }),
      room("x1", { roomType: "broadcast" as ChatRoomDto["roomType"] }),
    ];

    const sections = buildRoomSections(rooms);

    expect(sections.map((s) => s.key)).toEqual(["group", "broadcast"]);
    expect(sections.flatMap((s) => s.rooms.map((r) => r.id))).toEqual(["g1", "x1"]);
  });

  it("danh sách rỗng → 0 mục", () => {
    expect(buildRoomSections([])).toEqual([]);
  });
});

describe("trạng thái thu/mở", () => {
  const KEY = collapsedStorageKey("u1");

  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("khoá lưu tách theo user — người sau KHÔNG thừa hưởng bố cục của người trước", () => {
    expect(collapsedStorageKey("u1")).not.toBe(collapsedStorageKey("u2"));
    expect(collapsedStorageKey(null)).toBe(collapsedStorageKey(undefined));
  });

  it("ghi rồi đọc lại ra đúng giá trị", () => {
    writeCollapsedSections(KEY, { group: true, direct: false });

    expect(readCollapsedSections(KEY)).toEqual({ group: true, direct: false });
  });

  it("chưa có gì trong storage → mở hết", () => {
    expect(readCollapsedSections(KEY)).toEqual({});
  });

  it("JSON rác trong storage → mở hết, KHÔNG ném", () => {
    globalThis.localStorage.setItem(KEY, "{khong-phai-json");

    expect(() => readCollapsedSections(KEY)).not.toThrow();
    expect(readCollapsedSections(KEY)).toEqual({});
  });

  it("JSON hợp lệ nhưng sai hình dạng (mảng / giá trị không phải boolean) bị loại", () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify(["group"]));
    expect(readCollapsedSections(KEY)).toEqual({});

    globalThis.localStorage.setItem(KEY, JSON.stringify({ group: "true", direct: true }));
    expect(readCollapsedSections(KEY)).toEqual({ direct: true });
  });

  it("localStorage NÉM (chế độ riêng tư) chỉ mất tuỳ chọn, KHÔNG làm vỡ danh sách", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(readCollapsedSections(KEY)).toEqual({});
    expect(() => writeCollapsedSections(KEY, { group: true })).not.toThrow();
  });
});
