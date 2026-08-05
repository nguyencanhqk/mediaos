// @vitest-environment jsdom
/**
 * use-chat-realtime.spec.tsx — vòng đời kết nối + gate quyền (S7-CHAT-FE-1 §1.5, §1.6, §R3.1, §R3.5).
 *
 * Giữ `web-core` THẬT cho `useCan`/`useAuthStore` (điều khiển gate bằng `capabilities` như
 * `AttendanceTodayWidget.spec.tsx`), CHỈ stub tầng I/O: `chatApi`, `getAppSocket`, `refreshAccessToken`.
 * Mock `useCan` bằng tay sẽ làm ca "quyền nạp muộn" (§R3.5) mất hết ý nghĩa — đó chính là ca hook này
 * phải sống sót.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { ApiError, useAuthStore } from "@mediaos/web-core";
import { WS_EVENTS } from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";
import { useChatRealtime } from "./use-chat-realtime";
import type { ChatMessageDto, ChatRoomDto } from "@mediaos/contracts";

const listRooms = vi.fn();
const getRoom = vi.fn();
const getMessages = vi.fn();
const refreshAccessToken = vi.fn();
const getAppSocket = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    chatApi: {
      listRooms: (...a: unknown[]) => listRooms(...a),
      getRoom: (...a: unknown[]) => getRoom(...a),
      getMessages: (...a: unknown[]) => getMessages(...a),
    },
    getAppSocket: () => getAppSocket(),
    refreshAccessToken: () => refreshAccessToken(),
  };
});

const ROOM_A = "11111111-1111-4111-8111-111111111111";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function room(id: string, over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id,
    companyId: COMPANY,
    refId: null,
    roomType: "group",
    name: "Phòng",
    roomCode: "RC-01",
    description: null,
    lastMessageAt: null,
    lastMessageSeq: null,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function seededMessage(seq: number): ChatMessageDto {
  return {
    id: `${String(seq).padStart(8, "0")}-1111-4111-8111-111111111111`,
    companyId: COMPANY,
    roomId: ROOM_A,
    senderId: ME,
    senderName: "T",
    body: "cũ",
    messageType: "text",
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    roomSeq: seq,
    createdAt: "2026-08-04T01:00:00.000Z",
  };
}

/** Socket giả: giữ registry handler để kiểm cả ĐĂNG KÝ lẫn GỠ, và phát sự kiện như server thật. */
function makeFakeSocket() {
  const handlers = new Map<string, Set<(...args: never[]) => void>>();
  return {
    io: { reconnection: vi.fn() },
    disconnect: vi.fn(),
    /** Mặc định CHƯA kết nối — ca "đã connected sẵn" tự ghi đè cờ này. */
    connected: false,
    on(event: string, fn: (...args: never[]) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    off(event: string, fn: (...args: never[]) => void) {
      handlers.get(event)?.delete(fn);
    },
    /** Số handler đang gắn cho một event — dùng để chứng minh KHÔNG nhân đôi và cleanup gỡ SẠCH. */
    countFor(event: string) {
      return handlers.get(event)?.size ?? 0;
    },
    totalHandlers() {
      let n = 0;
      for (const set of handlers.values()) n += set.size;
      return n;
    },
    fire(event: string, ...args: unknown[]) {
      for (const fn of [...(handlers.get(event) ?? [])]) (fn as (...a: unknown[]) => void)(...args);
    },
  };
}

type FakeSocket = ReturnType<typeof makeFakeSocket>;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function strictWrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <StrictMode>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </StrictMode>
  );
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: ME, email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

const CAN_READ = { "view:chat-room": true };
const s = () => useChatStore.getState();

let socket: FakeSocket;

beforeEach(() => {
  listRooms.mockReset().mockResolvedValue([]);
  getRoom.mockReset();
  getMessages.mockReset().mockResolvedValue([]);
  refreshAccessToken.mockReset().mockResolvedValue(true);
  socket = makeFakeSocket();
  getAppSocket.mockReset().mockReturnValue(socket);
  useChatStore.getState().resetChatStore();
  setCaps(CAN_READ);
});

afterEach(() => {
  useChatStore.getState().resetChatStore();
  vi.useRealTimers();
});

// ── cổng quyền ────────────────────────────────────────────────────────────────

describe("cổng quyền `view:chat-room`", () => {
  it("CÓ quyền → bootstrap listRooms + gắn đủ 7 listener", async () => {
    renderHook(() => useChatRealtime(), { wrapper });
    await waitFor(() => expect(listRooms).toHaveBeenCalledTimes(1));
    for (const event of [
      WS_EVENTS.CHAT_MESSAGE,
      WS_EVENTS.CHAT_MESSAGE_RECALLED,
      WS_EVENTS.CHAT_READ,
      WS_EVENTS.CHAT_ROOM,
      "connect",
      "disconnect",
      "connect_error",
    ]) {
      expect(socket.countFor(event)).toBe(1);
    }
  });

  it("KHÔNG có quyền → KHÔNG gọi listRooms, KHÔNG gắn listener nào", async () => {
    setCaps({});
    renderHook(() => useChatRealtime(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(listRooms).not.toHaveBeenCalled();
    expect(socket.totalHandlers()).toBe(0);
  });

  it("quyền nạp MUỘN (render đầu chưa có `/auth/me`) → hook KHÔNG vỡ, tự gắn khi có quyền", async () => {
    // Đây là ca §R3.5 bảo vệ: đặt `if (!canReadChat) return;` TRƯỚC các hook sẽ đổi số hook giữa hai
    // lần render và React ném "Rendered fewer hooks than expected" — trắng NGUYÊN app shell.
    setCaps({});
    const { rerender } = renderHook(() => useChatRealtime(), { wrapper });
    expect(socket.totalHandlers()).toBe(0);

    act(() => setCaps(CAN_READ));
    rerender();
    await waitFor(() => expect(listRooms).toHaveBeenCalled());
    expect(socket.countFor(WS_EVENTS.CHAT_MESSAGE)).toBe(1);
  });

  it("chưa có phiên (`getAppSocket()` trả null) → không crash, không listener", async () => {
    getAppSocket.mockReturnValue(null);
    renderHook(() => useChatRealtime(), { wrapper });
    await waitFor(() => expect(listRooms).toHaveBeenCalled());
    expect(socket.totalHandlers()).toBe(0);
  });
});

// ── vòng đời mount/unmount ────────────────────────────────────────────────────

describe("vòng đời", () => {
  it("<StrictMode> (effect chạy 2 lần) → KHÔNG nhân đôi handler nào", async () => {
    renderHook(() => useChatRealtime(), { wrapper: strictWrapper });
    await waitFor(() => expect(socket.countFor(WS_EVENTS.CHAT_MESSAGE)).toBe(1));
    expect(socket.totalHandlers()).toBe(7);
  });

  it("socket ĐÃ connected trước khi hook mount → đồng bộ ngay, KHÔNG kẹt 'connecting'", async () => {
    // Socket là singleton dùng chung: NOTI (hoặc một lần remount shell) có thể đã mở nó xong xuôi. Sự
    // kiện `connect` KHÔNG phát lại cho listener gắn sau ⇒ nếu không đọc `socket.connected` thì trạng
    // thái kẹt 'connecting' VĨNH VIỄN và lưới bù REST chạy mãi 10 giây/lần dù WS hoàn toàn khoẻ.
    const connectedSocket = { ...makeFakeSocket(), connected: true };
    getAppSocket.mockReturnValue(connectedSocket);
    renderHook(() => useChatRealtime(), { wrapper });
    await waitFor(() => expect(connectedSocket.totalHandlers()).toBe(7));
    expect(s().connectionStatus).toBe("connected");
  });

  it("socket CHƯA connected khi mount → giữ 'connecting', chờ sự kiện thật", async () => {
    renderHook(() => useChatRealtime(), { wrapper });
    await waitFor(() => expect(socket.totalHandlers()).toBe(7));
    expect(s().connectionStatus).toBe("connecting");
  });

  it("unmount HOÀN NGUYÊN auto-reconnect — không để cờ tắt nằm lại trên Manager dùng chung với NOTI", async () => {
    // Một lần `realtime_disabled` thoáng qua mà không hoàn nguyên = NOTI realtime chết theo VĨNH VIỄN
    // (tới khi tải lại tab), dù NOTI chưa bao giờ đồng ý và không có cách nào biết vì sao.
    const { unmount } = renderHook(() => useChatRealtime(), { wrapper });
    await waitFor(() => expect(socket.totalHandlers()).toBe(7));
    act(() => socket.fire("connect_error", new Error("realtime_disabled")));
    expect(socket.io.reconnection).toHaveBeenCalledWith(false);
    unmount();
    expect(socket.io.reconnection).toHaveBeenLastCalledWith(true);
  });

  it("unmount gỡ SẠCH 7 handler và TUYỆT ĐỐI KHÔNG disconnect (socket dùng chung với NOTI)", async () => {
    const { unmount } = renderHook(() => useChatRealtime(), { wrapper });
    await waitFor(() => expect(socket.totalHandlers()).toBe(7));
    unmount();
    expect(socket.totalHandlers()).toBe(0);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});

// ── máy trạng thái kết nối (§1.6) ─────────────────────────────────────────────

describe("máy trạng thái kết nối", () => {
  beforeEach(async () => {
    renderHook(() => useChatRealtime(), { wrapper });
    await waitFor(() => expect(socket.totalHandlers()).toBe(7));
  });

  it("`realtime_disabled` → polling-fallback VÀ tắt auto-reconnect (server fail-closed có chủ đích)", () => {
    act(() => socket.fire("connect_error", new Error("realtime_disabled")));
    expect(s().connectionStatus).toBe("polling-fallback");
    expect(socket.io.reconnection).toHaveBeenCalledWith(false);
  });

  it("`unauthorized` → refresh token ĐÚNG 1 lần, KHÔNG rơi vào polling-fallback", () => {
    act(() => socket.fire("connect_error", new Error("unauthorized")));
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(s().connectionStatus).not.toBe("polling-fallback");
    expect(socket.io.reconnection).not.toHaveBeenCalled();
  });

  it("lỗi KHÔNG nhận diện được (`xhr poll error`) → disconnected, GIỮ auto-reconnect", () => {
    // Nhánh mặc định: đây là đường chạy khi CORS/proxy chặn handshake. Thiếu nó thì app kẹt
    // 'connecting' VÔ THỜI HẠN và lưới bù (`connectionStatus !== 'connected'`) không bao giờ nổ.
    act(() => socket.fire("connect_error", new Error("xhr poll error")));
    expect(s().connectionStatus).toBe("disconnected");
    expect(socket.io.reconnection).not.toHaveBeenCalled();
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("`disconnect` khi đang connected → disconnected (không kẹt 'connected' sai sự thật)", () => {
    act(() => socket.fire("connect"));
    expect(s().connectionStatus).toBe("connected");
    act(() => socket.fire("disconnect", "transport close"));
    expect(s().connectionStatus).toBe("disconnected");
  });

  it("`connect` LẦN ĐẦU (từ 'connecting') → connected, KHÔNG bù thừa (listRooms vừa bootstrap)", () => {
    listRooms.mockClear();
    act(() => socket.fire("connect"));
    expect(s().connectionStatus).toBe("connected");
    expect(getMessages).not.toHaveBeenCalled();
    expect(listRooms).not.toHaveBeenCalled();
  });

  it("reconnect từ 'disconnected' → bù NGAY tại t=0 (không đợi nhịp 10 giây) + refetch danh sách phòng", async () => {
    // CỐ Ý dùng đồng hồ THẬT: khẳng định "ngay tại t=0" mạnh hơn khi KHÔNG có fake timer nào để nhích.
    // `getMessages` phải đã được gọi ngay trong lượt đồng bộ của handler `connect`.
    act(() => {
      s().hydrateRooms([room(ROOM_A, { lastMessageSeq: 9 })]);
      s().subscribeToRoom(ROOM_A);
      s().applyIncomingMessage(seededMessage(9));
      s().setConnectionStatus("disconnected");
    });
    listRooms.mockClear();
    getMessages.mockClear();

    act(() => socket.fire("connect"));

    expect(getMessages).toHaveBeenCalledWith(ROOM_A, { afterSeq: 9 });
    expect(s().connectionStatus).toBe("connected");
    await waitFor(() => expect(listRooms).toHaveBeenCalled());
  });

  it("reconnect KHÔNG bù cho phòng không theo dõi (chỉ subscribedRoomIds mới tốn round-trip)", () => {
    act(() => {
      s().hydrateRooms([room(ROOM_A)]);
      s().setConnectionStatus("disconnected");
    });
    getMessages.mockClear();
    act(() => socket.fire("connect"));
    expect(getMessages).not.toHaveBeenCalled();
  });
});

// ── payload méo + chat:room ───────────────────────────────────────────────────

describe("kiểm hình dạng payload trước khi merge", () => {
  beforeEach(async () => {
    renderHook(() => useChatRealtime(), { wrapper });
    await waitFor(() => expect(socket.totalHandlers()).toBe(7));
    // ⚠️ PHẢI đợi lượt đồng bộ danh sách ĐẦU TIÊN xong trước khi test gieo phòng vào store.
    // `syncRoomList` GỠ phòng vắng mặt trong payload (mock trả `[]`), nên nếu nó chạy sau lúc gieo thì
    // phòng vừa gieo bị dọn — test đỏ vì lý do KHÔNG liên quan tới điều đang kiểm.
    await waitFor(() => expect(listRooms).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
  });

  it.each([
    [WS_EVENTS.CHAT_MESSAGE, { id: "không-phải-uuid" }],
    [WS_EVENTS.CHAT_MESSAGE_RECALLED, { messageId: 123 }],
    [WS_EVENTS.CHAT_READ, { roomId: ROOM_A, userId: ME, lastReadSeq: "mười" }],
    [WS_EVENTS.CHAT_ROOM, { roomId: ROOM_A, action: "nuked" }],
  ])("payload méo trên kênh %s → bỏ qua, store KHÔNG đổi, KHÔNG throw", (event, payload) => {
    const before = { rooms: s().roomsById, messages: s().messagesByRoom };
    expect(() => act(() => socket.fire(event, payload))).not.toThrow();
    expect(s().roomsById).toBe(before.rooms);
    expect(s().messagesByRoom).toBe(before.messages);
  });

  it("`chat:room` member_removed + getRoom 404 → CHÍNH MÌNH bị gỡ ⇒ dọn phòng khỏi store", async () => {
    act(() => s().hydrateRooms([room(ROOM_A)]));
    getRoom.mockRejectedValue(new ApiError(404, "CHAT-ERR-001", "not found"));

    act(() => socket.fire(WS_EVENTS.CHAT_ROOM, { roomId: ROOM_A, action: "member_removed" }));

    expect(getRoom).toHaveBeenCalledWith(ROOM_A);
    await waitFor(() => expect(s().roomsById[ROOM_A]).toBeUndefined());
  });

  it("`chat:room` member_removed + getRoom 500 → GIỮ NGUYÊN phòng (không xoá vì server hắt hơi)", async () => {
    act(() => s().hydrateRooms([room(ROOM_A, { unreadCount: 4 })]));
    getRoom.mockRejectedValue(new ApiError(500, "INTERNAL", "boom"));

    act(() => socket.fire(WS_EVENTS.CHAT_ROOM, { roomId: ROOM_A, action: "member_removed" }));

    await waitFor(() => expect(getRoom).toHaveBeenCalled());
    expect(s().roomsById[ROOM_A]).toBeDefined();
    expect(s().roomsById[ROOM_A].unreadCount).toBe(4); // lịch sử hiển thị còn nguyên
  });

  it("`chat:room` member_added phòng lạ + getRoom 200 → hydrate, và KHÔNG cache members[]", async () => {
    getRoom.mockResolvedValue({
      ...room(ROOM_A, { name: "Phòng mới" }),
      myRole: "member",
      members: [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          roomId: ROOM_A,
          userId: ME,
          role: "member",
          joinedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    });

    act(() => socket.fire(WS_EVENTS.CHAT_ROOM, { roomId: ROOM_A, action: "member_added" }));

    await waitFor(() => expect(s().roomsById[ROOM_A]).toBeDefined());
    expect(s().roomsById[ROOM_A].name).toBe("Phòng mới");
    expect(s().roomsById[ROOM_A]).not.toHaveProperty("members");
    expect(s().roomsById[ROOM_A]).not.toHaveProperty("myRole");
  });

  it("`chat:room` created THIẾU `room` (lệch hợp đồng RT-1) → refetch CẢ danh sách, không đoán", async () => {
    // Nhánh fail-soft `refetch-rooms`: RT-1 hứa điền `room` cho action `created`. Nếu một ngày nó không
    // điền nữa, FE KHÔNG được bịa một phòng rỗng — phải đi hỏi lại toàn bộ danh sách.
    listRooms.mockClear();
    act(() => socket.fire(WS_EVENTS.CHAT_ROOM, { roomId: ROOM_A, action: "created" }));
    await waitFor(() => expect(listRooms).toHaveBeenCalled());
    expect(getRoom).not.toHaveBeenCalled();
  });

  it("`chat:room` member_added phòng ĐÃ có → KHÔNG gọi getRoom (không đẻ round-trip thừa)", () => {
    act(() => s().hydrateRooms([room(ROOM_A)]));
    act(() => socket.fire(WS_EVENTS.CHAT_ROOM, { roomId: ROOM_A, action: "member_added" }));
    expect(getRoom).not.toHaveBeenCalled();
  });
});
