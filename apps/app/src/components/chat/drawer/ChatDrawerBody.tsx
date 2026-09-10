/**
 * S17-CHAT-UX2-FE-5 — THÂN drawer chat: danh sách phòng ↔ hội thoại (SPEC-15 §9 CHAT-SCREEN-002 v2).
 *
 * Tách khỏi `ChatDrawer` để nằm trong chunk hoãn tải — xem docblock `lazy()` ở file đó. Vỏ `Sheet` ở
 * ĐÂY (không ở `ChatDrawer`) vì tiêu đề, nút ‹ và nút ⤢ đều đổi theo chế độ đang hiện; `ChatDrawer` chỉ
 * dựng một vỏ y hệt làm `Suspense fallback`.
 *
 * Hai chế độ, KHÔNG phải hai route: `openRoomIds` rỗng ⇒ danh sách; có phần tử ⇒ hội thoại ĐẨY lên trên
 * (‹ để quay lại). Trạng thái nằm ở `chat-dock.store`, nên đóng drawer rồi mở lại là về đúng chỗ đang
 * đọc dở.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Maximize2, MessagesSquare } from "lucide-react";
import { useCan } from "@mediaos/web-core";
import { Button, EmptyState, Sheet } from "@mediaos/ui";
import { CHAT_PAIRS, CHAT_PATH } from "@/routes/chat/constants";
import { useChatStore } from "@/stores/chat.store";
import { useChatDockStore } from "../chat-dock.store";
import { RoomListPanel } from "../RoomListPanel";
import { roomDisplayName } from "../chat-format";
import { DEFAULT_ROOM_FILTER_CHIP, type RoomFilterChip } from "../room-list-filter";
import { ChatDrawerConversation } from "./ChatDrawerConversation";

export function ChatDrawerBody(): React.ReactElement {
  const { t } = useTranslation("chat");
  const navigate = useNavigate();

  /**
   * Cổng ĐỌC — cùng cặp với trang `/chat` (`ChatPage` gate bằng `view:chat-room`), KHÔNG phải
   * `access:chat`.
   *
   * `access:chat` là cổng ĐIỀU HƯỚNG (`constants.ts` ghi rõ). Drawer bày đúng bề mặt đọc của `/chat` —
   * preview tin cuối, số chưa đọc, nội dung hội thoại — nên gác nó bằng cặp yếu hơn là để cùng một dữ
   * liệu có hai cổng khác nhau tuỳ đường vào.
   *
   * Không phải hồi quy so với dropdown cũ: `useChatRealtime` đã tự gate `view:chat-room`, nên người chỉ
   * có `access:chat` trước nay thấy một dropdown RỖNG (store không bao giờ được nạp). Đổi thành
   * `EmptyState` là nói thật thay vì để trống không lời giải thích.
   */
  const canViewRoom = useCan(CHAT_PAIRS.VIEW_ROOM.action, CHAT_PAIRS.VIEW_ROOM.resourceType);

  const openRoomIds = useChatDockStore((s) => s.openRoomIds);
  const openRoom = useChatDockStore((s) => s.openRoom);
  const closeRoom = useChatDockStore((s) => s.closeRoom);
  const closeDrawer = useChatDockStore((s) => s.closeDrawer);

  const roomsById = useChatStore((s) => s.roomsById);
  const myUserId = useChatStore((s) => s.myUserId);
  const hasLoadedRooms = useChatStore((s) => s.hasLoadedRooms);

  /**
   * Câu lọc + chip giữ Ở ĐÂY chứ không trong `RoomListPanel`.
   *
   * Bấm một phòng là đẩy sang hội thoại và `RoomListPanel` UNMOUNT. Để state trong panel thì mỗi lần
   * liếc một phòng rồi bấm ‹ là mất sạch câu vừa gõ và chip vừa chọn — hỏng đúng thứ mà "trên = tìm +
   * chip" vừa hứa.
   */
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<RoomFilterChip>(DEFAULT_ROOM_FILTER_CHIP);

  /** Phòng đang hiện ở tiêu đề = mở gần đây nhất (cuối mảng — hợp đồng của `chat-dock.store`). */
  const activeRoomId = openRoomIds.length > 0 ? openRoomIds[openRoomIds.length - 1] : null;
  const activeRoom = activeRoomId !== null ? roomsById[activeRoomId] : undefined;
  const activeLabel =
    activeRoom === undefined
      ? null
      : roomDisplayName(activeRoom, undefined, myUserId, (code) =>
          t("rooms.directFallback", { code }),
        );

  const isConversationMode = activeRoomId !== null;

  return (
    <Sheet
      open
      onClose={closeDrawer}
      title={activeLabel ?? t("drawer.title")}
      description={
        isConversationMode && activeRoom !== undefined
          ? t(`rooms.types.${activeRoom.roomType}`)
          : undefined
      }
      leading={
        isConversationMode ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label={t("conversation.back")}
            data-testid="chat-drawer-back"
            onClick={() => closeRoom(activeRoomId)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : undefined
      }
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("drawer.openFullPage")}
          title={t("drawer.openFullPage")}
          data-testid="chat-drawer-expand"
          onClick={() => {
            /*
             * Đóng drawer khi đi sang `/chat`.
             *
             * KHÔNG phải vì lý do kỹ thuật — `ChatDrawer` đã `return null` trên `/chat*` nên một `isOpen`
             * còn bật ở đó không dựng instance nào. Lý do là nhất quán: bỏ vế này thì lúc người dùng rời
             * `/chat` sang một trang khác, drawer tự bung ra dù họ chưa hề mở nó.
             */
            closeDrawer();
            void navigate({ to: CHAT_PATH as "/" });
          }}
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      }
      // Dưới `md`: toàn màn (CHAT-DEC-026). `max-w-none` cần thiết vì `Sheet` mặc định `max-w-2xl`.
      className="w-full max-w-none md:max-w-[400px]"
      /*
       * `p-0 overflow-hidden`: cả `RoomListPanel` lẫn `ConversationPanel` đều đã có vùng cuộn riêng và
       * cần chạm mép (dòng phòng 56px, bong bóng tin). Để nguyên `px-5 py-4 overflow-y-auto` mặc định là
       * hai thanh cuộn lồng nhau và ô soạn tin trôi khỏi đáy khung.
       */
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
      /*
       * Bấm ra nền KHÔNG đóng — khác mặc định của `Sheet`.
       *
       * `MessageComposer` giữ nháp bằng state cục bộ, mất khi unmount. Cửa sổ nổi cũ không có nền phủ nên
       * không có đường này; thêm drawer mà giữ mặc định là thêm một cú click trượt tay xoá sạch tin đang
       * gõ. Esc và ✕ vẫn đóng (ngang cửa sổ nổi cũ), và Esc còn được `data-escape-claim` che khi đang
       * soạn câu trả lời.
       */
      closeOnBackdrop={false}
      data-testid="chat-drawer"
    >
      {!canViewRoom ? (
        // §14 "không có quyền": ẩn nội dung, không hard-code role. Cổng thật vẫn ở server.
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={MessagesSquare}
            title={t("forbidden.title")}
            description={t("forbidden.body")}
          />
        </div>
      ) : !isConversationMode ? (
        <RoomListPanel
          variant="drawer"
          selectedRoomId={null}
          onSelectRoom={openRoom}
          isBootstrapping={!hasLoadedRooms}
          query={query}
          onQueryChange={setQuery}
          chip={chip}
          onChipChange={setChip}
          /*
           * `onOpenSearch` và `onCreateRoom` CỐ Ý không truyền ⇒ hai nút biến mất.
           *
           * Drawer không có cột thứ hai để mở CHAT-SCREEN-005 vào, và hộp thoại tạo phòng cần chỗ rộng
           * hơn 400px để chọn thành viên. Cả hai đã có đủ ở `/chat`, cách đúng một cú ⤢ — render nút ở
           * đây rồi không làm gì mới là thứ người dùng đọc ra là "hỏng".
           */
        />
      ) : (
        /*
         * `.map` toàn mảng chứ không đọc mỗi phần tử cuối — CHỦ ĐÍCH.
         *
         * Ở trần hiện tại (`MAX_DOCK_WINDOWS === 1`) hai cách cho ra cùng một DOM. Khác nhau ở chỗ đo
         * được: đọc-phần-tử-cuối làm cho "chỉ có đúng một hội thoại" đúng NHỜ CÁCH VIẾT ở đây, nên bài
         * test đếm node sẽ xanh kể cả khi trần ở store bị nới — một bài test không thể đỏ. `.map` biến
         * DOM thành ảnh chiếu trung thực của store: trần là chính sách DUY NHẤT, đặt đúng một chỗ.
         */
        openRoomIds.map((roomId) => <ChatDrawerConversation key={roomId} roomId={roomId} />)
      )}
    </Sheet>
  );
}
