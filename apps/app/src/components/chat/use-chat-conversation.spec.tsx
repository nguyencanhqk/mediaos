/**
 * S7-CHAT-FE-2 — useChatConversation. Nhóm ĐẮT nhất: **nâng cấp đính kèm đến từ WS**.
 *
 * Payload WS cố ý không mang URL ký (masking per-recipient), nên client phải tự đi hỏi REST. Không có
 * vòng đó, một tệp vừa gửi đứng ở "đang lấy liên kết" VĨNH VIỄN khi WS khoẻ — lưới bù của FE-1 chỉ chạy
 * lúc MẤT kết nối. Đây đúng loại lỗi không ai báo cáo được vì "chat vẫn chạy mà".
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ChatMessageDto } from "@mediaos/contracts";

const getMessages = vi.fn();
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    chatApi: {
      ...actual.chatApi,
      getMessages: (...a: unknown[]) => getMessages(...a),
      sendMessage: vi.fn(),
      markRead: vi.fn().mockResolvedValue({ roomId: "", lastReadSeq: 0, unreadCount: 0 }),
    },
  };
});

import { attachmentUrl, useChatStore, type StoredChatMessage } from "@/stores/chat.store";
import { useChatConversation } from "./use-chat-conversation";

const ROOM = "11111111-1111-4111-8111-111111111111";
const MSG_ID = "00000011-1111-4111-8111-111111111111";
const LINK_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FILE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const attachmentBase = {
  id: LINK_ID,
  fileId: FILE_ID,
  name: "bao-cao.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1024,
  isImage: false,
};

function baseMessage(): Omit<ChatMessageDto, "attachments"> {
  return {
    id: MSG_ID,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    roomId: ROOM,
    senderId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    senderName: "Tôi",
    body: "kèm tệp",
    messageType: "file",
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 1,
    roomSeq: 11,
    createdAt: "2026-08-04T10:00:00.000Z",
  };
}

/** Bản đến từ WS: đính kèm KHÔNG có khoá `url` (đúng hình dạng `wsChatAttachmentSchema`). */
const wsMessage: StoredChatMessage = { ...baseMessage(), attachments: [attachmentBase] };

/** Bản REST của CÙNG tin: có URL ký. */
const restMessage: ChatMessageDto = {
  ...baseMessage(),
  attachments: [{ ...attachmentBase, url: "https://storage/signed", thumbnailUrl: null }],
};

beforeEach(() => {
  getMessages.mockReset();
  getMessages.mockResolvedValue([]);
  useChatStore.getState().resetChatStore();
});

describe("useChatConversation · nâng cấp đính kèm WS → REST", () => {
  it("tin WS có đính kèm chưa biết URL ⇒ tự gọi REST và NÂNG CẤP tại chỗ", async () => {
    useChatStore.getState().applyIncomingMessage(wsMessage);
    expect(attachmentUrl(useChatStore.getState().messagesByRoom[ROOM][0].attachments[0])).toBe(
      undefined,
    );

    // ⚠️ Lượt gọi ĐẦU (trang đầu của phòng) trả RỖNG có chủ đích. Nếu nó cũng trả `restMessage` thì bài
    // test này XANH kể cả khi vòng nâng cấp không tồn tại — chính trang đầu đã vô tình vá hộ. Chỉ lượt
    // gọi THỨ HAI (vòng nâng cấp) mới mang URL, nên phép khẳng định dưới đây chỉ đúng khi vòng đó chạy.
    getMessages.mockResolvedValueOnce([]).mockResolvedValue([restMessage]);
    renderHook(() => useChatConversation(ROOM));

    await waitFor(() =>
      expect(attachmentUrl(useChatStore.getState().messagesByRoom[ROOM][0].attachments[0])).toBe(
        "https://storage/signed",
      ),
    );
    expect(getMessages.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("chỉ xin MỘT lần cho mỗi tin — request hỏng không thành vòng lặp nện API", async () => {
    useChatStore.getState().applyIncomingMessage(wsMessage);
    getMessages.mockRejectedValue(new Error("500"));

    const { rerender } = renderHook(() => useChatConversation(ROOM));
    await waitFor(() => expect(getMessages).toHaveBeenCalled());
    const callsAfterFirst = getMessages.mock.calls.length;

    rerender();
    rerender();
    // Trang đầu + một lần xin URL. Không có `attemptedRef` thì mỗi lần render lại xin thêm một lần nữa.
    expect(getMessages.mock.calls.length).toBe(callsAfterFirst);
  });

  it("tin KHÔNG có đính kèm ⇒ không phát sinh lượt gọi phụ nào (chỉ trang đầu)", async () => {
    useChatStore.getState().applyIncomingMessage({ ...wsMessage, attachments: [] });
    renderHook(() => useChatConversation(ROOM));
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(1));
  });
});

describe("useChatConversation · cuộn ngược", () => {
  it("hasMoreOlder = true khi tin cũ nhất có roomSeq > 1 (room_seq liên tục từ 1)", async () => {
    useChatStore.getState().applyIncomingMessage({ ...wsMessage, attachments: [] });
    const { result } = renderHook(() => useChatConversation(ROOM));
    await waitFor(() => expect(result.current.hasMoreOlder).toBe(true));
  });

  it("tin cũ nhất có roomSeq === 1 ⇒ hết lịch sử, KHÔNG gọi thêm", async () => {
    useChatStore.getState().applyIncomingMessage({ ...wsMessage, roomSeq: 1, attachments: [] });
    const { result } = renderHook(() => useChatConversation(ROOM));
    await waitFor(() => expect(result.current.hasMoreOlder).toBe(false));

    getMessages.mockClear();
    const added = await result.current.loadOlder();
    expect(added).toBe(0);
    expect(getMessages).not.toHaveBeenCalled();
  });

  it("loadOlder gửi `beforeSeq` = roomSeq NHỎ nhất đang giữ và prepend kết quả", async () => {
    useChatStore.getState().applyIncomingMessage({ ...wsMessage, roomSeq: 10, attachments: [] });
    const { result } = renderHook(() => useChatConversation(ROOM));
    await waitFor(() => expect(result.current.hasMoreOlder).toBe(true));

    getMessages.mockClear();
    getMessages.mockResolvedValue([
      { ...restMessage, id: "00000009-1111-4111-8111-111111111111", roomSeq: 9, attachments: [] },
    ]);
    const added = await result.current.loadOlder();

    expect(getMessages).toHaveBeenCalledWith(ROOM, expect.objectContaining({ beforeSeq: 10 }));
    expect(added).toBe(1);
    expect(useChatStore.getState().messagesByRoom[ROOM][0].roomSeq).toBe(9);
  });
});

describe("useChatConversation · vòng đời", () => {
  it("unmount ⇒ gỡ theo dõi VÀ cắt lịch sử về trần sống (trả RAM)", async () => {
    for (let seq = 1; seq <= 250; seq += 1) {
      useChatStore.getState().prependOlderMessages(ROOM, [
        {
          ...wsMessage,
          id: `${String(300 - seq).padStart(8, "0")}-1111-4111-8111-111111111111`,
          roomSeq: 300 - seq,
          attachments: [],
        },
      ]);
    }
    expect(useChatStore.getState().messagesByRoom[ROOM].length).toBeGreaterThan(200);

    const { unmount } = renderHook(() => useChatConversation(ROOM));
    await waitFor(() => expect(useChatStore.getState().subscribedRoomIds[ROOM]).toBeDefined());

    unmount();
    expect(useChatStore.getState().subscribedRoomIds[ROOM]).toBeUndefined();
    expect(useChatStore.getState().messagesByRoom[ROOM]).toHaveLength(200);
  });

  it("roomId = null ⇒ không gọi API nào", () => {
    renderHook(() => useChatConversation(null));
    expect(getMessages).not.toHaveBeenCalled();
  });
});
