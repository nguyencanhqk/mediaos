// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ChatRoomDto } from "@mediaos/contracts";
import { useAuthStore } from "@mediaos/web-core";
import { useChatStore } from "@/stores/chat.store";
import { totalUnreadCount } from "@/components/chat/chat-unread";
import { useUnreadTitle } from "./use-unread-title";

const room = (id: string, unread: number, over: Partial<ChatRoomDto> = {}): ChatRoomDto => ({
  id,
  companyId: "c",
  refId: null,
  roomType: "group",
  name: id,
  roomCode: id,
  createdAt: "2026-08-01T00:00:00.000Z",
  unreadCount: unread,
  ...over,
});

function setRooms(rooms: ChatRoomDto[]) {
  useChatStore.setState({ roomsById: Object.fromEntries(rooms.map((r) => [r.id, r])) });
}

beforeEach(() => {
  document.title = "MediaOS";
  useAuthStore.setState({ isAuthenticated: true, capabilities: { "access:chat": true } });
  setRooms([]);
});
afterEach(() => {
  setRooms([]);
  useAuthStore.setState({ isAuthenticated: false, capabilities: {} });
});

describe("useUnreadTitle", () => {
  it("«(N)» = totalUnreadCount của badge, kể cả phòng đã tắt tiếng", () => {
    const muted = room("m", 3, { mutedUntil: "2999-01-01T00:00:00.000Z" });
    setRooms([room("a", 2), muted]);
    renderHook(() => useUnreadTitle());
    expect(totalUnreadCount(useChatStore.getState().roomsById)).toBe(5);
    expect(document.title).toBe("(5) MediaOS");
  });

  it("về 0 ⇒ tiêu đề gốc, không «(0)»; tăng lại không chồng tiền tố", () => {
    setRooms([room("a", 2)]);
    renderHook(() => useUnreadTitle());
    expect(document.title).toBe("(2) MediaOS");
    act(() => setRooms([room("a", 7)]));
    expect(document.title).toBe("(7) MediaOS");
    act(() => setRooms([room("a", 0)]));
    expect(document.title).toBe("MediaOS");
  });

  it("có view:chat-room nhưng KHÔNG access:chat ⇒ tiêu đề gốc, không «(N)»", () => {
    useAuthStore.setState({ capabilities: { "view:chat-room": true } });
    setRooms([room("a", 2)]);
    renderHook(() => useUnreadTitle());
    expect(document.title).toBe("MediaOS");
  });

  it("phòng đã lưu trữ không tính; unmount trả tiêu đề gốc", () => {
    setRooms([room("a", 4, { isArchived: true }), room("b", 1)]);
    const { unmount } = renderHook(() => useUnreadTitle());
    expect(document.title).toBe("(1) MediaOS");
    unmount();
    expect(document.title).toBe("MediaOS");
  });
});
