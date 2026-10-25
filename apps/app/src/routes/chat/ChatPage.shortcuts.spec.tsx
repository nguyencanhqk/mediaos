/**
 * S20-CHAT-UNREADNAV-1 (US-CHAT-NV-13) — phím tắt chuyển phòng gắn THẬT ở `/chat` và trong drawer.
 *
 * Ca đơn vị (luật phím, luật chọn đích, lớp nổi/dialog) ở `use-room-shortcuts.spec.tsx`. Ở đây chỉ khoá
 * phần NỐI DÂY: đích theo đúng chip đang chọn, đổi phòng qua `onRoomChange` (route dùng `replace`), ô soạn
 * của phòng mới nhận focus, nháp phòng cũ còn nguyên khi quay lại, và drawer đổi phòng ngay cả khi danh
 * sách đã nhường chỗ cho hội thoại.
 */
import { useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto } from "@mediaos/contracts";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

const getRoom = vi.fn();
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    chatApi: {
      ...actual.chatApi,
      getRoom: (...a: unknown[]) => getRoom(...a),
      getMessages: vi.fn().mockResolvedValue([]),
      listRoomFiles: vi.fn().mockResolvedValue([]),
      listRooms: vi.fn().mockResolvedValue([]),
      getPinned: vi.fn().mockResolvedValue([]),
      listMembers: vi.fn().mockResolvedValue([]),
      pingTyping: () => Promise.resolve(undefined),
      markRead: vi.fn().mockResolvedValue({ roomId: "", lastReadSeq: 0, unreadCount: 0 }),
    },
  };
});

import { useChatStore } from "@/stores/chat.store";
import { useChatDraftStore } from "@/components/chat/chat-draft.store";
import { useChatDockStore } from "@/components/chat/chat-dock.store";
import { ChatDrawerBody } from "@/components/chat/drawer/ChatDrawerBody";
import { ChatPage } from "./ChatPage";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function room(id: string, minute: number, over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: `Phòng ${id}`,
    roomCode: `CHAT-${id}`,
    description: null,
    lastMessageAt: `2026-08-04T10:${String(minute).padStart(2, "0")}:00.000Z`,
    lastMessageSeq: 5,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

const onRoomChange = vi.fn();

function StatefulChatPage(): React.ReactElement {
  const [roomId, setRoomId] = useState<string | null>(null);
  return (
    <ChatPage
      roomId={roomId}
      onRoomChange={(next) => {
        onRoomChange(next);
        setRoomId(next);
      }}
    />
  );
}

function withProviders(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </QueryClientProvider>,
  );
}

const composer = () =>
  screen.getByTestId("chat-composer").querySelector("textarea") as HTMLTextAreaElement;

beforeAll(async () => {
  // Nạp sẵn cây hội thoại: lần import đầu chậm hơn timeout mặc định của `findBy*` (cùng lý do ChatDrawer.spec).
  await import("@/components/chat/ConversationPanel");
});

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  onRoomChange.mockReset();
  getRoom.mockReset();
  getRoom.mockImplementation((id: string) =>
    Promise.resolve({ ...useChatStore.getState().roomsById[id], members: [], myRole: "member" }),
  );
  useChatDraftStore.getState().resetChatDrafts();
  useChatDockStore.getState().resetChatDock();
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
  useChatStore
    .getState()
    .syncRoomList(
      [
        room("g1", 9, { unreadCount: 2 }),
        room("d1", 8, { roomType: "direct", name: "Lan", unreadCount: 1 }),
        room("g2", 7),
        room("g3", 6, { unreadCount: 3 }),
      ],
      false,
    );
});

describe("/chat · phím tắt chuyển phòng", () => {
  it("chip «Nhóm» ⇒ Alt+Shift+↓ chỉ đi qua phòng nhóm chưa đọc; ô soạn phòng mới nhận focus + tên đọc qua aria-live", async () => {
    withProviders(<StatefulChatPage />);
    const groupChip = screen
      .getAllByTestId("chat-room-chip")
      .find((el) => el.getAttribute("data-chip") === "group") as HTMLElement;
    fireEvent.click(groupChip);

    fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true, shiftKey: true });
    expect(onRoomChange).toHaveBeenLastCalledWith("g1");
    await waitFor(() => expect(document.activeElement).toBe(composer()));
    expect(screen.getByTestId("room-shortcut-live").textContent).toContain("Phòng g1");

    fireEvent.keyDown(composer(), { key: "ArrowDown", altKey: true, shiftKey: true });
    // g2 đã đọc, d1 (riêng) bị chip giấu ⇒ đích là g3.
    expect(onRoomChange).toHaveBeenLastCalledWith("g3");
    expect(onRoomChange.mock.calls.map((c) => c[0])).not.toContain("d1");
  });

  it("đang gõ dở ở phòng A ⇒ Alt+↓ sang B không chèn ký tự; Alt+↑ quay lại A còn nguyên nháp", async () => {
    withProviders(<StatefulChatPage />);
    // «Tất cả» chia mục: Riêng (d1) trước Nhóm (g1, g2, g3).
    fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true });
    expect(onRoomChange).toHaveBeenLastCalledWith("d1");
    await waitFor(() => expect(document.activeElement).toBe(composer()));
    fireEvent.change(composer(), { target: { value: "Anh xem giúp" } });

    const notCancelled = fireEvent.keyDown(composer(), { key: "ArrowDown", altKey: true });
    expect(notCancelled).toBe(false);
    expect(onRoomChange).toHaveBeenLastCalledWith("g1");
    await waitFor(() => expect(composer().value).toBe(""));

    fireEvent.keyDown(composer(), { key: "ArrowUp", altKey: true });
    expect(onRoomChange).toHaveBeenLastCalledWith("d1");
    await waitFor(() => expect(composer().value).toBe("Anh xem giúp"));
  });

  it("nút bàn phím trên đầu danh sách mở bảng gợi ý phím", () => {
    withProviders(<StatefulChatPage />);
    fireEvent.click(screen.getByTestId("chat-shortcut-help-open"));
    expect(screen.getByTestId("room-shortcut-help").textContent).toContain(
      "Phòng chưa đọc kế tiếp",
    );
  });
});

describe("drawer · phím tắt chuyển phòng", () => {
  it("đang mở hội thoại (danh sách đã tháo) ⇒ Alt+↓ mở phòng kế tiếp NGAY trong drawer", async () => {
    useChatDockStore.getState().openRoom("g1");
    withProviders(<ChatDrawerBody />);
    await screen.findByTestId("chat-drawer-conversation");
    expect(screen.queryByTestId("chat-room-list")).toBeNull();

    fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true });
    expect(useChatDockStore.getState().openRoomIds).toEqual(["g2"]);
    await waitFor(() =>
      expect(screen.getByTestId("chat-drawer-conversation").getAttribute("data-room-id")).toBe(
        "g2",
      ),
    );
  });
});
