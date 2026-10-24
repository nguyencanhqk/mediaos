/**
 * S20-CHAT-DEEPLINK-1 (US-CHAT-NV-01) — bấm thông báo có đích `/chat/<uuid>`.
 *
 *   đang ở `/chat*`            ⇒ `/chat/R` bằng `replace` (trang tự xác nhận R, không drawer chồng)
 *   trang khác, thiếu cặp xem  ⇒ «Không có quyền truy cập Tin nhắn», không mở drawer
 *   danh sách phòng chưa về    ⇒ sang `/chat/R` (trang chờ danh sách rồi mới xác nhận)
 *   R có trong phòng của tôi   ⇒ drawer mở R TẠI CHỖ (URL trang không đổi)
 *   R vắng khỏi store          ⇒ hỏi lại `GET /chat/rooms` MỘT lần (store có thể cũ); có R ⇒ drawer mở R
 *   R vẫn vắng                 ⇒ «Không mở được cuộc trò chuyện này» — MỘT câu cho mọi lý do (không tồn
 *                                tại · xoá mềm · lưu trữ · đã rời), không tên phòng, 0 lời gọi API của R
 *
 * Đọc store bằng `getState()` lúc BẤM (không subscribe): thành phần thông báo không phải vẽ lại mỗi lần
 * danh sách phòng đổi. Vị trí trang đọc từ `window.location` vì các bề mặt thông báo được test với router
 * giả chỉ có `useNavigate` (cùng lý do `task-drawer-nav`).
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useCan } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import { CHAT_PAIRS } from "@/routes/chat/constants";
import {
  CHAT_LINK_TOAST_KEY,
  CHAT_ROOM_PATH,
  isChatPathname,
  type ChatRoomTarget,
} from "@/routes/chat/chat-room-link";
import { recheckRoomListed } from "@/routes/chat/recheck-room-list";
import { useChatStore } from "@/stores/chat.store";
import { useChatDockStore } from "@/components/chat/chat-dock.store";

export function useChatRoomLinkOpener(): (target: ChatRoomTarget) => void {
  const { t } = useTranslation("chat");
  const navigate = useNavigate();
  const canViewRoom = useCan(CHAT_PAIRS.VIEW_ROOM.action, CHAT_PAIRS.VIEW_ROOM.resourceType);

  return useCallback(
    ({ roomId, messageId }: ChatRoomTarget) => {
      const search = messageId !== null ? { msg: messageId } : {};
      if (isChatPathname(window.location.pathname)) {
        void navigate({ to: CHAT_ROOM_PATH, params: { roomId }, search, replace: true });
        return;
      }
      if (!canViewRoom) {
        toast.error(t("deepLink.forbidden"), { key: CHAT_LINK_TOAST_KEY });
        return;
      }
      const { hasLoadedRooms, roomsById } = useChatStore.getState();
      if (!hasLoadedRooms) {
        void navigate({ to: CHAT_ROOM_PATH, params: { roomId }, search });
        return;
      }
      if (roomsById[roomId] !== undefined) {
        useChatDockStore.getState().openRoom(roomId);
        return;
      }
      // Store có thể cũ (vừa được thêm vào phòng, `chat:room` chưa tới) ⇒ hỏi lại danh sách MỘT lần.
      void recheckRoomListed(roomId).then((isListed) => {
        if (isListed) useChatDockStore.getState().openRoom(roomId);
        else toast.error(t("deepLink.unavailable"), { key: CHAT_LINK_TOAST_KEY });
      });
    },
    [canViewRoom, navigate, t],
  );
}
