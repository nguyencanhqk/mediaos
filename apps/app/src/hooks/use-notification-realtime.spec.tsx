// @vitest-environment jsdom
/**
 * S20-NOTI-LIVETOAST-1 — `useNotificationRealtime`: gate quyền, vòng đời handler (KHÔNG ngắt socket chat),
 * toast «Mở», tuỳ chọn, đích chat không toast (một nguồn), phiên hết hạn, nhịp poll.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { notificationKeys, useAuthStore } from "@mediaos/web-core";
import { WS_EVENTS } from "@mediaos/contracts";
import { writeToastPrefs, resetToastPrefsMemory } from "@/lib/toast-prefs";
import { makeFakeSocket, type FakeSocket } from "./test-fake-socket";
import { useNotificationRealtime } from "./use-notification-realtime";
import {
  UNREAD_POLL_CONNECTED_MS,
  UNREAD_POLL_DISCONNECTED_MS,
  useNotificationSocketState,
  useUnreadPollInterval,
} from "./use-notification-realtime-state";

const getAppSocket = vi.fn();
const dropdown = vi.fn();
const toastSuccess = vi.fn();
const openTarget = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    getAppSocket: () => getAppSocket(),
    myNotificationApi: { dropdown: (...a: unknown[]) => dropdown(...a) },
  };
});
vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    toast: { success: (...a: unknown[]) => toastSuccess(...a), dismiss: vi.fn() },
  };
});
vi.mock("@/components/notifications/NotificationTargetLink", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/notifications/NotificationTargetLink")>();
  return { ...actual, useOpenNotificationTarget: () => openTarget };
});

const NID = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";
const TASK_URL = "/tasks/33333333-3333-4333-8333-333333333333";
const wsPayload = (id = NID) => ({
  id,
  companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  type: "general",
  refId: null,
  refType: null,
  body: "nội dung",
  isRead: false,
  createdAt: "2026-11-09T01:00:00.000Z",
});
const item = (over: Record<string, unknown> = {}) => ({
  notification_id: NID,
  title: "Bạn được giao: Soạn báo cáo",
  short_content: "x",
  notification_type: "Task",
  priority: "Normal",
  status: "Unread",
  is_read: false,
  target_url: TASK_URL,
  created_at: "2026-11-09T01:00:00.000Z",
  ...over,
});

let socket: FakeSocket;
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

function setAuth(caps: Record<string, boolean>, userId = "u1") {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: userId, email: "t@x.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

beforeEach(() => {
  socket = makeFakeSocket();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  getAppSocket.mockReturnValue(socket);
  dropdown.mockResolvedValue({ unread_count: 1, items: [item()] });
  setAuth({ "read:notification": true });
});
afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetToastPrefsMemory();
  useNotificationSocketState.setState({ connected: false });
  useAuthStore.setState({ isAuthenticated: false, user: null, capabilities: {} });
});

type ToastCall = [string, { action?: { label: string; onClick: () => void } }];

describe("useNotificationRealtime", () => {
  it("thiếu read:notification ⇒ không gắn handler nào", () => {
    setAuth({});
    renderHook(() => useNotificationRealtime(), { wrapper });
    expect(socket.totalHandlers()).toBe(0);
  });

  it("notification:new ⇒ invalidate chuông + toast tiêu đề kèm «Mở» mở đúng đích", async () => {
    const spy = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useNotificationRealtime(), { wrapper });
    act(() => socket.fire(WS_EVENTS.NOTIFICATION_NEW, wsPayload()));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(notificationKeys.unreadCount()));
    const [message, opts] = toastSuccess.mock.calls[0] as ToastCall;
    expect(message).toBe("Bạn được giao: Soạn báo cáo");
    expect(opts.action?.label).toBe("Mở");
    opts.action?.onClick();
    expect(openTarget).toHaveBeenCalledWith(TASK_URL);
  });

  it("target_url rỗng hoặc không an toàn ⇒ toast KHÔNG có «Mở»", async () => {
    for (const target of [null, "https://evil.example/x", "//evil.example"]) {
      toastSuccess.mockClear();
      dropdown.mockResolvedValue({ unread_count: 1, items: [item({ target_url: target })] });
      const { unmount } = renderHook(() => useNotificationRealtime(), { wrapper });
      act(() => socket.fire(WS_EVENTS.NOTIFICATION_NEW, wsPayload()));
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
      expect((toastSuccess.mock.calls[0] as ToastCall)[1].action).toBeUndefined();
      unmount();
    }
  });

  it("đích phòng chat ⇒ KHÔNG toast thông báo (toast tin nhắn là nguồn duy nhất)", async () => {
    dropdown.mockResolvedValue({ unread_count: 1, items: [item({ target_url: `/chat/${ROOM}` })] });
    renderHook(() => useNotificationRealtime(), { wrapper });
    act(() => socket.fire(WS_EVENTS.NOTIFICATION_NEW, wsPayload()));
    await waitFor(() => expect(dropdown).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("tắt «Hiện toast thông báo» ⇒ không toast, không gọi API dòng; chuông vẫn làm mới", async () => {
    writeToastPrefs("u1", { notifications: false });
    const spy = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useNotificationRealtime(), { wrapper });
    act(() => socket.fire(WS_EVENTS.NOTIFICATION_NEW, wsPayload()));
    await act(async () => {
      await Promise.resolve();
    });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(dropdown).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
  });

  it("tuỳ chọn của người khác trên cùng máy không áp cho mình", async () => {
    writeToastPrefs("u2", { notifications: false });
    renderHook(() => useNotificationRealtime(), { wrapper });
    act(() => socket.fire(WS_EVENTS.NOTIFICATION_NEW, wsPayload()));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
  });

  it("payload sai hợp đồng ⇒ không toast, cảnh báo đúng MỘT lần, không console.error", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderHook(() => useNotificationRealtime(), { wrapper });
    act(() => {
      socket.fire(WS_EVENTS.NOTIFICATION_NEW, { rac: 1 });
      socket.fire(WS_EVENTS.NOTIFICATION_NEW, { rac: 2 });
    });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(err).not.toHaveBeenCalled();
    warn.mockRestore();
    err.mockRestore();
  });

  it("lấy dòng thông báo lỗi ⇒ không toast, không ném", async () => {
    dropdown.mockRejectedValue(new Error("mạng"));
    renderHook(() => useNotificationRealtime(), { wrapper });
    act(() => socket.fire(WS_EVENTS.NOTIFICATION_NEW, wsPayload()));
    await waitFor(() => expect(dropdown).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("phiên hết hạn giữa chừng ⇒ không còn toast", async () => {
    let release: (v: unknown) => void = () => undefined;
    dropdown.mockReturnValue(new Promise((r) => (release = r)));
    renderHook(() => useNotificationRealtime(), { wrapper });
    act(() => socket.fire(WS_EVENTS.NOTIFICATION_NEW, wsPayload()));
    act(() => useAuthStore.setState({ isAuthenticated: false }));
    await act(async () => release({ unread_count: 1, items: [item()] }));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("unmount gỡ ĐÚNG handler của mình, không disconnect, không đụng reconnection của socket chat", () => {
    const chatHandler = vi.fn();
    socket.on(WS_EVENTS.CHAT_MESSAGE, chatHandler);
    const { unmount } = renderHook(() => useNotificationRealtime(), { wrapper });
    expect(socket.countFor(WS_EVENTS.NOTIFICATION_NEW)).toBe(1);
    unmount();
    expect(socket.countFor(WS_EVENTS.NOTIFICATION_NEW)).toBe(0);
    expect(socket.countFor(WS_EVENTS.CHAT_MESSAGE)).toBe(1);
    expect(socket.totalHandlers()).toBe(1);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.io.reconnection).not.toHaveBeenCalled();
  });

  it("nhịp poll: 120 giây khi socket nối, 30 giây khi mất", () => {
    socket.connected = true;
    const both = renderHook(
      () => {
        useNotificationRealtime();
        return useUnreadPollInterval();
      },
      { wrapper },
    );
    expect(both.result.current).toBe(UNREAD_POLL_CONNECTED_MS);
    act(() => socket.fire("disconnect"));
    expect(both.result.current).toBe(UNREAD_POLL_DISCONNECTED_MS);
    act(() => socket.fire("connect"));
    expect(both.result.current).toBe(UNREAD_POLL_CONNECTED_MS);
    both.unmount();
    expect(useNotificationSocketState.getState().connected).toBe(false);
  });
});
