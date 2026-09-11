/**
 * S17-CHAT-UX2-FE-5 — drawer chat bên phải (SPEC-15 §9 CHAT-SCREEN-002 v2 · §22c CHAT-DEC-026).
 *
 * Thay `ChatDock` + `ChatDockWindow` (cửa sổ nổi góc dưới, S7-CHAT-FE-3). Lý do đổi hình thái, theo lời
 * owner: cửa sổ nổi chỉ mở được MỘT phòng và không mang theo danh sách, nên muốn đổi phòng là phải rời
 * trang đang làm sang `/chat`. Drawer chở cả hai: mở ra là danh sách + ô tìm + chip, bấm một phòng thì
 * hội thoại ĐẨY vào cùng khung (‹ để quay lại).
 *
 * Gắn ĐÚNG MỘT LẦN ở `ProtectedShell`, cạnh `useChatRealtime` — nhờ vậy drawer nhận tin ở MỌI route mà
 * KHÔNG mở kết nối thứ hai: dữ liệu đến từ `useChatStore`, còn kết nối `/ws` là singleton dùng chung
 * (`getAppSocket`). File này không import `socket.io` và không gọi `getAppSocket` — đó là bằng chứng đọc
 * được cho lời hứa "chung một kết nối".
 *
 * ⚠️ **KHÔNG render trên `/chat` và `/chat/…`.** Không phải để đỡ rối mắt — là bắt buộc kỹ thuật:
 * `useChatConversation` gọi `subscribeToRoom` lúc mount và `unsubscribeFromRoom` + `trimRoomHistory` lúc
 * unmount, mà store FE-1 KHÔNG đếm tham chiếu ở chiều ra. Hai instance cùng một phòng ⇒ instance nào
 * unmount trước sẽ (1) `clearInterval` lưới bù tin của instance còn sống — phòng đó ngừng cập nhật lúc
 * mất mạng, im lặng tuyệt đối; và (2) cắt lịch sử về 200 tin, vứt đúng phần người dùng vừa bấm "tải
 * thêm". Trang `/chat` đã là khung nhìn đầy đủ nên chồng drawer lên nó không được gì để đánh đổi.
 * Trạng thái drawer được GIỮ — rời `/chat` là nó hiện lại nguyên vẹn.
 *
 * Vì luật này, `ChatBadge` trên `/chat*` là **chỉ báo TĨNH** chứ không phải nút mở drawer — lệch có chủ
 * đích so với câu chữ «mở từ badge trên mọi trang» của SPEC-15 §9/§22c; SPEC đã được sửa kèm ở WO này.
 */
import { Suspense, lazy, useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useCan } from "@mediaos/web-core";
import { Skeleton, Sheet } from "@mediaos/ui";
import { useTranslation } from "react-i18next";
import { CHAT_PAIRS, CHAT_PATH } from "@/routes/chat/constants";
import { useChatStore } from "@/stores/chat.store";
import { useChatDockStore } from "./chat-dock.store";

/**
 * `lazy` chứ không import thẳng — và đây là đo được, không phải cảm tính.
 *
 * `ChatDrawer` gắn ở app shell nên nó nằm trong bundle KHỞI ĐỘNG của mọi người dùng, kể cả người chưa bao
 * giờ mở chat. Kéo thẳng `ChatDrawerBody` sẽ lôi theo cả `RoomListPanel` → `ConversationPanel` →
 * `MessageList` → `MessageComposer` → `chat-upload` vào đó.
 *
 * ⚠️ Ranh giới đặt ở THÂN, không ở cả drawer: VỎ (`Sheet` + khung + skeleton) phải vẽ được NGAY khung
 * hình đầu sau khi bấm badge. Để `Sheet` nằm bên trong chunk hoãn tải thì trên mạng chậm, bấm badge là
 * không thấy gì trong vài trăm mili-giây — đúng loại "nút bấm không phản hồi" mà cả WO này đang tránh.
 * `Sheet` vốn đã ở bundle shell (`ProtectedShell` import `@mediaos/ui`) nên vế này không tốn thêm byte.
 */
const ChatDrawerBody = lazy(() =>
  import("./drawer/ChatDrawerBody").then((m) => ({ default: m.ChatDrawerBody })),
);

export function ChatDrawer(): React.ReactElement | null {
  const { t } = useTranslation("chat");
  // ⚠️ MỌI hook gọi VÔ ĐIỀU KIỆN (mirror `useChatRealtime`): `useCan` đọc capabilities nạp sau
  // `/auth/me` nên lần render đầu gần như luôn `false`; thoát sớm phía trên hook sẽ làm số hook đổi giữa
  // các lần render ⇒ React ném "Rendered fewer hooks than expected" và trắng nguyên shell.
  const canAccessChat = useCan(CHAT_PAIRS.ACCESS.action, CHAT_PAIRS.ACCESS.resourceType);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const isOpen = useChatDockStore((s) => s.isOpen);
  const openRoomIds = useChatDockStore((s) => s.openRoomIds);
  const closeRoom = useChatDockStore((s) => s.closeRoom);
  const closeDrawer = useChatDockStore((s) => s.closeDrawer);
  const roomsById = useChatStore((s) => s.roomsById);
  const hasLoadedRooms = useChatStore((s) => s.hasLoadedRooms);

  /**
   * Phòng đã biến khỏi store (bị bớt / tự rời / lưu trữ khỏi rổ) ⇒ pop về DANH SÁCH.
   *
   * Không có vế này thì hội thoại "ma" đứng lại và `ConversationPanel` bên trong nện
   * `GET /chat/rooms/:id/messages` — nay trả 404 — theo nhịp lưới bù, vô thời hạn.
   *
   * Chốt `hasLoadedRooms`: TRƯỚC khi `GET /chat/rooms` trả về lần đầu, `roomsById` rỗng với MỌI phòng.
   * Chạy sớm là đá người dùng về danh sách ngay khung hình đầu sau mỗi lần tải lại trang — trông hệt như
   * "drawer tự quên", không ai lần ra nguyên nhân.
   *
   * Dùng `closeRoom` (không `closeDrawer`): drawer VẪN mở, chỉ hội thoại biến mất. Đóng cả drawer là lấy
   * đi cả danh sách phòng mà người dùng không làm gì sai.
   */
  useEffect(() => {
    if (!hasLoadedRooms) return;
    for (const roomId of openRoomIds) {
      if (roomsById[roomId] === undefined) closeRoom(roomId);
    }
  }, [openRoomIds, roomsById, hasLoadedRooms, closeRoom]);

  if (!canAccessChat) return null;
  // `startsWith` chứ không `===`: `/chat/…` (mở phòng theo URL) vẫn là trang chat. Mất vế này là mở lại
  // đúng cái cửa hai-instance mà docblock đầu file mô tả.
  if (pathname === CHAT_PATH || pathname.startsWith(`${CHAT_PATH}/`)) return null;
  if (!isOpen) return null;

  return (
    <Suspense
      fallback={
        // Vỏ THẬT + skeleton, không phải `null`: người dùng vừa bấm badge và phải thấy drawer trượt ra
        // ngay. Khung này có cùng bề rộng với khung thật nên không có cú nhảy layout khi thân tới.
        <Sheet
          open
          onClose={closeDrawer}
          title={t("drawer.title")}
          className="w-full max-w-none md:max-w-[400px]"
          bodyClassName="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3"
          closeOnBackdrop={false}
          data-testid="chat-drawer"
        >
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </Sheet>
      }
    >
      <ChatDrawerBody />
    </Suspense>
  );
}
