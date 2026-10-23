/**
 * S20-CHAT-DEEPLINK-1 (US-CHAT-NV-01) — cầu giữa router và `ChatPage`.
 *
 * `/chat` và `/chat/$roomId` dựng CÙNG một trang (route con không có component riêng), nên đổi phòng
 * không dựng lại trang — danh sách phòng, ô tìm, bảng thông tin giữ nguyên.
 *
 * Đổi phòng TRONG trang là `replace` (§7 Q5 = A): Back rời `/chat` về trang trước đó, không đi vòng qua
 * từng phòng đã bấm. Nút quay lại danh sách (bố cục 1 cột) cũng `replace` về `/chat`.
 */
import { useCallback } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ChatPage } from "./ChatPage";
import { CHAT_ROOM_PATH, isChatEntityId } from "./chat-room-link";
import { CHAT_PATH } from "./constants";

export function ChatRoute(): React.ReactElement {
  const navigate = useNavigate();
  const params: { roomId?: string } = useParams({ strict: false });
  const search: { msg?: string } = useSearch({ strict: false });

  const onRoomChange = useCallback(
    (roomId: string | null) => {
      if (roomId === null) {
        void navigate({ to: CHAT_PATH, replace: true });
        return;
      }
      void navigate({ to: CHAT_ROOM_PATH, params: { roomId }, replace: true });
    },
    [navigate],
  );

  return (
    <ChatPage
      roomId={isChatEntityId(params.roomId) ? params.roomId : null}
      messageId={isChatEntityId(search.msg) ? search.msg : null}
      onRoomChange={onRoomChange}
    />
  );
}
