/**
 * S7-CHAT-FE-3 — panel chat NỔI toàn hệ thống (SPEC-15 §9 CHAT-SCREEN-002).
 *
 * Gắn ĐÚNG MỘT LẦN ở `ProtectedShell`, cạnh `useChatRealtime` — nhờ vậy panel nhận tin ở MỌI route mà
 * KHÔNG mở kết nối thứ hai: dữ liệu đến từ `useChatStore`, còn kết nối `/ws` là singleton dùng chung
 * (`getAppSocket`). File này không import `socket.io` và không gọi `getAppSocket` — đó là bằng chứng đọc
 * được cho lời hứa "chung một kết nối".
 *
 * ⚠️ **KHÔNG render trên trang `/chat`.** Không phải để đỡ rối mắt — là bắt buộc kỹ thuật:
 * `useChatConversation` gọi `subscribeToRoom` lúc mount và `unsubscribeFromRoom` + `trimRoomHistory` lúc
 * unmount, mà store FE-1 KHÔNG đếm tham chiếu ở chiều ra. Hai instance cùng một phòng ⇒ instance nào
 * unmount trước sẽ (1) `clearInterval` lưới bù tin của instance còn sống — phòng đó ngừng cập nhật lúc
 * mất mạng, im lặng tuyệt đối; và (2) cắt lịch sử về 200 tin, vứt đúng phần người dùng vừa bấm "tải
 * thêm". Trang `/chat` đã là khung nhìn đầy đủ nên chồng panel lên nó không được gì để đánh đổi.
 * Trạng thái dock được GIỮ — rời `/chat` là các cửa sổ hiện lại nguyên vẹn.
 */
import { Suspense, lazy, useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useCan } from "@mediaos/web-core";
import { CHAT_PAIRS, CHAT_PATH } from "@/routes/chat/constants";
import { useChatStore } from "@/stores/chat.store";
import { useChatDockStore } from "./chat-dock.store";

/**
 * `lazy` chứ không import thẳng — và đây là đo được, không phải cảm tính.
 *
 * `ChatDock` gắn ở app shell nên nó nằm trong bundle KHỞI ĐỘNG của mọi người dùng, kể cả người chưa bao
 * giờ mở chat. Kéo thẳng `ChatDockWindow` sẽ lôi theo cả `ConversationPanel` → `MessageList` →
 * `MessageComposer` → `chat-upload` vào đó. Tách ra: khung dock (vài trăm byte) đi cùng shell, còn phần
 * nặng chỉ tải khi người dùng THỰC SỰ mở một hội thoại — và khi ấy nó dùng chung chunk với trang `/chat`.
 */
const ChatDockWindow = lazy(() =>
  import("./ChatDockWindow").then((m) => ({ default: m.ChatDockWindow })),
);

export function ChatDock(): React.ReactElement | null {
  // ⚠️ MỌI hook gọi VÔ ĐIỀU KIỆN (mirror `useChatRealtime`): `useCan` đọc capabilities nạp sau
  // `/auth/me` nên lần render đầu gần như luôn `false`; thoát sớm phía trên hook sẽ làm số hook đổi giữa
  // các lần render ⇒ React ném "Rendered fewer hooks than expected" và trắng nguyên shell.
  const canAccessChat = useCan(CHAT_PAIRS.ACCESS.action, CHAT_PAIRS.ACCESS.resourceType);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const openRoomIds = useChatDockStore((s) => s.openRoomIds);
  const closeRoom = useChatDockStore((s) => s.closeRoom);
  const roomsById = useChatStore((s) => s.roomsById);
  const hasLoadedRooms = useChatStore((s) => s.hasLoadedRooms);

  /**
   * Đóng cửa sổ của phòng đã biến khỏi store (bị bớt / tự rời / lưu trữ khỏi rổ).
   *
   * Không có vế này thì cửa sổ "ma" đứng lại và `ConversationPanel` bên trong nện
   * `GET /chat/rooms/:id/messages` — nay trả 404 — theo nhịp lưới bù, vô thời hạn.
   *
   * Chốt `hasLoadedRooms`: TRƯỚC khi `GET /chat/rooms` trả về lần đầu, `roomsById` rỗng với MỌI phòng.
   * Chạy sớm là đóng sạch dock ngay khung hình đầu sau mỗi lần tải lại trang — trông hệt như "dock tự
   * quên", không ai lần ra nguyên nhân.
   */
  useEffect(() => {
    if (!hasLoadedRooms) return;
    for (const roomId of openRoomIds) {
      if (roomsById[roomId] === undefined) closeRoom(roomId);
    }
  }, [openRoomIds, roomsById, hasLoadedRooms, closeRoom]);

  if (!canAccessChat) return null;
  // `startsWith` chứ không `===`: `/chat/…` về sau (FE-4 mở phòng theo URL) vẫn là trang chat.
  if (pathname === CHAT_PATH || pathname.startsWith(`${CHAT_PATH}/`)) return null;
  if (openRoomIds.length === 0) return null;

  return (
    <div
      // `pointer-events-none` ở container + `auto` ở từng cửa sổ: dải cố định này phủ hết cạnh dưới màn
      // hình, nên nếu nó ăn chuột thì mọi nút nằm dưới đó của trang nền trở nên KHÔNG BẤM ĐƯỢC — và
      // triệu chứng ("nút này thỉnh thoảng chết") không ai quy về chat.
      className="pointer-events-none fixed bottom-0 right-0 z-30 hidden items-end gap-3 px-4 md:flex"
      data-testid="chat-dock"
    >
      {/* `fallback={null}`: chunk hội thoại tải trong vài trăm mili-giây và cửa sổ nổi chưa từng tồn
          tại trên màn hình lúc đó — dựng một khung xám rồi thay bằng cửa sổ thật là thêm một lần giật
          layout ở góc màn hình, đúng thứ `done_when` #3 cấm. */}
      <Suspense fallback={null}>
        {openRoomIds.map((roomId) => (
          <ChatDockWindow key={roomId} roomId={roomId} />
        ))}
      </Suspense>
    </div>
  );
}
