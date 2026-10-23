/**
 * S20-CHAT-MENTIONPIN-1 — phần GHIM của `use-chat-realtime.ts` (US-CHAT-NV-08).
 *
 * `chat:message-pinned` chỉ mang 4 khoá (`messageId` · `roomId` · `pinnedAt` · `pinnedBy`) — KHÔNG nội dung.
 * Hai việc khi nhận:
 *   1. vá `pinnedAt`/`pinnedBy` của tin trong store (nếu đang giữ) ⇒ dấu ghim trên bong bóng + mục menu
 *      «Ghim/Bỏ ghim» đúng ngay, không chờ tải lại;
 *   2. làm mất hiệu lực `chatKeys.rooms.pinned(roomId)` ⇒ thanh tin ghim + khối «Tin ghim» nạp lại QUA REST,
 *      tức qua đúng lớp che/vị từ §13.4 của người đang xem.
 *
 * `chat:message-recalled` cũng làm mất hiệu lực entry đó: một tin ghim vừa bị thu hồi không được tiếp tục
 * hiện nội dung cũ từ cache.
 *
 * Tách file vì `chat.store.ts` đã quá trần 800 dòng — vá store bằng `setState` từ ngoài, không thêm action.
 */
import type { QueryClient } from "@tanstack/react-query";
import { chatKeys } from "@mediaos/web-core";
import type { WsChatMessagePinnedEvent } from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";

export function applyPinnedEvent(event: WsChatMessagePinnedEvent): void {
  useChatStore.setState((state) => {
    const list = state.messagesByRoom[event.roomId];
    if (!list?.some((m) => m.id === event.messageId)) return state;
    const next = list.map((m) =>
      m.id === event.messageId ? { ...m, pinnedAt: event.pinnedAt, pinnedBy: event.pinnedBy } : m,
    );
    return { messagesByRoom: { ...state.messagesByRoom, [event.roomId]: next } };
  });
}

export function invalidatePinned(queryClient: QueryClient, roomId: string): void {
  void queryClient.invalidateQueries({ queryKey: chatKeys.rooms.pinned(roomId) });
}
