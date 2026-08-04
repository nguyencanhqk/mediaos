/**
 * S7-CHAT-FE-3 — MỘT cửa sổ hội thoại nổi (SPEC-15 §9 CHAT-SCREEN-002).
 *
 * Thanh tiêu đề (luôn hiện, kể cả khi thu nhỏ) + thân là `ConversationPanel` DÙNG LẠI nguyên khối của
 * FE-2. Không có bản rút gọn: mọi thứ trang `/chat` làm được — gửi lại tin lỗi, thu hồi, ghim, cuộn
 * ngược, banner mất kết nối — panel nổi phải làm được y hệt, và cách rẻ nhất để điều đó ĐÚNG MÃI là
 * dùng chung đúng một component.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronUp, Maximize2, Minus, X } from "lucide-react";
import { chatApi, chatKeys, useCan } from "@mediaos/web-core";
import { Button, cn } from "@mediaos/ui";
import { CHAT_PAIRS, CHAT_PATH } from "@/routes/chat/constants";
import { useChatStore } from "@/stores/chat.store";
import { ConversationPanel } from "./ConversationPanel";
import { roomDisplayName, initialsOf } from "./chat-format";
import { formatUnreadBadge } from "./chat-unread";
import { useChatDockStore } from "./chat-dock.store";

interface ChatDockWindowProps {
  roomId: string;
}

export function ChatDockWindow({ roomId }: ChatDockWindowProps): React.ReactElement | null {
  const { t } = useTranslation("chat");
  const navigate = useNavigate();
  const canViewRoom = useCan(CHAT_PAIRS.VIEW_ROOM.action, CHAT_PAIRS.VIEW_ROOM.resourceType);

  const room = useChatStore((s) => s.roomsById[roomId]);
  const myUserId = useChatStore((s) => s.myUserId);

  const isMinimized = useChatDockStore((s) => s.minimizedRoomIds[roomId] === true);
  const cachedName = useChatDockStore((s) => s.resolvedNames[roomId]);
  const setResolvedName = useChatDockStore((s) => s.setResolvedName);
  const toggleMinimize = useChatDockStore((s) => s.toggleMinimize);
  const closeRoom = useChatDockStore((s) => s.closeRoom);

  /**
   * Chi tiết phòng (`members[]` + `myRole`) — CÙNG `queryKey` với trang `/chat`.
   *
   * Trùng khoá là CHỦ ĐÍCH: react-query chia sẻ một entry cache, nên mở cùng phòng ở panel nổi rồi vào
   * trang không sinh request thứ hai. Khoá riêng sẽ tạo hai bản `members[]` lệch nhau và tên phòng
   * `direct` nhấp nháy giữa hai giá trị.
   *
   * `enabled: !isMinimized` — cửa sổ thu nhỏ chỉ cần cái tên (đã cache), không cần danh sách thành viên.
   */
  const detailQuery = useQuery({
    queryKey: chatKeys.rooms.detail(roomId),
    queryFn: () => chatApi.getRoom(roomId),
    enabled: canViewRoom && !isMinimized,
  });
  const detail = detailQuery.data;

  useEffect(() => {
    if (!detail || detail.roomType !== "direct") return;
    // Thu hẹp về đúng phần "phòng" trước khi dựng nhãn — mirror ChatPage. `roomDisplayName` chỉ đọc
    // name/roomType/roomCode nên không cần cả DTO.
    setResolvedName(
      roomId,
      roomDisplayName(detail, detail.members, myUserId, (code) =>
        t("rooms.directFallback", { code }),
      ),
    );
  }, [detail, myUserId, roomId, setResolvedName, t]);

  // Phòng đã biến khỏi store (bị bớt / tự rời) — `ChatDock` dọn bằng effect riêng; ở đây chỉ tránh vẽ
  // một khung rỗng trong khung hình xen giữa hai lần render.
  if (!room) return null;

  const title =
    cachedName ??
    roomDisplayName(room, detail?.members, myUserId, (code) => t("rooms.directFallback", { code }));
  const unreadLabel = formatUnreadBadge(room.unreadCount ?? 0);

  return (
    <section
      // `pointer-events-auto` bù lại `pointer-events-none` của container: chỉ CỬA SỔ ăn chuột, khoảng
      // trống quanh nó vẫn thuộc về trang nền (xem docblock ChatDock).
      className={cn(
        "pointer-events-auto flex w-80 flex-col overflow-hidden rounded-t-lg border border-border bg-card shadow-2xl",
        isMinimized ? "h-auto" : "h-[26rem]",
      )}
      aria-label={title}
      data-testid="chat-dock-window"
      data-room-id={roomId}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-2 py-1.5">
        {/* Bấm cả vùng tên để bung/thu — vùng bấm lớn, khớp thói quen từ mọi hộp chat khác. */}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted"
          onClick={() => toggleMinimize(roomId)}
          aria-expanded={!isMinimized}
          aria-label={
            isMinimized ? t("dock.expand", { name: title }) : t("dock.minimize", { name: title })
          }
        >
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
            aria-hidden="true"
          >
            {initialsOf(title)}
          </span>
          <span className="truncate text-sm font-medium">{title}</span>
          {unreadLabel !== "" && (
            <span
              className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground"
              aria-label={t("rooms.unreadAria", { count: room.unreadCount ?? 0 })}
            >
              {unreadLabel}
            </span>
          )}
        </button>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("dock.openFullScreen")}
          title={t("dock.openFullScreen")}
          onClick={() => void navigate({ to: CHAT_PATH as "/" })}
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={isMinimized ? t("dock.expandShort") : t("dock.minimizeShort")}
          onClick={() => toggleMinimize(roomId)}
        >
          {isMinimized ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("dock.close")}
          onClick={() => closeRoom(roomId)}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </header>

      {/* Thu nhỏ ⇒ ConversationPanel UNMOUNT ⇒ `unsubscribeFromRoom` + `trimRoomHistory` chạy đúng như
          khi rời phòng (trả RAM về trần sống). Badge trên thanh tiêu đề VẪN chạy vì nó đọc
          `roomsById[roomId].unreadCount` — thứ `useChatRealtime` ở shell giữ tươi độc lập với việc
          phòng có đang mở hay không. */}
      {!isMinimized && (
        <div className="flex min-h-0 flex-1 flex-col">
          <ConversationPanel
            room={room}
            members={detail?.members ?? []}
            myRole={detail?.myRole ?? null}
            showHeader={false}
          />
        </div>
      )}
    </section>
  );
}
