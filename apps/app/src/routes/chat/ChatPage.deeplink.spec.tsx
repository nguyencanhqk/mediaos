/**
 * S20-CHAT-DEEPLINK-1 (US-CHAT-NV-01) — trang `/chat/$roomId`: phòng xin mở theo URL chỉ mở SAU KHI
 * xác nhận nó có trong danh sách phòng của tôi.
 *
 * `chatApi` THẬT, chỉ `fetch` bị gián điệp: «0 lời gọi API của R» được đo ở tầng mạng, không phải ở một
 * hàm giả mà mã sản phẩm có thể đi vòng qua.
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ChatRoomDto } from "@mediaos/contracts";
import { toast } from "@mediaos/ui";
import { useAuthStore } from "@mediaos/web-core";
import { useChatStore, type StoredChatMessage } from "@/stores/chat.store";
import { useChatDraftStore } from "@/components/chat/chat-draft.store";
import { ChatPage } from "./ChatPage";

const R = "4d5e6f70-8192-4a3b-9c4d-5e6f70819203";
const OTHER = "5e6f7081-9203-4b4c-8d5e-6f7081920314";
const MSG = "6f708192-0314-4c5d-8e6f-708192031425";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRET_NAME = "Phòng kín dự án X";
const DENIED = "Không mở được cuộc trò chuyện này";

function room(id: string, over: Partial<ChatRoomDto> = {}): ChatRoomDto {
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
    ...over,
  };
}

function message(over: Partial<StoredChatMessage> = {}): StoredChatMessage {
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

let fetchSpy: MockInstance<typeof fetch>;
/** Danh sách phòng SERVER trả cho `GET /chat/rooms` — có thể tươi hơn store (sự kiện `chat:room` lỡ). */
let serverRooms: ChatRoomDto[] = [];
const ROOM_LIST_RE = /\/chat\/rooms(?:\?|$)/;
let toastError: MockInstance<typeof toast.error>;
const roomChanges: Array<string | null> = [];

function roomListCalls(): string[] {
  return fetchSpy.mock.calls.map((call) => String(call[0])).filter((u) => ROOM_LIST_RE.test(u));
}

function urlsFor(id: string): string[] {
  return fetchSpy.mock.calls.map((call) => String(call[0])).filter((u) => u.includes(id));
}

/** Giữ `roomId` như URL thật: `onRoomChange` đổi nó (route thật làm bằng `navigate({ replace })`). */
function Harness({
  initialRoomId,
  messageId = null,
}: {
  initialRoomId: string | null;
  messageId?: string | null;
}) {
  const [roomId, setRoomId] = useState<string | null>(initialRoomId);
  return (
    <ChatPage
      roomId={roomId}
      messageId={messageId}
      onRoomChange={(next) => {
        roomChanges.push(next);
        setRoomId(next);
      }}
    />
  );
}

function renderPage(initialRoomId: string | null, messageId: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness initialRoomId={initialRoomId} messageId={messageId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // S20-CHAT-FEDEBT-1 — store nháp là module-global: ca trước để lại nháp/tệp bỏ thì ca sau đọc nhầm.
  useChatDraftStore.getState().resetChatDrafts();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  roomChanges.length = 0;
  serverRooms = [];
  useAuthStore.setState({
    capabilities: {
      "view:chat-room": true,
      "create:chat-room": true,
      "send:chat-message": true,
    },
  });
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input) =>
      new Response(ROOM_LIST_RE.test(String(input)) ? JSON.stringify(serverRooms) : "[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  toastError = vi.spyOn(toast, "error");
});

afterEach(() => {
  fetchSpy.mockRestore();
  toastError.mockRestore();
});

describe("ChatPage · /chat/$roomId — ca từ chối (RED trước)", () => {
  it("R vắng khỏi danh sách phòng của tôi (không tồn tại · xoá mềm · lưu trữ · đã rời) ⇒ MỘT thông điệp, về /chat, 0 lời gọi API của R", async () => {
    serverRooms = [room(OTHER, { name: "Nhóm khác" })];
    useChatStore.getState().syncRoomList(serverRooms, false);

    renderPage(R);

    await waitFor(() => expect(roomChanges).toEqual([null]));
    // Từ chối SAU khi hỏi lại danh sách đúng MỘT lần — lời hỏi lại không mang id của R.
    expect(roomListCalls()).toHaveLength(1);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]).toBe(DENIED);
    expect(String(toastError.mock.calls[0]?.[0])).not.toContain(SECRET_NAME);
    expect(urlsFor(R)).toEqual([]);
    expect(screen.queryByTestId("chat-composer")).toBeNull();
    // Danh sách phòng vẫn hiện bình thường bên cạnh thông điệp.
    expect(screen.getAllByTestId("chat-room-item")).toHaveLength(1);
  });

  it("danh sách phòng CHƯA về ⇒ chờ: 0 lời gọi API của R, chưa có thông điệp nào", async () => {
    renderPage(R);

    await act(async () => {
      await Promise.resolve();
    });
    expect(urlsFor(R)).toEqual([]);
    expect(toastError).not.toHaveBeenCalled();
    expect(roomChanges).toEqual([]);
  });
});

describe("ChatPage · /chat/$roomId — mở đúng phòng", () => {
  it("danh sách về và có R ⇒ mở R (chi tiết R được hỏi SAU xác nhận), ô soạn có focus", async () => {
    renderPage(R);
    expect(urlsFor(R)).toEqual([]);

    act(() => useChatStore.getState().syncRoomList([room(R, { name: SECRET_NAME })], false));

    const composer = await screen.findByTestId("chat-composer");
    await waitFor(() => expect(urlsFor(R).some((u) => u.endsWith(`/chat/rooms/${R}`))).toBe(true));
    await waitFor(() => expect(composer.contains(document.activeElement)).toBe(true));
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    expect(toastError).not.toHaveBeenCalled();
    expect(roomChanges).toEqual([]);
  });

  it("store CŨ (vừa được thêm vào R, sự kiện chat:room chưa tới) ⇒ hỏi lại danh sách MỘT lần rồi mở R, không thông điệp từ chối", async () => {
    useChatStore.getState().syncRoomList([room(OTHER, { name: "Nhóm khác" })], false);
    serverRooms = [room(OTHER, { name: "Nhóm khác" }), room(R, { name: SECRET_NAME })];

    renderPage(R);

    await screen.findByTestId("chat-composer");
    expect(roomListCalls()).toHaveLength(1);
    expect(toastError).not.toHaveBeenCalled();
    expect(roomChanges).toEqual([]);
  });

  it("phòng ĐANG MỞ biến khỏi danh sách (rời / bị bớt) ⇒ về /chat, KHÔNG kèm thông điệp từ chối", async () => {
    useChatStore.getState().syncRoomList([room(R)], false);
    renderPage(R);
    await screen.findByTestId("chat-composer");

    act(() => useChatStore.getState().syncRoomList([], false));

    await waitFor(() => expect(roomChanges).toEqual([null]));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("?msg=<id> có trong lịch sử đã tải ⇒ dùng lại jumpToMessage (nạp cửa sổ quanh seq của tin)", async () => {
    useChatStore.getState().syncRoomList([room(R)], false);
    useChatStore.getState().applyIncomingMessage(message());

    renderPage(R, MSG);

    await waitFor(() =>
      expect(urlsFor(R).some((u) => u.includes("beforeSeq=8") || u.includes("beforeSeq%3D8"))).toBe(
        true,
      ),
    );
    expect(urlsFor(R).some((u) => u.includes("afterSeq=7"))).toBe(true);
  });
});
