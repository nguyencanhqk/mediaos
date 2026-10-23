// @vitest-environment jsdom
/**
 * NotificationTargetLink tests (S4-FE-NOTI-1) — deep link AN TOÀN, KHÔNG bỏ route guard.
 * Phủ: target_url nội bộ ("/...") → render button, click → onBeforeNavigate() + navigate({to}) ĐÚNG 1 lần.
 * target_url null/rỗng/tuyệt đối/protocol-relative → KHÔNG render button (render span trần, không click được).
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

import { useAuthStore } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import { useChatStore } from "@/stores/chat.store";
import { useChatDockStore } from "@/components/chat/chat-dock.store";
import { NotificationTargetLink, isSafeInternalTarget } from "./NotificationTargetLink";

beforeEach(() => {
  mockNavigate.mockReset();
});

describe("isSafeInternalTarget — whitelist đường dẫn nội bộ", () => {
  it.each([
    ["/leave/me/requests/req-1", true],
    ["/hr/employees/emp-1", true],
    ["/", true],
    [null, false],
    [undefined, false],
    ["", false],
    ["http://evil.example.com/phish", false],
    ["https://evil.example.com", false],
    ["//evil.example.com", false],
    ["javascript:alert(1)", false],
  ])("isSafeInternalTarget(%s) → %s", (input, expected) => {
    expect(isSafeInternalTarget(input as string | null | undefined)).toBe(expected);
  });
});

describe("NotificationTargetLink — render", () => {
  it("target_url nội bộ → render <button>, click → onBeforeNavigate() rồi navigate({to: target_url})", () => {
    const onBeforeNavigate = vi.fn();
    render(
      <NotificationTargetLink
        targetUrl="/leave/me/requests/req-1"
        onBeforeNavigate={onBeforeNavigate}
      >
        Xem đơn nghỉ
      </NotificationTargetLink>,
    );
    const button = screen.getByRole("button", { name: "Xem đơn nghỉ" });
    fireEvent.click(button);
    expect(onBeforeNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/leave/me/requests/req-1" }),
    );
  });

  it("target_url null → KHÔNG render button (render span, click không điều hướng)", () => {
    render(<NotificationTargetLink targetUrl={null}>Không có liên kết</NotificationTargetLink>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Không có liên kết")).toBeTruthy();
  });

  it("target_url tuyệt đối (http://) → KHÔNG render button (chặn open-redirect)", () => {
    render(
      <NotificationTargetLink targetUrl="http://evil.example.com/phish">
        Nội dung
      </NotificationTargetLink>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("target_url protocol-relative (//host) → KHÔNG render button", () => {
    render(
      <NotificationTargetLink targetUrl="//evil.example.com">Nội dung</NotificationTargetLink>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

// S20-TASK-DRAWER-1 — đích `/tasks/<uuid>` mở drawer việc TẠI CHỖ (thêm `?task=` vào URL hiện tại),
// không rời trang đang đứng (vd /goals/G ⇒ /goals/G?task=T).
describe("NotificationTargetLink — đích việc mở drawer tại chỗ", () => {
  const TASK_UUID = "0b9f6a4e-2c1d-4e8f-9a7b-3c5d6e7f8a9b";

  it("/tasks/<uuid> ⇒ onBeforeNavigate rồi PUSH ?task=<uuid> trên đường hiện tại, giữ tham số khác", () => {
    const onBeforeNavigate = vi.fn();
    render(
      <NotificationTargetLink targetUrl={`/tasks/${TASK_UUID}`} onBeforeNavigate={onBeforeNavigate}>
        Việc được giao
      </NotificationTargetLink>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Việc được giao" }));

    expect(onBeforeNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const arg = mockNavigate.mock.calls[0]?.[0] as {
      to: string;
      replace?: boolean;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(arg.to).toBe(".");
    expect(arg.replace).not.toBe(true);
    expect(arg.search({ tab: "tasks" })).toEqual({ tab: "tasks", task: TASK_UUID });
  });

  it.each([["/tasks/my-tasks"], ["/tasks/overdue"], ["/tasks/not-a-uuid"], ["/tasks/projects/p1"]])(
    "%s ⇒ điều hướng như cũ (không phải đích một việc)",
    (target) => {
      render(<NotificationTargetLink targetUrl={target}>Mở</NotificationTargetLink>);
      fireEvent.click(screen.getByRole("button", { name: "Mở" }));
      expect(mockNavigate).toHaveBeenCalledWith({ to: target });
    },
  );
});

// S20-NOTI-LISTNAV-1 — trang Thông báo: đích rỗng/không an toàn ⇒ caller tự lo (trang chi tiết như cũ).
// Kiểm an toàn VẪN chỉ nằm ở `isSafeInternalTarget` — `onUnsafeTarget` chỉ nhận lượt bấm khi đích bị loại.
describe("NotificationTargetLink — onUnsafeTarget (đích bị loại ⇒ đường lui của caller)", () => {
  it.each([
    [null],
    [""],
    ["https://evil.example.com/phish"],
    ["//evil.example.com"],
    ["javascript:alert(1)"],
  ])(
    "target_url %s ⇒ button gọi onUnsafeTarget, KHÔNG navigate, KHÔNG onBeforeNavigate",
    (target) => {
      const onUnsafeTarget = vi.fn();
      const onBeforeNavigate = vi.fn();
      render(
        <NotificationTargetLink
          targetUrl={target}
          onBeforeNavigate={onBeforeNavigate}
          onUnsafeTarget={onUnsafeTarget}
        >
          Thông báo hệ thống
        </NotificationTargetLink>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Thông báo hệ thống" }));
      expect(onUnsafeTarget).toHaveBeenCalledTimes(1);
      expect(onBeforeNavigate).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    },
  );

  it("đích an toàn ⇒ onUnsafeTarget KHÔNG được gọi, điều hướng như cũ", () => {
    const onUnsafeTarget = vi.fn();
    render(
      <NotificationTargetLink targetUrl="/hr/employees/emp-1" onUnsafeTarget={onUnsafeTarget}>
        Hồ sơ
      </NotificationTargetLink>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hồ sơ" }));
    expect(onUnsafeTarget).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/hr/employees/emp-1" });
  });
});

// S20-CHAT-DEEPLINK-1 (US-CHAT-NV-01) — đích `/chat/<uuid>`: ở trang khác ⇒ drawer mở phòng TẠI CHỖ
// (URL trang không đổi); ở `/chat*` ⇒ `/chat/R` bằng `replace`. Phòng chưa xác nhận có trong danh sách
// phòng của tôi ⇒ MỘT thông điệp chung, 0 lời gọi API của phòng đó, drawer không mở.
describe("NotificationTargetLink — đích phòng chat", () => {
  const ROOM = "1f2e3d4c-5b6a-4789-8abc-def012345678";
  const OTHER = "2a3b4c5d-6e7f-4801-9abc-def012345679";
  const SECRET_NAME = "Phòng kín dự án X";
  let fetchSpy: MockInstance<typeof fetch>;
  let toastError: MockInstance<typeof toast.error>;

  function chatRoom(id: string, name: string) {
    return {
      id,
      companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      refId: null,
      roomType: "group" as const,
      name,
      roomCode: "CHAT-0001",
      description: null,
      lastMessageAt: null,
      lastMessageSeq: 0,
      isArchived: false,
      unreadCount: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
    };
  }

  function clickChatNotification(target: string, onBeforeNavigate = vi.fn()) {
    render(
      <NotificationTargetLink targetUrl={target} onBeforeNavigate={onBeforeNavigate}>
        Tin nhắn mới
      </NotificationTargetLink>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tin nhắn mới" }));
    return onBeforeNavigate;
  }

  function calledUrls(): string[] {
    return fetchSpy.mock.calls.map((call) => String(call[0]));
  }

  beforeEach(() => {
    window.history.replaceState({}, "", "/tasks");
    useAuthStore.setState({ capabilities: { "view:chat-room": true, "access:chat": true } });
    useChatStore.getState().resetChatStore();
    useChatDockStore.getState().resetChatDock();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]"));
    toastError = vi.spyOn(toast, "error");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    toastError.mockRestore();
    window.history.replaceState({}, "", "/");
  });

  it("đang ở /tasks, phòng có trong danh sách của tôi ⇒ drawer mở R tại chỗ, không điều hướng, đánh dấu đã đọc", () => {
    useChatStore.getState().syncRoomList([chatRoom(ROOM, "Nhóm A")], false);

    const onBeforeNavigate = clickChatNotification(`/chat/${ROOM}`);

    expect(onBeforeNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(useChatDockStore.getState().isOpen).toBe(true);
    expect(useChatDockStore.getState().openRoomIds).toEqual([ROOM]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("phòng KHÔNG có trong danh sách của tôi (không tồn tại · xoá mềm · lưu trữ · đã rời) ⇒ thông điệp chung, 0 lời gọi API của R, drawer không mở", () => {
    useChatStore.getState().syncRoomList([chatRoom(OTHER, "Nhóm khác")], false);

    clickChatNotification(`/chat/${ROOM}`);

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]).toBe("Không mở được cuộc trò chuyện này");
    expect(String(toastError.mock.calls[0]?.[0])).not.toContain(SECRET_NAME);
    expect(calledUrls().filter((url) => url.includes(ROOM))).toEqual([]);
    expect(useChatDockStore.getState().isOpen).toBe(false);
    expect(useChatDockStore.getState().openRoomIds).toEqual([]);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("đang ở /chat ⇒ `/chat/R` bằng replace (giữ ?msg hợp lệ), không mở drawer chồng", () => {
    window.history.replaceState({}, "", "/chat");
    const MSG = "3c4d5e6f-7a8b-4c9d-8e0f-123456789abc";

    clickChatNotification(`/chat/${ROOM}?msg=${MSG}`);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/chat/$roomId",
      params: { roomId: ROOM },
      search: { msg: MSG },
      replace: true,
    });
    expect(useChatDockStore.getState().isOpen).toBe(false);
  });

  it("`/chat/abc` (không phải UUID) ⇒ điều hướng như liên kết thường, không mở drawer", () => {
    clickChatNotification("/chat/abc");

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/chat/abc" });
    expect(useChatDockStore.getState().isOpen).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("thiếu cặp xem CHAT ⇒ «Không có quyền truy cập Tin nhắn», không mở drawer, không gọi API", () => {
    useAuthStore.setState({ capabilities: {} });
    useChatStore.getState().syncRoomList([chatRoom(ROOM, "Nhóm A")], false);

    clickChatNotification(`/chat/${ROOM}`);

    expect(toastError).toHaveBeenCalledWith("Không có quyền truy cập Tin nhắn", expect.anything());
    expect(useChatDockStore.getState().isOpen).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("danh sách phòng CHƯA về ⇒ sang `/chat/R` (trang tự chờ + xác nhận), không mở drawer", () => {
    clickChatNotification(`/chat/${ROOM}`);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/chat/$roomId",
      params: { roomId: ROOM },
      search: {},
    });
    expect(useChatDockStore.getState().isOpen).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
