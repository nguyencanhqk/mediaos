/**
 * S20-CHAT-DEEPLINK-1 (US-CHAT-NV-02) — «Nhắn riêng» từ avatar/tên người gửi.
 *
 * Có: tin của NGƯỜI KHÁC, chưa thu hồi, có khung để mở phòng, có `create:chat-room`.
 * Không: tin của tôi · tin thu hồi · tin hệ thống · thiếu cặp quyền.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ChatRoomDto } from "@mediaos/contracts";
import { ApiError, chatApi, useAuthStore } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import { useChatStore, type StoredChatMessage } from "@/stores/chat.store";
import { ChatRoomOpenerContext } from "./chat-room-opener";
import { MessageBubble, type MessageBubbleActions } from "./MessageBubble";

const BINH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GROUP = "11111111-1111-4111-8111-111111111111";
const DM = "22222222-2222-4222-8222-222222222222";

const actions: MessageBubbleActions = {
  onReply: vi.fn(),
  onPin: vi.fn(),
  onUnpin: vi.fn(),
  onRecall: vi.fn(),
  onToggleReaction: vi.fn(),
  onCopy: vi.fn(),
};

function message(over: Partial<StoredChatMessage> = {}): StoredChatMessage {
  return {
    id: "00000001-1111-4111-8111-111111111111",
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    roomId: GROUP,
    senderId: BINH,
    senderName: "Lê Bình",
    body: "chào cả nhóm",
    messageType: "text",
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    roomSeq: 5,
    createdAt: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

const dmRoom: ChatRoomDto = {
  id: DM,
  companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  refId: null,
  roomType: "direct",
  name: null,
  roomCode: "CHAT-0002",
  description: null,
  lastMessageAt: null,
  lastMessageSeq: 0,
  isArchived: false,
  unreadCount: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
};

let openDirect: MockInstance<typeof chatApi.openDirect>;
let toastError: MockInstance<typeof toast.error>;

function renderBubble(over: Partial<StoredChatMessage> = {}, isMine = false) {
  const opener = vi.fn();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ChatRoomOpenerContext.Provider value={opener}>
        <MessageBubble
          message={message(over)}
          isMine={isMine}
          isGrouped={false}
          isLastOfGroup
          replyTo={undefined}
          canRecall={false}
          canPin={false}
          seenBy={[]}
          senderAvatarUrl={null}
          senderNameFallback={null}
          isArchived={false}
          actions={actions}
        />
      </ChatRoomOpenerContext.Provider>
    </QueryClientProvider>,
  );
  return { opener };
}

beforeEach(() => {
  useAuthStore.setState({ capabilities: { "create:chat-room": true, "view:chat-room": true } });
  useChatStore.getState().resetChatStore();
  openDirect = vi.spyOn(chatApi, "openDirect").mockResolvedValue(dmRoom);
  toastError = vi.spyOn(toast, "error");
});

afterEach(() => {
  openDirect.mockRestore();
  toastError.mockRestore();
});

describe("MessageBubble · «Nhắn riêng» từ người gửi", () => {
  it("tin của người khác ⇒ avatar và tên mở menu; «Nhắn riêng» gọi openDirect rồi mở DM trả về", async () => {
    const { opener } = renderBubble();

    const triggers = screen.getAllByRole("button", { name: "Tuỳ chọn với Lê Bình" });
    expect(triggers).toHaveLength(2);
    fireEvent.click(triggers[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Nhắn riêng" }));

    await waitFor(() => expect(opener).toHaveBeenCalledWith(DM));
    expect(openDirect).toHaveBeenCalledTimes(1);
    expect(openDirect).toHaveBeenCalledWith({ peerUserId: BINH });
    // Phòng vào store TRƯỚC khi mở — trang chỉ mở phòng có trong danh sách phòng của tôi.
    expect(useChatStore.getState().roomsById[DM]).toBeDefined();
  });

  it.each([
    ["tin của tôi", {}, true],
    ["tin đã thu hồi", { recalledAt: "2026-10-01T10:05:00.000Z", body: null }, false],
    ["tin hệ thống", { messageType: "system" as const, body: "Bình đã vào nhóm" }, false],
  ])("%s ⇒ không có menu người gửi", (_label, over, isMine) => {
    renderBubble(over as Partial<StoredChatMessage>, isMine as boolean);
    expect(screen.queryByTestId("chat-sender-menu-trigger")).toBeNull();
  });

  it("thiếu `create:chat-room` ⇒ không có menu (useCan, không hard-code role)", () => {
    useAuthStore.setState({ capabilities: { "view:chat-room": true } });
    renderBubble();
    expect(screen.queryByTestId("chat-sender-menu-trigger")).toBeNull();
  });

  it("người nhận đã khoá/nghỉ, chưa có DM (CHAT-ERR-003) ⇒ thông báo dễ hiểu, không mở phòng, bấm lại được", async () => {
    openDirect.mockRejectedValueOnce(
      new ApiError(422, "UNPROCESSABLE_ENTITY", "CHAT-ERR-003: người dùng không hợp lệ"),
    );
    const { opener } = renderBubble();

    fireEvent.click(screen.getAllByRole("button", { name: "Tuỳ chọn với Lê Bình" })[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Nhắn riêng" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Không nhắn riêng được: tài khoản này đã bị khoá hoặc đã nghỉ việc.",
        expect.anything(),
      ),
    );
    expect(opener).not.toHaveBeenCalled();
    expect(useChatStore.getState().roomsById[DM]).toBeUndefined();

    fireEvent.click(screen.getAllByRole("button", { name: "Tuỳ chọn với Lê Bình" })[0]);
    const item = await screen.findByRole("menuitem", { name: "Nhắn riêng" });
    expect(item).not.toBeDisabled();
  });
});
