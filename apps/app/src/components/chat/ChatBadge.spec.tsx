// @vitest-environment jsdom
/**
 * S7-CHAT-FE-3 — badge tổng chưa đọc trên header (CHAT-SCREEN-006), cập nhật cho drawer ở
 * S17-CHAT-UX2-FE-5.
 *
 * Bốn khẳng định giữ chỗ:
 *  (a) thiếu `access:chat` ⇒ KHÔNG render gì (không hiện icon rỗng rồi để server 403);
 *  (b) số hiển thị đến từ store, KHÔNG từ một request nào — bài này không mock `chatApi` và vẫn phải ra
 *      đúng số, đó chính là bằng chứng "không gọi `GET /chat/unread-count`";
 *  (c) bấm badge MỞ DRAWER, không điều hướng — ở MỌI bề rộng màn hình (v2: drawer toàn màn dưới `md`,
 *      nên nhánh "màn hẹp thì navigate" của bản dock đã chết);
 *  (d) trên `/chat*` badge là chỉ báo TĨNH và **không mở drawer** — nếu vỡ, hai instance
 *      `useChatConversation` cùng một phòng sẽ giết lưới bù tin của nhau.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import type { ChatRoomDto } from "@mediaos/contracts";
import i18n from "@/i18n";

const navigate = vi.fn();
let pathname = "/hr/employees";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigate,
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname } }),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, useCan: vi.fn(() => true) };
});

import { useCan } from "@mediaos/web-core";
import { useChatStore } from "@/stores/chat.store";
import { useChatDockStore } from "./chat-dock.store";
import { ChatBadge } from "./ChatBadge";

const mockUseCan = useCan as unknown as ReturnType<typeof vi.fn>;

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

function seedRooms(rooms: ChatRoomDto[]): void {
  useChatStore.getState().resetChatStore();
  useChatStore.getState().hydrateRooms(rooms);
}

function renderBadge() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ChatBadge />
    </I18nextProvider>,
  );
}

describe("ChatBadge", () => {
  beforeEach(() => {
    navigate.mockClear();
    pathname = "/hr/employees";
    mockUseCan.mockReturnValue(true);
    useChatDockStore.getState().resetChatDock();
    seedRooms([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("thiếu access:chat ⇒ không render gì", () => {
    mockUseCan.mockReturnValue(false);
    seedRooms([room("a", { unreadCount: 5 })]);
    const { container } = renderBadge();
    expect(container).toBeEmptyDOMElement();
  });

  it("hiện tổng chưa đọc cộng dồn từ store (không gọi API nào)", () => {
    seedRooms([room("a", { unreadCount: 2 }), room("b", { unreadCount: 3 })]);
    renderBadge();
    expect(screen.getByTestId("chat-badge")).toHaveTextContent("5");
  });

  it("không có tin chưa đọc ⇒ không vẽ chấm số", () => {
    seedRooms([room("a", { unreadCount: 0 })]);
    renderBadge();
    expect(screen.getByTestId("chat-badge")).not.toHaveTextContent(/\d/);
  });

  it("phòng đã lưu trữ KHÔNG được cộng vào tổng", () => {
    seedRooms([room("a", { unreadCount: 1 }), room("z", { unreadCount: 40, isArchived: true })]);
    renderBadge();
    expect(screen.getByTestId("chat-badge")).toHaveTextContent("1");
  });

  it("bấm badge ⇒ MỞ DRAWER, không điều hướng", () => {
    seedRooms([room("a", { unreadCount: 2 })]);
    renderBadge();

    fireEvent.click(screen.getByTestId("chat-badge"));

    expect(useChatDockStore.getState().isOpen).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    // Drawer mở ở chế độ DANH SÁCH: badge không được tự chọn hộ một phòng nào.
    expect(useChatDockStore.getState().openRoomIds).toEqual([]);
  });

  it("bấm lần nữa ⇒ đóng drawer (nút bật/tắt, aria-expanded phản ánh đúng)", () => {
    seedRooms([room("a")]);
    renderBadge();

    fireEvent.click(screen.getByTestId("chat-badge"));
    expect(screen.getByTestId("chat-badge")).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByTestId("chat-badge"));
    expect(useChatDockStore.getState().isOpen).toBe(false);
    expect(screen.getByTestId("chat-badge")).toHaveAttribute("aria-expanded", "false");
  });

  it("màn hẹp hơn md ⇒ VẪN mở drawer (không còn nhánh điều hướng của bản dock)", () => {
    /*
     * ĐỐI CHỨNG cho hành vi CŨ. Bản `ChatDock` ẩn dưới `md` bằng CSS nên badge phải `navigate('/chat')`
     * ở đó, nếu không là một nút bấm không có tác dụng nhìn thấy được. Drawer chiếm TOÀN MÀN dưới `md`
     * (`max-w-none`), nên nhánh đó chết — và ca này là thứ duy nhất chứng minh việc gỡ
     * `useHasDockViewport` là đúng chứ không phải bỏ sót.
     */
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    seedRooms([room("a", { unreadCount: 2 })]);
    renderBadge();

    fireEvent.click(screen.getByTestId("chat-badge"));

    expect(useChatDockStore.getState().isOpen).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("trên /chat: chỉ báo TĨNH — không có nút, và KHÔNG mở drawer", () => {
    pathname = "/chat";
    seedRooms([room("a", { unreadCount: 4 })]);
    renderBadge();

    expect(screen.getByTestId("chat-badge-static")).toHaveTextContent("4");
    expect(screen.queryByTestId("chat-badge")).toBeNull();
    /*
     * Vế `isOpen === false` là RATCHET, không phải khẳng định thừa.
     *
     * `done_when` của WO này viết «badge mở drawer trên mọi trang có ProtectedShell», nên người sau rất
     * dễ "sửa cho đúng câu chữ" và bỏ ngoại lệ `/chat*`. Khi ấy `/chat` và drawer cùng mount
     * `useChatConversation` cho một phòng: cái unmount trước `clearInterval` lưới bù tin của cái còn
     * sống và cắt lịch sử về 200 tin — im lặng tuyệt đối, không log, không lỗi. Ca này là dòng đỏ duy
     * nhất chặn được điều đó.
     */
    expect(useChatDockStore.getState().isOpen).toBe(false);
  });

  it("trên /chat/<id> (sub-route) cũng là chỉ báo TĨNH", () => {
    pathname = "/chat/11111111-1111-4111-8111-111111111111";
    seedRooms([room("a", { unreadCount: 4 })]);
    renderBadge();

    expect(screen.getByTestId("chat-badge-static")).toBeTruthy();
    expect(screen.queryByTestId("chat-badge")).toBeNull();
  });
});
