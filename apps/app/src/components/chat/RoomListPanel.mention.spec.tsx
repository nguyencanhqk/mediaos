// @vitest-environment jsdom
/**
 * S20-CHAT-MENTIONPIN-1 — «@» trên dòng phòng + chip «Nhắc tôi» (US-CHAT-NV-07, tiêu chí 1 · 2 · 5).
 * `RoomListPanel` dùng chung cho trang và drawer (`variant`), nên phủ cả hai biến thể ở đây.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto } from "@mediaos/contracts";

const listRooms = vi.fn();
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    chatApi: { ...actual.chatApi, listRooms: (...a: unknown[]) => listRooms(...a) },
  };
});

import { useChatStore } from "@/stores/chat.store";
import { RoomListPanel } from "./RoomListPanel";

const COMPANY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function room(id: string, over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id,
    companyId: COMPANY,
    refId: null,
    roomType: "group",
    name: `Phòng ${id}`,
    roomCode: `CHAT-${id}`,
    description: null,
    lastMessageAt: "2026-10-23T10:00:00.000Z",
    lastMessageSeq: 10,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

function renderPanel(variant: "page" | "drawer" = "page") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RoomListPanel
          selectedRoomId={null}
          isBootstrapping={false}
          variant={variant}
          onSelectRoom={vi.fn()}
          onCreateRoom={vi.fn()}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const chipKeys = (): (string | null)[] =>
  screen.getAllByTestId("chat-room-chip").map((el) => el.getAttribute("data-chip"));

function chip(key: string): HTMLElement {
  const found = screen
    .getAllByTestId("chat-room-chip")
    .find((el) => el.getAttribute("data-chip") === key);
  if (!found) throw new Error(`không thấy chip "${key}"`);
  return found;
}

beforeEach(() => {
  listRooms.mockReset().mockResolvedValue([]);
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
});

describe.each(["page", "drawer"] as const)(
  "RoomListPanel (%s) · «@» + chip «Nhắc tôi»",
  (variant) => {
    it("R có 10 chưa đọc, 2 nhắc tôi ⇒ dòng R có «@»; chip «Nhắc tôi» liệt kê ĐÚNG R", () => {
      useChatStore
        .getState()
        .hydrateRooms([
          room("r", { unreadCount: 10, mentionUnreadCount: 2 }),
          room("s", { unreadCount: 4, mentionUnreadCount: 0 }),
        ]);
      renderPanel(variant);

      const marks = screen.getAllByTestId("chat-room-mention");
      expect(marks).toHaveLength(1);
      expect(marks[0]?.getAttribute("aria-label")).toBe("2 tin chưa đọc nhắc đến bạn");

      fireEvent.click(chip("mentions"));
      const items = screen.getAllByTestId("chat-room-item");
      expect(items).toHaveLength(1);
      expect(items[0]?.textContent).toContain("Phòng r");
    });

    it("đọc tới đáy (chat:read của tôi) ⇒ «@» biến mất", () => {
      useChatStore.getState().hydrateRooms([room("r", { unreadCount: 10, mentionUnreadCount: 2 })]);
      renderPanel(variant);
      expect(screen.getAllByTestId("chat-room-mention")).toHaveLength(1);

      act(() => {
        useChatStore.getState().applyReadEvent({ roomId: "r", userId: ME, lastReadSeq: 10 });
      });
      expect(screen.queryByTestId("chat-room-mention")).toBeNull();
    });

    it("server CŨ (không phòng nào có `mentionUnreadCount`) ⇒ chip «Nhắc tôi» ẨN, không «@», không lỗi", () => {
      useChatStore.getState().hydrateRooms([room("r", { unreadCount: 3 })]);
      renderPanel(variant);
      expect(chipKeys()).not.toContain("mentions");
      expect(chipKeys()).toContain("unread");
      expect(screen.queryByTestId("chat-room-mention")).toBeNull();
    });

    it("đang chọn «Nhắc tôi» rồi danh sách mới KHÔNG còn số @ ⇒ chip ẩn VÀ bộ lọc về «Tất cả»", () => {
      useChatStore.getState().hydrateRooms([room("r", { unreadCount: 10, mentionUnreadCount: 2 })]);
      renderPanel(variant);
      fireEvent.click(chip("mentions"));
      expect(chip("mentions").getAttribute("aria-pressed")).toBe("true");

      act(() => {
        useChatStore.getState().resetChatStore();
        useChatStore.getState().setMyUserId(ME);
        useChatStore.getState().hydrateRooms([room("s", { unreadCount: 3 })]);
      });
      expect(chipKeys()).not.toContain("mentions");
      // Không có bộ lọc vô hình: chip «Tất cả» đang chọn và phòng s hiện ra.
      expect(chip("all").getAttribute("aria-pressed")).toBe("true");
      const items = screen.getAllByTestId("chat-room-item");
      expect(items).toHaveLength(1);
      expect(items[0]?.textContent).toContain("Phòng s");
    });
  },
);
