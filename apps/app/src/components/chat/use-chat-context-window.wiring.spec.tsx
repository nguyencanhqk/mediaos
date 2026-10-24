/**
 * S20-CHAT-FEDEBT-1 — `ChatPage.jumpToMessage` và thanh tin ghim đi qua CÙNG một hook nạp cửa sổ ngữ
 * cảnh (`useChatContextWindow`). Hook bị thay bằng một spy: nơi gọi nào còn tự chép hai lời gọi
 * `/messages` thì spy không bao giờ được gọi ⇒ đỏ.
 *
 * Luật của chính cửa sổ (`+ 1`, tin đích vắng, lỗi mạng) đo ở `use-chat-context-window.spec.tsx`.
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatMessageDto, ChatRoomDto } from "@mediaos/contracts";

const { openContext } = vi.hoisted(() => ({ openContext: vi.fn() }));
vi.mock("./use-chat-context-window", () => ({ useChatContextWindow: () => openContext }));

import { useAuthStore } from "@mediaos/web-core";
import { useChatStore } from "@/stores/chat.store";
import { ChatPage } from "@/routes/chat/ChatPage";
import { useChatDraftStore } from "./chat-draft.store";
import { PinnedMessageBar } from "./PinnedMessageBar";

const R = "4d5e6f70-8192-4a3b-9c4d-5e6f70819203";
const MSG = "6f708192-0314-4c5d-8e6f-708192031425";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function room(id: string): ChatRoomDto {
  return {
    id,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: "Nhóm A",
    roomCode: "CHAT-0001",
    description: null,
    lastMessageAt: "2026-10-01T10:00:00.000Z",
    lastMessageSeq: 7,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
}

function message(over: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: MSG,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    roomId: R,
    senderId: ME,
    senderName: "Tôi",
    body: "tin cần nhảy tới",
    messageType: "text",
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    roomSeq: 7,
    createdAt: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

const PINNED_RE = /\/chat\/rooms\/[^/]+\/pinned/;
let pinnedRows: ChatMessageDto[] = [];
let fetchSpy: MockInstance<typeof fetch>;

function withClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>,
  );
}

function PageHarness({ messageId }: { messageId: string }) {
  const [roomId, setRoomId] = useState<string | null>(R);
  return <ChatPage roomId={roomId} messageId={messageId} onRoomChange={setRoomId} />;
}

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  openContext.mockReset().mockResolvedValue(true);
  pinnedRows = [];
  useAuthStore.setState({
    capabilities: { "view:chat-room": true, "send:chat-message": true },
  });
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
  useChatDraftStore.getState().resetChatDrafts();
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input) =>
      new Response(PINNED_RE.test(String(input)) ? JSON.stringify(pinnedRows) : "[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("Nạp cửa sổ ngữ cảnh — MỘT hook cho hai nơi gọi", () => {
  it("bấm thân thanh tin ghim ⇒ đi qua `useChatContextWindow` với (phòng, tin, seq)", async () => {
    pinnedRows = [message({ id: MSG, roomSeq: 42, pinnedAt: "2026-10-23T08:00:00.000Z" })];
    withClient(<PinnedMessageBar roomId={R} canUnpin={false} onUnpin={vi.fn()} />);

    fireEvent.click(await screen.findByTestId("chat-pinned-bar-jump"));

    await waitFor(() => expect(openContext).toHaveBeenCalledWith(R, MSG, 42));
  });

  it("hook trả `false` ⇒ thanh tin ghim báo không mở được", async () => {
    openContext.mockResolvedValue(false);
    pinnedRows = [message({ roomSeq: 42, pinnedAt: "2026-10-23T08:00:00.000Z" })];
    withClient(<PinnedMessageBar roomId={R} canUnpin={false} onUnpin={vi.fn()} />);

    fireEvent.click(await screen.findByTestId("chat-pinned-bar-jump"));

    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("`ChatPage.jumpToMessage` (`?msg=`) ⇒ đi qua CÙNG hook đó với (phòng, tin, seq)", async () => {
    useChatStore.getState().syncRoomList([room(R)], false);
    useChatStore.getState().applyIncomingMessage(message());

    withClient(<PageHarness messageId={MSG} />);

    await waitFor(() => expect(openContext).toHaveBeenCalledWith(R, MSG, 7));
  });

  it("hook trả `false` ⇒ trang hiện thông điệp lỗi nổi «không mở được»", async () => {
    openContext.mockResolvedValue(false);
    useChatStore.getState().syncRoomList([room(R)], false);
    useChatStore.getState().applyIncomingMessage(message());

    withClient(<PageHarness messageId={MSG} />);

    expect(await screen.findByText(i18n.t("chat:search.jumpFailed"))).toBeTruthy();
  });
});
