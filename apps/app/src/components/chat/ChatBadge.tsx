/**
 * S7-CHAT-FE-3 — badge tổng chưa đọc trên header + lối vào chat (SPEC-15 §9 CHAT-SCREEN-006).
 *
 * Mirror `NotificationBadge` về hình dạng, KHÁC ở nguồn số: NOTI có `GET /notifications/unread-count`
 * nên nó `useQuery` + poll 30 giây; CHAT **không có** endpoint tương ứng (soát toàn bộ
 * `apps/api/src/chat/*.controller.ts`) và cũng không cần — `useChatRealtime` ở shell đã giữ
 * `unreadCount` từng phòng tươi qua `chat:message` / `chat:read`, nên tổng chỉ là một phép cộng thuần
 * trên store. Không request, không poll, cập nhật ngay khi sự kiện tới.
 *
 * ─── S17-CHAT-UX2-FE-5 (v2) ────────────────────────────────────────────────────────────────────────
 * **Dropdown đã GỠ.** Bấm badge nay mở thẳng `ChatDrawer` (CHAT-DEC-026). Dropdown là "một danh sách
 * phòng thứ hai" — thứ mà chính docblock của nó cảnh báo — và drawer nay LÀ danh sách đó, đầy đủ hơn
 * (ô tìm, chip lọc, preview tin cuối, menu từng phòng). Giữ cả hai là hai đường vào cùng một việc và
 * hai chỗ phải sửa mỗi lần luật lọc phòng đổi.
 *
 * Cũng gỡ luôn nhánh «màn hẹp ⇒ điều hướng `/chat`»: drawer chiếm TOÀN MÀN dưới `md`, nên không còn bề
 * rộng nào mà nó không dùng được. `useHasDockViewport` chết theo (không còn consumer).
 */
import { useTranslation } from "react-i18next";
import { useRouterState } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { useCan } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import { CHAT_PAIRS, CHAT_PATH } from "@/routes/chat/constants";
import { useChatStore } from "@/stores/chat.store";
import { formatUnreadBadge, totalUnreadCount } from "./chat-unread";
import { useChatDockStore } from "./chat-dock.store";

export function ChatBadge(): React.ReactElement | null {
  const { t } = useTranslation("chat");

  const canAccessChat = useCan(CHAT_PAIRS.ACCESS.action, CHAT_PAIRS.ACCESS.resourceType);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const roomsById = useChatStore((s) => s.roomsById);
  const toggleDrawer = useChatDockStore((s) => s.toggleDrawer);
  const isDrawerOpen = useChatDockStore((s) => s.isOpen);

  if (!canAccessChat) return null;

  const total = totalUnreadCount(roomsById);
  const label = formatUnreadBadge(total);
  /**
   * Trên `/chat*`, badge là CHỈ BÁO TĨNH chứ không phải nút mở drawer.
   *
   * `ChatDrawer` không render ở đó (xem docblock của nó: hai instance `useChatConversation` cùng một
   * phòng sẽ giết lưới bù tin của nhau), nên một nút "mở drawer" tại đây sẽ không làm gì NHÌN THẤY
   * ĐƯỢC — nút chết. Mà mọi thứ drawer mời chào đã có sẵn ngay bên dưới, to hơn và đầy đủ hơn.
   *
   * Đây là chỗ DUY NHẤT lệch khỏi câu chữ «mở từ badge trên mọi trang» của SPEC-15 §9/§22c; SPEC đã
   * được sửa kèm ở S17-CHAT-UX2-FE-5 để ghi rõ ngoại lệ này.
   */
  const isOnChatPage = pathname === CHAT_PATH || pathname.startsWith(`${CHAT_PATH}/`);

  const badgeDot =
    label === "" ? null : (
      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
        {label}
      </span>
    );

  if (isOnChatPage) {
    return (
      <span
        className="relative flex h-9 w-9 items-center justify-center text-chrome-foreground/80"
        aria-label={t("badge.totalUnread", { count: total })}
        data-testid="chat-badge-static"
      >
        <MessagesSquare className="size-4" aria-hidden="true" />
        {badgeDot}
      </span>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="relative"
      onClick={toggleDrawer}
      aria-label={t("badge.ariaLabel", { count: total })}
      aria-expanded={isDrawerOpen}
      data-testid="chat-badge"
    >
      <MessagesSquare className="size-4" aria-hidden="true" />
      {badgeDot}
    </Button>
  );
}
