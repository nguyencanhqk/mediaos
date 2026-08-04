// @vitest-environment jsdom
/**
 * S7-CHAT-FE-3 — badge tổng chưa đọc trên header (CHAT-SCREEN-006).
 *
 * Ba khẳng định giữ chỗ:
 *  (a) thiếu `access:chat` ⇒ KHÔNG render gì (không hiện icon rỗng rồi để server 403);
 *  (b) số hiển thị đến từ store, KHÔNG từ một request nào — bài này không mock `chatApi` và vẫn phải ra
 *      đúng số, đó chính là bằng chứng "không gọi `GET /chat/unread-count`";
 *  (c) bấm một phòng trong dropdown MỞ nó ở panel nổi (dock store), không điều hướng.
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
    // jsdom KHÔNG có `matchMedia`. `useHasDockViewport` fail-soft về `true` khi vắng nó, nhưng dựa vào
    // nhánh fallback để test đường "có dock" là test nhầm thứ — stub tường minh cho ca rộng.
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
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

  it("bấm một phòng trong dropdown ⇒ mở nó ở panel nổi, không điều hướng", () => {
    seedRooms([room("a", { unreadCount: 2, name: "Nhóm Kế toán" })]);
    renderBadge();

    fireEvent.click(screen.getByTestId("chat-badge"));
    fireEvent.click(screen.getByText("Nhóm Kế toán"));

    expect(useChatDockStore.getState().openRoomIds).toEqual(["a"]);
    expect(navigate).not.toHaveBeenCalled();
    // Dropdown đóng lại sau khi chọn — để không che chính cửa sổ vừa mở.
    expect(screen.queryByTestId("chat-badge-dropdown")).toBeNull();
  });

  it("màn hình hẹp hơn md ⇒ điều hướng /chat thay vì mở panel nổi (panel bị ẩn ở đó)", () => {
    // `ChatDock` ẩn dưới `md` bằng CSS; nếu badge vẫn `openRoom()` thì trên điện thoại người dùng bấm
    // một phòng và KHÔNG thấy gì xảy ra — nút chết.
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    seedRooms([room("a", { unreadCount: 2, name: "Nhóm Kế toán" })]);
    renderBadge();

    fireEvent.click(screen.getByTestId("chat-badge"));
    fireEvent.click(screen.getByText("Nhóm Kế toán"));

    expect(useChatDockStore.getState().openRoomIds).toEqual([]);
    expect(navigate).toHaveBeenCalledWith({ to: "/chat" });
  });

  it("trên /chat: chỉ báo TĨNH — không có nút, không có dropdown (panel nổi không render ở đó)", () => {
    pathname = "/chat";
    seedRooms([room("a", { unreadCount: 4 })]);
    renderBadge();

    expect(screen.getByTestId("chat-badge-static")).toHaveTextContent("4");
    expect(screen.queryByTestId("chat-badge")).toBeNull();
  });
});
