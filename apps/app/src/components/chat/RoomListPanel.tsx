/**
 * S7-CHAT-FE-2 — cột trái: danh sách phòng CỦA TÔI + lối vào tạo phòng (SPEC-15 §9 CHAT-SCREEN-001).
 *
 * Nguồn dữ liệu là `useChatStore`, KHÔNG phải một `useQuery` thứ hai: `useChatRealtime` gắn ở
 * `ProtectedShell` đã nạp `GET /chat/rooms` và `syncRoomList` sẵn cho toàn app. Gọi lại ở đây là hai
 * bản sao cùng dữ liệu, và bản nào tươi hơn thì tuỳ thứ tự response — đúng loại lệch không tái hiện được.
 *
 * Rổ **đã lưu trữ** thì phải hỏi riêng: `listRooms()` không tham số bị service ép `archived: false`, nên
 * phòng đã lưu trữ KHÔNG có trong rổ mặc định (docblock `syncRoomList`).
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Archive, MessageSquarePlus, Search } from "lucide-react";
import { chatApi, chatKeys, useCan } from "@mediaos/web-core";
import { Badge, Button, Input, Skeleton, cn } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";
import { CHAT_PAIRS } from "@/routes/chat/constants";
import { formatClock } from "./chat-format";

interface RoomListPanelProps {
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
  onCreateRoom: () => void;
  /** Tên đã dựng của phòng `direct` (cache theo `roomId` ở trang) — vắng thì dùng nhãn mã phòng. */
  resolvedNames: Readonly<Record<string, string>>;
  isBootstrapping: boolean;
}

export function RoomListPanel({
  selectedRoomId,
  onSelectRoom,
  onCreateRoom,
  resolvedNames,
  isBootstrapping,
}: RoomListPanelProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const canCreate = useCan(CHAT_PAIRS.CREATE_ROOM.action, CHAT_PAIRS.CREATE_ROOM.resourceType);

  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const roomsById = useChatStore((s) => s.roomsById);
  const roomOrder = useChatStore((s) => s.roomOrder);
  const syncRoomList = useChatStore((s) => s.syncRoomList);

  const archivedQuery = useQuery({
    queryKey: chatKeys.rooms.list({ archived: true }),
    queryFn: () => chatApi.listRooms({ archived: true }),
    enabled: showArchived,
  });
  const archivedRooms = archivedQuery.data;

  useEffect(() => {
    // `true` = ĐÚNG rổ đã truy vấn. Truyền `false` ở đây sẽ gỡ sạch phòng chưa lưu trữ khỏi store chỉ
    // vì payload này không chứa chúng (docblock `syncRoomList`).
    if (archivedRooms) syncRoomList(archivedRooms, true);
  }, [archivedRooms, syncRoomList]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return roomOrder
      .map((id) => roomsById[id])
      .filter((room): room is ChatRoomDto => room !== undefined)
      .filter((room) => (room.isArchived ?? false) === showArchived)
      .filter((room) => {
        if (needle.length === 0) return true;
        // Lọc trên TÊN/MÃ phòng ở client. Tìm theo NỘI DUNG tin là `GET /chat/search` — màn riêng,
        // thuộc S7-CHAT-FE-4; trộn hai thứ vào một ô làm người dùng tưởng đã tìm hết.
        const label = (resolvedNames[room.id] ?? room.name ?? "").toLowerCase();
        return label.includes(needle) || room.roomCode.toLowerCase().includes(needle);
      });
  }, [query, resolvedNames, roomOrder, roomsById, showArchived]);

  return (
    <aside
      className="flex h-full w-72 shrink-0 flex-col border-r border-border"
      aria-label={t("rooms.heading")}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <h2 className="flex-1 text-sm font-semibold">{t("rooms.heading")}</h2>
        {canCreate && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("rooms.newButtonAria")}
            onClick={onCreateRoom}
          >
            <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className="space-y-2 border-b border-border px-3 py-2">
        <div className="relative">
          <Search
            className="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("rooms.searchPlaceholder")}
            aria-label={t("rooms.searchPlaceholder")}
            className="h-8 pl-7 text-sm"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-start gap-2 text-xs"
          aria-pressed={showArchived}
          onClick={() => setShowArchived((v) => !v)}
        >
          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
          {showArchived ? t("rooms.showActive") : t("rooms.showArchived")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isBootstrapping || (showArchived && archivedQuery.isLoading) ? (
          <div className="space-y-2 p-3" aria-busy="true" data-testid="chat-rooms-loading">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {query.trim().length > 0
              ? t("rooms.noSearchResult", { query: query.trim() })
              : showArchived
                ? t("rooms.emptyArchived")
                : `${t("rooms.empty")} ${canCreate ? t("rooms.emptyHint") : ""}`.trim()}
          </p>
        ) : (
          <ul>
            {visible.map((room) => {
              const label =
                resolvedNames[room.id] ??
                room.name ??
                t("rooms.directFallback", { code: room.roomCode });
              const unread = room.unreadCount ?? 0;
              return (
                <li key={room.id}>
                  <button
                    type="button"
                    onClick={() => onSelectRoom(room.id)}
                    aria-current={room.id === selectedRoomId ? "true" : undefined}
                    data-testid="chat-room-item"
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent",
                      room.id === selectedRoomId && "bg-accent",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-sm",
                            unread > 0 && "font-semibold",
                          )}
                        >
                          {label}
                        </span>
                        {room.lastMessageAt && (
                          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                            {formatClock(room.lastMessageAt)}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {t(`rooms.types.${room.roomType}`)}
                        {room.isArchived ? ` · ${t("rooms.archivedBadge")}` : ""}
                        {!room.lastMessageAt ? ` · ${t("rooms.noMessageYet")}` : ""}
                      </p>
                    </div>
                    {unread > 0 && (
                      <Badge
                        className="shrink-0 tabular-nums"
                        aria-label={t("rooms.unreadAria", { count: unread })}
                      >
                        {unread > 99 ? t("rooms.unreadOverflow") : unread}
                      </Badge>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
