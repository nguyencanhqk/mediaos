/**
 * S20-CHAT-DEEPLINK-1 (US-CHAT-NV-02) — «mở một phòng ngay trong khung đang đứng».
 *
 * Trang `/chat` mở bằng URL (`/chat/R`, `replace`); drawer mở bằng `openRoom` của `chat-dock.store`
 * (tại chỗ, không chuyển trang). Thành phần sâu bên dưới (bong bóng tin, danh sách thành viên) không
 * cần biết mình đang ở đâu — chúng hỏi context này. Không có provider ⇒ `null` ⇒ lối tắt tự ẩn.
 */
import { createContext, useContext } from "react";
import { useCan } from "@mediaos/web-core";
import { CHAT_PAIRS } from "@/routes/chat/constants";

export type ChatRoomOpener = (roomId: string) => void;

export const ChatRoomOpenerContext = createContext<ChatRoomOpener | null>(null);

export function useChatRoomOpener(): ChatRoomOpener | null {
  return useContext(ChatRoomOpenerContext);
}

/** «Nhắn riêng» chỉ có khi có khung để mở phòng VÀ có cặp `create:chat-room` (không hard-code role). */
export function useCanOpenDirect(): boolean {
  const opener = useChatRoomOpener();
  const canCreate = useCan(CHAT_PAIRS.CREATE_ROOM.action, CHAT_PAIRS.CREATE_ROOM.resourceType);
  return opener !== null && canCreate;
}
