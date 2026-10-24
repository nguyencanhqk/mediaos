/**
 * S20-CHAT-FEDEBT-1 — MỘT đường nạp cửa sổ ngữ cảnh quanh một tin (CHAT-SCREEN-005).
 *
 * Hai nơi gọi: `ChatPage.jumpToMessage` (kết quả tìm kiếm · `?msg=` · tệp/link/ghim trong bảng thông tin)
 * và `PinnedMessageBar` (bấm thân thanh tin ghim). Trước đây mỗi nơi tự chép hai lời gọi `/messages` —
 * hai bản sao của một phép tính có dấu `+ 1` dễ trôi khỏi nhau.
 *
 * `/messages` không có `aroundSeq`, nên cửa sổ = ĐÚNG hai lời gọi:
 *
 *   beforeSeq = seq + 1  → `CONTEXT_BEFORE` tin có seq ≤ seq, GỒM chính tin đích (vị từ `lt`, loại trừ)
 *   afterSeq  = seq      → `CONTEXT_AFTER` tin sau nó (vị từ `gt`)
 *
 * ⚠️ `+ 1` không phải làm tròn cho đẹp: `beforeSeq = seq` loại trừ đúng tin người dùng vừa bấm vào.
 *
 * Cửa sổ THAY THẾ danh sách của phòng (`enterMessageContext`) — ghép vào dải đang giữ sẽ dựng một khe hở
 * câm giữa hai đoạn cách nhau hàng nghìn tin (xem docblock `ChatMessageContext`).
 *
 * Trả `true` khi đã vào chế độ ngữ cảnh. `false` khi tin đích vắng khỏi cửa sổ (vừa bị thu hồi + lọc, hoặc
 * con trỏ lệch) hoặc lời gọi lỗi — vào chế độ ngữ cảnh mà không có tin nào được làm nổi là để người dùng
 * ngồi trong một cửa sổ đóng băng. Nơi gọi tự quyết cách báo lỗi (thông điệp nổi ở trang, dòng chữ ở thanh).
 */
import { useCallback } from "react";
import { chatApi } from "@mediaos/web-core";
import { CONTEXT_AFTER, CONTEXT_BEFORE } from "@/routes/chat/constants";
import { useChatStore } from "@/stores/chat.store";

export type OpenMessageContext = (
  roomId: string,
  messageId: string,
  roomSeq: number,
) => Promise<boolean>;

export function useChatContextWindow(): OpenMessageContext {
  const enterMessageContext = useChatStore((s) => s.enterMessageContext);
  return useCallback(
    async (roomId: string, messageId: string, roomSeq: number): Promise<boolean> => {
      try {
        const [olderPage, newerPage] = await Promise.all([
          chatApi.getMessages(roomId, { beforeSeq: roomSeq + 1, limit: CONTEXT_BEFORE }),
          chatApi.getMessages(roomId, { afterSeq: roomSeq, limit: CONTEXT_AFTER }),
        ]);
        const window = [...olderPage, ...newerPage];
        if (!window.some((m) => m.id === messageId)) return false;
        enterMessageContext(roomId, window, { messageId, seq: roomSeq });
        return true;
      } catch (err: unknown) {
        console.error(`[chat] không mở được ngữ cảnh của tin ${messageId}:`, err);
        return false;
      }
    },
    [enterMessageContext],
  );
}
