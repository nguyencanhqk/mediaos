/**
 * S20-CHAT-UNREADNAV-1 — hàm THUẦN của «Đánh dấu đã đọc» / «Đọc hết» (US-CHAT-NV-05).
 */
import { describe, expect, it } from "vitest";
import type { ChatRoomDto } from "@mediaos/contracts";
import {
  READ_ALL_CONCURRENCY,
  markReadTargetOf,
  optimisticReadRoom,
  restoreUnreadRoom,
  runWithConcurrency,
} from "./chat-unread-batch";

function room(over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: "Phòng thử",
    roomCode: "CHAT-0001",
    description: null,
    lastMessageAt: "2026-08-04T10:00:00.000Z",
    lastMessageSeq: 12,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

describe("markReadTargetOf", () => {
  it("trả lastMessageSeq THẬT khi phòng trông chưa đọc", () => {
    expect(markReadTargetOf(room({ unreadCount: 3, lastMessageSeq: 41 }))).toBe(41);
    expect(markReadTargetOf(room({ markedUnreadAt: "2026-08-04T10:00:00Z" }))).toBe(12);
    // Phòng rỗng đánh dấu tay: seq 0 hợp lệ (server chỉ gỡ cờ, con trỏ không lùi).
    expect(
      markReadTargetOf(room({ lastMessageSeq: 0, markedUnreadAt: "2026-08-04T10:00:00Z" })),
    ).toBe(0);
  });

  it("đã đọc hết, hoặc không có số thật (server cũ / số rác) ⇒ null", () => {
    expect(markReadTargetOf(room())).toBeNull();
    expect(markReadTargetOf(room({ unreadCount: 2, lastMessageSeq: undefined }))).toBeNull();
    expect(markReadTargetOf(room({ unreadCount: 2, lastMessageSeq: 1.5 }))).toBeNull();
    expect(markReadTargetOf(room({ unreadCount: 2, lastMessageSeq: -1 }))).toBeNull();
  });
});

describe("runWithConcurrency", () => {
  it(`giữ đúng thứ tự kết quả và không vượt trần ${READ_ALL_CONCURRENCY}`, async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 9 }, (_, i) => i);
    const results = await runWithConcurrency(items, READ_ALL_CONCURRENCY, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, (9 - n) % 3));
      inFlight -= 1;
      if (n === 4) throw new Error("hỏng");
      return n * 10;
    });
    expect(peak).toBe(READ_ALL_CONCURRENCY);
    expect(results).toHaveLength(9);
    expect(results[0]).toEqual({ ok: true, value: 0 });
    expect(results[4].ok).toBe(false);
    expect(results[8]).toEqual({ ok: true, value: 80 });
  });

  it("danh sách rỗng ⇒ mảng rỗng, không treo", async () => {
    await expect(runWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
  });
});

describe("optimisticReadRoom / restoreUnreadRoom", () => {
  it("lạc quan: badge, số @ và cờ đánh dấu tay về 0/null", () => {
    const next = optimisticReadRoom(
      room({ unreadCount: 5, mentionUnreadCount: 2, markedUnreadAt: "2026-08-04T10:00:00Z" }),
    );
    expect(next.unreadCount).toBe(0);
    expect(next.mentionUnreadCount).toBe(0);
    expect(next.markedUnreadAt).toBeNull();
  });

  it("server cũ không có số @ ⇒ không bịa khoá", () => {
    expect(optimisticReadRoom(room({ unreadCount: 5 })).mentionUnreadCount).toBeUndefined();
  });

  it("hoàn nguyên giữ cả tin tới TRONG LÚC lời gọi bay (không xoá chúng bằng ảnh chụp cũ)", () => {
    const before = room({
      unreadCount: 5,
      lastMessageSeq: 20,
      mentionUnreadCount: 1,
      markedUnreadAt: "2026-08-04T10:00:00Z",
    });
    // Lạc quan về 0, rồi WS cộng 2 tin mới (một tin nhắc tôi).
    const current = {
      ...optimisticReadRoom(before),
      unreadCount: 2,
      lastMessageSeq: 22,
      mentionUnreadCount: 1,
    };
    const restored = restoreUnreadRoom(before, current);
    expect(restored.unreadCount).toBe(7);
    expect(restored.mentionUnreadCount).toBe(2);
    expect(restored.markedUnreadAt).toBe("2026-08-04T10:00:00Z");
    expect(restored.lastMessageSeq).toBe(22);
  });
});
