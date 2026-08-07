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
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
// `Filter` cho ô LỌC PHÒNG, `Search` cho lối vào tìm theo NỘI DUNG TIN (CHAT-SCREEN-005). Hai biểu
// tượng kính lúp cạnh nhau là lời mời gõ nhầm ô — chính hiểu nhầm mà docblock `visible` cảnh báo.
import {
  Archive,
  BellOff,
  ChevronDown,
  ChevronRight,
  Filter,
  MessageSquarePlus,
  Pin,
  Search,
} from "lucide-react";
import { chatApi, chatKeys, useAuthStore, useCan } from "@mediaos/web-core";
import { Badge, Button, Input, Skeleton, cn } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";
import { CHAT_PAIRS } from "@/routes/chat/constants";
import { formatClock } from "./chat-format";
import { RoomAvatar } from "./RoomAvatar";
import { RoomRowMenu } from "./RoomRowMenu";
import {
  isRoomMuted,
  isRoomPinned,
  isRoomUnreadLooking,
  type MutePresetKey,
} from "./chat-room-prefs";
import { useRoomPrefs } from "./use-room-prefs";
import {
  buildRoomSections,
  collapsedStorageKey,
  readCollapsedSections,
  writeCollapsedSections,
} from "./room-list-sections";

interface RoomListPanelProps {
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
  onCreateRoom: () => void;
  /** S7-CHAT-FE-4 — mở CHAT-SCREEN-005 (tìm theo NỘI DUNG tin), khác hẳn ô lọc phòng bên dưới. */
  onOpenSearch: () => void;
  /** Tên đã dựng của phòng `direct` (cache theo `roomId` ở trang) — vắng thì dùng nhãn mã phòng. */
  resolvedNames: Readonly<Record<string, string>>;
  isBootstrapping: boolean;
}

export function RoomListPanel({
  selectedRoomId,
  onSelectRoom,
  onCreateRoom,
  onOpenSearch,
  resolvedNames,
  isBootstrapping,
}: RoomListPanelProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const canCreate = useCan(CHAT_PAIRS.CREATE_ROOM.action, CHAT_PAIRS.CREATE_ROOM.resourceType);
  // S8-CHAT-UX-FE-2 — cổng của DUY NHẤT mục "Lưu trữ phòng" trong menu. Ba mục còn lại (ghim · tắt
  // thông báo · đánh dấu chưa đọc) là tuỳ chọn CÁ NHÂN và không hỏi cặp quản trị nào — xem `useRoomPrefs`.
  const canArchive = useCan(CHAT_PAIRS.ARCHIVE_ROOM.action, CHAT_PAIRS.ARCHIVE_ROOM.resourceType);

  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  /** Menu ĐANG mở của phòng nào — một tại một thời điểm (mở cái thứ hai tự đóng cái trước). */
  const [openMenuRoomId, setOpenMenuRoomId] = useState<string | null>(null);
  /**
   * Lỗi của một THAO TÁC trong menu, không phải của khung nhìn — nên nó nằm ở đầu cột dưới dạng dải
   * `role="alert"`, không thay thế danh sách. Nuốt câm là điều duy nhất không được phép: người dùng vừa
   * thấy phòng nhảy lên mục "Đã ghim" rồi nhảy về, mà không có chữ nào nói vì sao.
   */
  const [actionError, setActionError] = useState<string | null>(null);

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

  // ─── S8-CHAT-UX-FE-1: chia mục theo loại phòng (CHAT-DEC-013) ───
  // S8-CHAT-UX-FE-2 — vị từ ghim THẬT đã là mặc định của `buildRoomSections` (`pinnedAt` từ BE-1). Mục
  // "Đã ghim" xuất hiện ngay khi có ít nhất một phòng ghim, và ghim THẮNG loại phòng (mỗi phòng đúng
  // một node — memory `duplicate-sibling-key-leaks-dom-node`).
  const sections = useMemo(() => buildRoomSections(visible), [visible]);

  // Destructure NGAY: `useRoomPrefs` trả object mới mỗi lần render, còn `mutate` của React Query thì ổn
  // định. Để `[prefs]` trong dependency của `useCallback` bên dưới là một `useCallback` không bao giờ
  // ghi nhớ được gì — trông như có tối ưu mà thực ra không.
  const {
    pin: pinRoom,
    mute: muteRoom,
    markUnread: markRoomUnread,
    archive: archiveRoom,
    isBusy,
  } = useRoomPrefs(setActionError);

  /**
   * Ảnh chụp giá trị TRƯỚC dựng ngay tại điểm bấm rồi đưa vào `mutate` — KHÔNG đọc lại store trong
   * `mutationFn`/`onError` (memory `react-query-v5-stale-mutationfn-closure`): closure ở đó giữ ảnh chụp
   * của lần render tạo ra nó, nên hoàn nguyên sẽ ghi lại một giá trị đã lỗi thời.
   */
  const togglePin = useCallback(
    (room: ChatRoomDto) => {
      setActionError(null);
      pinRoom({ roomId: room.id, pin: !isRoomPinned(room), before: { pinnedAt: room.pinnedAt } });
    },
    [pinRoom],
  );

  const mute = useCallback(
    (room: ChatRoomDto, preset: MutePresetKey | null) => {
      setActionError(null);
      muteRoom({ roomId: room.id, preset, before: { mutedUntil: room.mutedUntil } });
    },
    [muteRoom],
  );

  const markUnread = useCallback(
    (room: ChatRoomDto) => {
      setActionError(null);
      markRoomUnread({ roomId: room.id, before: { markedUnreadAt: room.markedUnreadAt } });
    },
    [markRoomUnread],
  );

  const archive = useCallback(
    (room: ChatRoomDto) => {
      setActionError(null);
      archiveRoom({ roomId: room.id });
    },
    [archiveRoom],
  );

  const userId = useAuthStore((s) => s.user?.id ?? null);
  const storageKey = useMemo(() => collapsedStorageKey(userId), [userId]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    readCollapsedSections(storageKey),
  );

  // Đổi người dùng trong CÙNG tab (đăng xuất → người khác đăng nhập) phải nạp bố cục của người đó,
  // không giữ lại bố cục người trước.
  useEffect(() => {
    setCollapsed(readCollapsedSections(storageKey));
  }, [storageKey]);

  const toggleSection = useCallback(
    (key: string) => {
      const next = { ...collapsed, [key]: !collapsed[key] };
      setCollapsed(next);
      writeCollapsedSections(storageKey, next);
    },
    [collapsed, storageKey],
  );

  // Đang lọc thì MỞ HẾT: người dùng gõ để TÌM, mà kết quả lại nằm trong một mục họ đã thu từ tuần
  // trước thì màn hình báo "không có gì" trong khi phòng vẫn ở đó. Trạng thái thu KHÔNG bị ghi đè —
  // chỉ tạm bỏ qua khi có từ khoá.
  const isFiltering = query.trim().length > 0;

  const sectionLabel = useCallback(
    (key: string): string =>
      key === "pinned"
        ? t("rooms.sections.pinned")
        : t(`rooms.types.${key}`, { defaultValue: key }),
    [t],
  );

  return (
    <aside
      className="flex h-full w-72 shrink-0 flex-col border-r border-border"
      aria-label={t("rooms.heading")}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <h2 className="flex-1 text-sm font-semibold">{t("rooms.heading")}</h2>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("search.openAria")}
          onClick={onOpenSearch}
          data-testid="chat-open-search"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </Button>
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
          <Filter
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

      {actionError !== null && (
        <div
          className="flex items-start gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2"
          role="alert"
        >
          <p className="min-w-0 flex-1 text-xs text-destructive">{actionError}</p>
          <button
            type="button"
            className="shrink-0 text-xs text-muted-foreground underline"
            onClick={() => setActionError(null)}
          >
            {t("search.dismiss")}
          </button>
        </div>
      )}

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
          sections.map((section) => {
            const label = sectionLabel(section.key);
            const isCollapsed = !isFiltering && (collapsed[section.key] ?? false);
            return (
              <section key={section.key} data-testid="chat-room-section" data-section={section.key}>
                <button
                  type="button"
                  onClick={() => toggleSection(section.key)}
                  aria-expanded={!isCollapsed}
                  aria-label={t(
                    isCollapsed ? "rooms.sections.expandAria" : "rooms.sections.collapseAria",
                    { name: label },
                  )}
                  data-testid="chat-room-section-toggle"
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-accent/50"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {label}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {section.rooms.length}
                  </span>
                  {/* Chỉ khi ĐANG THU: mục mở đã tự hiện badge trên từng dòng, thêm nữa là nhiễu. Thu
                      lại mà mất dấu tin chưa đọc mới là lỗi — người dùng không có cách nào biết. */}
                  {isCollapsed && section.unreadTotal > 0 && (
                    <Badge
                      className="shrink-0 tabular-nums"
                      aria-label={t("rooms.sections.unreadAria", {
                        count: section.unreadTotal,
                        name: label,
                      })}
                    >
                      {section.unreadTotal > 99 ? t("rooms.unreadOverflow") : section.unreadTotal}
                    </Badge>
                  )}
                </button>

                {!isCollapsed && (
                  <ul>
                    {section.rooms.map((room) => (
                      <RoomRow
                        key={room.id}
                        room={room}
                        label={
                          resolvedNames[room.id] ??
                          room.name ??
                          t("rooms.directFallback", { code: room.roomCode })
                        }
                        isSelected={room.id === selectedRoomId}
                        onSelect={onSelectRoom}
                        isMenuOpen={openMenuRoomId === room.id}
                        onMenuOpenChange={(open) => setOpenMenuRoomId(open ? room.id : null)}
                        canArchive={canArchive}
                        isBusy={isBusy}
                        onTogglePin={togglePin}
                        onMute={mute}
                        onMarkUnread={markUnread}
                        onArchive={archive}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </div>
    </aside>
  );
}

interface RoomRowProps {
  room: ChatRoomDto;
  /** Nhãn ĐÃ dựng ở cấp trên (phòng `direct` không có `name` nên nhãn là dẫn xuất). */
  label: string;
  isSelected: boolean;
  onSelect: (roomId: string) => void;
  // ── S8-CHAT-UX-FE-2 — menu ngữ cảnh. Trạng thái mở nằm ở CẤP TRÊN (một menu tại một thời điểm). ──
  isMenuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  canArchive: boolean;
  isBusy: boolean;
  onTogglePin: (room: ChatRoomDto) => void;
  onMute: (room: ChatRoomDto, preset: MutePresetKey | null) => void;
  onMarkUnread: (room: ChatRoomDto) => void;
  onArchive: (room: ChatRoomDto) => void;
}

/**
 * S8-CHAT-UX-FE-1 — tách khỏi `RoomListPanel` khi thân hàm phình vì vòng lặp lồng (mục → phòng).
 *
 * S8-CHAT-UX-FE-2 đổi CẤU TRÚC hàng: trước đây cả dòng là MỘT `<button>`. Nút `…` của menu không thể
 * nằm trong đó (`<button>` lồng `<button>` — HTML không hợp lệ, hành vi bấm/hội tụ không xác định), nên
 * hàng thành một `<div>` flex với hai anh em: nút chọn phòng (phủ phần còn lại) và nút mở menu.
 * `data-testid="chat-room-item"` GIỮ NGUYÊN trên nút chọn — nó là thứ mọi test đang bấm để chọn phòng.
 */
function RoomRow({
  room,
  label,
  isSelected,
  onSelect,
  isMenuOpen,
  onMenuOpenChange,
  canArchive,
  isBusy,
  onTogglePin,
  onMute,
  onMarkUnread,
  onArchive,
}: RoomRowProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const unread = room.unreadCount ?? 0;
  const muted = isRoomMuted(room);
  // Đậm khi CÓ tin chưa đọc HOẶC người dùng tự đánh dấu chưa đọc: `markRoomUnread` cố ý KHÔNG đổi
  // `unreadCount` (con trỏ `last_read_seq` chỉ tiến — SPEC-15 §13.2), nên suy độ đậm từ mỗi badge là bỏ
  // rơi đúng thao tác người dùng vừa làm.
  const looksUnread = isRoomUnreadLooking(room);

  return (
    <li>
      <div
        // Chuột phải ở BẤT KỲ đâu trên hàng (kể cả vùng nút menu) đều mở menu — lối tắt của lối bàn
        // phím ngay bên cạnh, không phải lối duy nhất.
        onContextMenu={(e) => {
          e.preventDefault();
          onMenuOpenChange(true);
        }}
        className={cn(
          "flex w-full items-center gap-1 pr-1.5 hover:bg-accent",
          isSelected && "bg-accent",
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(room.id)}
          aria-current={isSelected ? "true" : undefined}
          data-testid="chat-room-item"
          className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left"
        >
          <RoomAvatar room={room} label={label} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span
                className={cn("min-w-0 flex-1 truncate text-sm", looksUnread && "font-semibold")}
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
          {/* Ghim và tắt thông báo phải thấy được NGAY TRÊN DÒNG. Nằm trong menu thì người dùng phải mở
              từng phòng mới biết phòng nào đang tắt — tức không bao giờ biết. */}
          {/* `role="img"` bắt buộc: một `<svg>` mang `aria-label` mà không có role thì trình đọc màn
              hình bỏ qua nhãn — biểu tượng "đang tắt thông báo" chỉ tồn tại với người nhìn thấy nó. */}
          {isRoomPinned(room) && (
            <Pin
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              role="img"
              aria-label={t("rooms.pinnedAria")}
              data-testid="chat-room-pinned-icon"
            />
          )}
          {muted && (
            <BellOff
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              role="img"
              aria-label={t("rooms.mutedAria")}
              data-testid="chat-room-muted-icon"
            />
          )}
          {unread > 0 && (
            <Badge
              className="shrink-0 tabular-nums"
              aria-label={t("rooms.unreadAria", { count: unread })}
            >
              {unread > 99 ? t("rooms.unreadOverflow") : unread}
            </Badge>
          )}
        </button>

        <RoomRowMenu
          room={room}
          label={label}
          open={isMenuOpen}
          onOpenChange={onMenuOpenChange}
          canArchive={canArchive}
          isBusy={isBusy}
          onTogglePin={onTogglePin}
          onMute={onMute}
          onMarkUnread={onMarkUnread}
          onArchive={onArchive}
        />
      </div>
    </li>
  );
}
