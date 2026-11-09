// @vitest-environment jsdom
/**
 * S20-NOTI-LIVETOAST-1 — `useChatToast`: DM / @nhắc tôi ⇒ MỘT toast «Trả lời»; tin nhóm không nhắc chỉ tăng
 * badge; phòng tắt tiếng / đang mở / tin của mình / thu hồi; gộp 15 giây; xem trước chỉ khi bật.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAuthStore } from "@mediaos/web-core";
import { WS_EVENTS, type ChatRoomDto } from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";
import { useChatDockStore } from "@/components/chat/chat-dock.store";
import { writeToastPrefs, resetToastPrefsMemory } from "@/lib/toast-prefs";
import { makeFakeSocket, type FakeSocket } from "./test-fake-socket";
import { CHAT_TOAST_MERGE_MS, useChatToast } from "./use-chat-toast";

const getAppSocket = vi.fn();
const toastSuccess = vi.fn();
const toastDismiss = vi.fn();
const toastIsActive = vi.fn();
const openChatRoom = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, getAppSocket: () => getAppSocket() };
});
vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    toast: {
      success: (...a: unknown[]) => toastSuccess(...a),
      dismiss: (...a: unknown[]) => toastDismiss(...a),
      isActive: (...a: unknown[]) => toastIsActive(...a),
    },
  };
});
vi.mock("@/components/notifications/use-chat-room-link-opener", () => ({
  useChatRoomLinkOpener: () => openChatRoom,
}));

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPANY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const GROUP = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const room = (id: string, over: Partial<ChatRoomDto> = {}): ChatRoomDto => ({
  id,
  companyId: COMPANY,
  refId: null,
  roomType: "group",
  name: "Nhóm Kinh doanh",
  roomCode: id,
  createdAt: "2026-08-01T00:00:00.000Z",
  unreadCount: 0,
  ...over,
});

let seq = 0;
const msg = (roomId: string, over: Record<string, unknown> = {}) => {
  seq += 1;
  return {
    id: `0000000${seq}-1111-4111-8111-111111111111`,
    companyId: COMPANY,
    roomId,
    senderId: OTHER,
    senderName: "Lan",
    body: "Họp 3 giờ nhé",
    messageType: "text",
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    roomSeq: seq,
    createdAt: "2026-11-09T01:00:00.000Z",
    ...over,
  };
};

let socket: FakeSocket;
const fire = (m: unknown) => act(() => socket.fire(WS_EVENTS.CHAT_MESSAGE, m));
const lastToast = () =>
  toastSuccess.mock.calls.at(-1) as [
    string,
    { key: string; action: { label: string; onClick: () => void } },
  ];

beforeEach(() => {
  seq = 0;
  socket = makeFakeSocket();
  getAppSocket.mockReturnValue(socket);
  toastIsActive.mockReturnValue(true);
  toastSuccess.mockImplementation(() => `toast-${toastSuccess.mock.calls.length}`);
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: { "view:chat-room": true },
    user: { id: ME, email: "t@x.local", fullName: "T", status: "Active", companyId: "co1" },
  });
  useChatStore.setState({
    roomsById: { [DM]: room(DM, { roomType: "direct", name: null }), [GROUP]: room(GROUP) },
  });
  useChatDockStore.setState({ isOpen: false, openRoomIds: [] });
  window.history.pushState({}, "", "/home");
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  window.localStorage.clear();
  resetToastPrefsMemory();
  useAuthStore.setState({ isAuthenticated: false, user: null, capabilities: {} });
});

describe("useChatToast", () => {
  it("thiếu view:chat-room ⇒ không gắn handler", () => {
    useAuthStore.setState({ capabilities: {} });
    renderHook(() => useChatToast());
    expect(socket.totalHandlers()).toBe(0);
  });

  it("DM ⇒ MỘT toast «Trả lời»; mặc định KHÔNG có thân tin; «Trả lời» mở đúng phòng", () => {
    renderHook(() => useChatToast());
    fire(msg(DM));
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    const [text, opts] = lastToast();
    expect(text).toBe("Lan vừa nhắn cho bạn");
    expect(text).not.toContain("Họp 3 giờ");
    expect(opts.action.label).toBe("Trả lời");
    opts.action.onClick();
    expect(openChatRoom).toHaveBeenCalledWith({ roomId: DM, messageId: null });
  });

  it("bật «Xem trước nội dung» ⇒ toast có thân tin từ payload đã nhận", () => {
    writeToastPrefs(ME, { preview: true });
    renderHook(() => useChatToast());
    fire(msg(DM));
    expect(lastToast()[0]).toBe("Lan: Họp 3 giờ nhé");
  });

  it("tin nhóm nhắc tôi ⇒ toast kèm tên phòng; không nhắc tôi ⇒ KHÔNG toast", () => {
    renderHook(() => useChatToast());
    fire(msg(GROUP));
    expect(toastSuccess).not.toHaveBeenCalled();
    fire(msg(GROUP, { mentions: [ME] }));
    expect(lastToast()[0]).toBe("Lan nhắc bạn trong Nhóm Kinh doanh");
  });

  it("phòng tắt tiếng ⇒ không toast; hết hạn tắt tiếng ⇒ lại toast", () => {
    useChatStore.setState({
      roomsById: {
        [DM]: room(DM, { roomType: "direct", name: null, mutedUntil: "2999-01-01T00:00:00.000Z" }),
      },
    });
    renderHook(() => useChatToast());
    fire(msg(DM));
    expect(toastSuccess).not.toHaveBeenCalled();
    useChatStore.setState({
      roomsById: {
        [DM]: room(DM, { roomType: "direct", name: null, mutedUntil: "2020-01-01T00:00:00.000Z" }),
      },
    });
    fire(msg(DM));
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("đang mở đúng phòng (trang hoặc drawer) ⇒ không toast; phòng khác vẫn toast", () => {
    renderHook(() => useChatToast());
    window.history.pushState({}, "", `/chat/${DM}`);
    fire(msg(DM));
    expect(toastSuccess).not.toHaveBeenCalled();
    window.history.pushState({}, "", "/home");
    useChatDockStore.setState({ isOpen: true, openRoomIds: [DM] });
    fire(msg(DM));
    expect(toastSuccess).not.toHaveBeenCalled();
    useChatDockStore.setState({ isOpen: false, openRoomIds: [DM] }); // đóng drawer ⇒ không còn "đang xem"
    fire(msg(DM));
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("tin của chính mình, tin thu hồi, tin hệ thống ⇒ không toast", () => {
    renderHook(() => useChatToast());
    fire(msg(DM, { senderId: ME }));
    fire(msg(DM, { recalledAt: "2026-11-09T01:00:01.000Z", body: null }));
    fire(msg(DM, { messageType: "system" }));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("tắt «Toast tin nhắn» ⇒ không toast; payload méo ⇒ bỏ qua không ném", () => {
    writeToastPrefs(ME, { messages: false });
    renderHook(() => useChatToast());
    fire(msg(DM));
    fire({ rac: true });
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("gộp cùng phòng trong 15 giây: thay toast cũ bằng «N tin nhắn mới»; quá 15 giây ⇒ đếm lại", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T01:00:00.000Z"));
    renderHook(() => useChatToast());
    fire(msg(DM));
    vi.advanceTimersByTime(CHAT_TOAST_MERGE_MS - 1_000);
    fire(msg(DM));
    expect(lastToast()[0]).toBe("2 tin nhắn mới từ Lan");
    expect(toastDismiss).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CHAT_TOAST_MERGE_MS + 1_000);
    fire(msg(DM));
    expect(lastToast()[0]).toBe("Lan vừa nhắn cho bạn");
  });

  it("tin thu hồi ⇒ gỡ toast của chính tin đó", () => {
    renderHook(() => useChatToast());
    const m = msg(DM);
    fire(m);
    act(() =>
      socket.fire(WS_EVENTS.CHAT_MESSAGE_RECALLED, {
        messageId: m.id,
        roomId: DM,
        recalledAt: "2026-11-09T01:00:05.000Z",
      }),
    );
    expect(toastDismiss).toHaveBeenCalledWith("toast-1");
  });

  it("thu hồi một tin trong toast gộp ⇒ dựng lại toast với số đếm mới, về dạng đơn khi còn 1", () => {
    renderHook(() => useChatToast());
    const [m1, m2, m3] = [msg(DM), msg(DM), msg(DM)];
    [m1, m2, m3].forEach(fire);
    expect(lastToast()[0]).toBe("3 tin nhắn mới từ Lan");
    const recall = (id: string) =>
      act(() =>
        socket.fire(WS_EVENTS.CHAT_MESSAGE_RECALLED, {
          messageId: id,
          roomId: DM,
          recalledAt: "2026-11-09T01:00:05.000Z",
        }),
      );
    recall(m2.id);
    expect(lastToast()[0]).toBe("2 tin nhắn mới từ Lan");
    recall(m3.id);
    expect(lastToast()[0]).toBe("Lan vừa nhắn cho bạn");
    expect(toastDismiss).toHaveBeenLastCalledWith(`toast-${toastSuccess.mock.calls.length - 1}`);
  });

  it("thu hồi khi toast đã tự tắt ⇒ KHÔNG dựng lại toast", () => {
    renderHook(() => useChatToast());
    const [m1, m2] = [msg(DM), msg(DM)];
    [m1, m2].forEach(fire);
    const before = toastSuccess.mock.calls.length;
    toastIsActive.mockReturnValue(false);
    act(() =>
      socket.fire(WS_EVENTS.CHAT_MESSAGE_RECALLED, {
        messageId: m2.id,
        roomId: DM,
        recalledAt: "2026-11-09T01:00:05.000Z",
      }),
    );
    expect(toastSuccess.mock.calls.length).toBe(before);
  });

  it("thu hồi khi phòng đang được xem ⇒ KHÔNG dựng lại toast", () => {
    renderHook(() => useChatToast());
    const [m1, m2] = [msg(DM), msg(DM)];
    [m1, m2].forEach(fire);
    const before = toastSuccess.mock.calls.length;
    window.history.pushState({}, "", `/chat/${DM}`);
    act(() =>
      socket.fire(WS_EVENTS.CHAT_MESSAGE_RECALLED, {
        messageId: m2.id,
        roomId: DM,
        recalledAt: "2026-11-09T01:00:05.000Z",
      }),
    );
    expect(toastSuccess.mock.calls.length).toBe(before);
  });

  it("unmount gỡ đúng handler của mình, không disconnect", () => {
    const { unmount } = renderHook(() => useChatToast());
    expect(socket.totalHandlers()).toBe(2);
    unmount();
    expect(socket.totalHandlers()).toBe(0);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.io.reconnection).not.toHaveBeenCalled();
  });
});
