/**
 * S17-CHAT-UX2-FE-5 — MỘT hội thoại bên trong drawer (SPEC-15 §9 CHAT-SCREEN-002 v2).
 *
 * Kế thừa nguyên vai trò của `ChatDockWindow` (S7-CHAT-FE-3), bỏ phần vỏ: thanh tiêu đề nay là header
 * của `Sheet` (‹ · tên phòng · ⤢ · ✕) nên `ConversationPanel` vào với `showHeader={false}`.
 *
 * Không có bản rút gọn: mọi thứ trang `/chat` làm được — gửi lại tin lỗi, thu hồi, ghim, cuộn ngược,
 * banner mất kết nối — drawer phải làm được y hệt, và cách rẻ nhất để điều đó ĐÚNG MÃI là dùng chung
 * đúng một component.
 */
import { useQuery } from "@tanstack/react-query";
import { chatApi, chatKeys, useCan } from "@mediaos/web-core";
import { CHAT_PAIRS } from "@/routes/chat/constants";
import { useChatStore } from "@/stores/chat.store";
import { ConversationPanel } from "../ConversationPanel";

interface ChatDrawerConversationProps {
  roomId: string;
}

export function ChatDrawerConversation({
  roomId,
}: ChatDrawerConversationProps): React.ReactElement | null {
  const canViewRoom = useCan(CHAT_PAIRS.VIEW_ROOM.action, CHAT_PAIRS.VIEW_ROOM.resourceType);
  const room = useChatStore((s) => s.roomsById[roomId]);

  /**
   * Chi tiết phòng (`members[]` + `myRole`) — CÙNG `queryKey` với trang `/chat`.
   *
   * Trùng khoá là CHỦ ĐÍCH: react-query chia sẻ một entry cache, nên mở cùng phòng ở drawer rồi vào
   * trang không sinh request thứ hai. Khoá riêng sẽ tạo hai bản `members[]` lệch nhau và tên phòng
   * `direct` nhấp nháy giữa hai giá trị.
   *
   * `enabled: canViewRoom` — mirror `ChatDockWindow`: thiếu cặp thì đừng gửi một request chắc chắn 403.
   */
  const detailQuery = useQuery({
    queryKey: chatKeys.rooms.detail(roomId),
    queryFn: () => chatApi.getRoom(roomId),
    enabled: canViewRoom,
  });
  const detail = detailQuery.data;

  // Phòng đã biến khỏi store (bị bớt / tự rời) — `ChatDrawer` dọn bằng effect riêng; ở đây chỉ tránh vẽ
  // một khung rỗng trong khung hình xen giữa hai lần render.
  if (!room) return null;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="chat-drawer-conversation"
      data-room-id={roomId}
    >
      <ConversationPanel
        room={room}
        members={detail?.members ?? []}
        myRole={detail?.myRole ?? null}
        showHeader={false}
      />
    </div>
  );
}
