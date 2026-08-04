/**
 * S7-CHAT-FE-3 — badge tổng chưa đọc trên header + lối vào nhanh (SPEC-15 §9 CHAT-SCREEN-006).
 *
 * Mirror `NotificationBadge` về hình dạng, KHÁC ở nguồn số: NOTI có `GET /notifications/unread-count`
 * nên nó `useQuery` + poll 30 giây; CHAT **không có** endpoint tương ứng (soát toàn bộ
 * `apps/api/src/chat/*.controller.ts`) và cũng không cần — `useChatRealtime` ở shell đã giữ
 * `unreadCount` từng phòng tươi qua `chat:message` / `chat:read`, nên tổng chỉ là một phép cộng thuần
 * trên store. Không request, không poll, cập nhật ngay khi sự kiện tới.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { useCan } from "@mediaos/web-core";
import { Button, cn } from "@mediaos/ui";
import { CHAT_PAIRS, CHAT_PATH } from "@/routes/chat/constants";
import { useChatStore } from "@/stores/chat.store";
import { roomDisplayName } from "./chat-format";
import { formatUnreadBadge, pickDropdownRooms, totalUnreadCount } from "./chat-unread";
import { useChatDockStore } from "./chat-dock.store";
import { useHasDockViewport } from "./use-dock-viewport";

/** Số dòng tối đa trong dropdown — quá dài thì nó thành một danh sách phòng thứ hai, việc của `/chat`. */
const DROPDOWN_ROOM_LIMIT = 8;

export function ChatBadge(): React.ReactElement | null {
  const { t } = useTranslation("chat");
  const navigate = useNavigate();
  const [isOpen, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const canAccessChat = useCan(CHAT_PAIRS.ACCESS.action, CHAT_PAIRS.ACCESS.resourceType);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hasDockViewport = useHasDockViewport();

  const roomsById = useChatStore((s) => s.roomsById);
  const roomOrder = useChatStore((s) => s.roomOrder);
  const myUserId = useChatStore((s) => s.myUserId);
  const openRoom = useChatDockStore((s) => s.openRoom);
  const resolvedNames = useChatDockStore((s) => s.resolvedNames);

  useEffect(() => {
    if (!isOpen) return;
    function onClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [isOpen]);

  // Đổi route ⇒ đóng dropdown. Không đóng thì nó lơ lửng trên trang mới, và trên `/chat` nó còn che đúng
  // cột danh sách phòng mà nó vừa điều hướng tới.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!canAccessChat) return null;

  const total = totalUnreadCount(roomsById);
  const label = formatUnreadBadge(total);
  /**
   * Trên `/chat`, badge là CHỈ BÁO TĨNH chứ không phải nút mở dropdown.
   *
   * Panel nổi không render ở đó (xem docblock `ChatDock`), nên "bấm một phòng trong dropdown" sẽ không
   * làm gì NHÌN THẤY ĐƯỢC — một nút chết. Mà mọi thứ dropdown mời chào (danh sách phòng, số chưa đọc,
   * mở hội thoại) đã có sẵn ngay bên dưới, to hơn và đầy đủ hơn, ở cột trái của trang.
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

  const rooms = pickDropdownRooms(roomsById, roomOrder, DROPDOWN_ROOM_LIMIT);

  /**
   * Chọn một phòng trong dropdown.
   *
   * Màn hình đủ rộng ⇒ mở ở panel nổi. HẸP hơn `md` ⇒ `ChatDock` bị ẩn (`hidden md:flex`), nên
   * `openRoom()` ở đó là một nút bấm KHÔNG có tác dụng nhìn thấy được — điều hướng sang `/chat`, nơi
   * khung nhìn full-screen mới là thứ dùng được trên điện thoại.
   */
  function selectRoom(roomId: string): void {
    setOpen(false);
    if (hasDockViewport) {
      openRoom(roomId);
      return;
    }
    void navigate({ to: CHAT_PATH as "/" });
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="relative"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("badge.ariaLabel", { count: total })}
        aria-expanded={isOpen}
        data-testid="chat-badge"
      >
        <MessagesSquare className="size-4" aria-hidden="true" />
        {badgeDot}
      </Button>

      {isOpen && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
          role="menu"
          data-testid="chat-badge-dropdown"
        >
          <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
            {t("badge.heading")}
          </p>

          {rooms.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {t("rooms.empty")}
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {rooms.map((room) => {
                const unread = room.unreadCount ?? 0;
                const name =
                  resolvedNames[room.id] ??
                  roomDisplayName(room, undefined, myUserId, (code) =>
                    t("rooms.directFallback", { code }),
                  );
                return (
                  <li key={room.id}>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent"
                      onClick={() => selectRoom(room.id)}
                    >
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm",
                          unread > 0 && "font-semibold",
                        )}
                      >
                        {name}
                      </span>
                      {unread > 0 && (
                        <span
                          className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground"
                          aria-label={t("rooms.unreadAria", { count: unread })}
                        >
                          {formatUnreadBadge(unread)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            role="menuitem"
            className="w-full border-t border-border px-3 py-2 text-center text-xs font-medium text-primary transition-colors hover:bg-accent"
            onClick={() => {
              setOpen(false);
              void navigate({ to: CHAT_PATH as "/" });
            }}
          >
            {t("badge.openFullPage")}
          </button>
        </div>
      )}
    </div>
  );
}
