/**
 * S7-CHAT-FE-2 — cột trái: danh sách phòng CỦA TÔI + lối vào tạo phòng (SPEC-15 §9 CHAT-SCREEN-001).
 *
 * Nguồn dữ liệu là `useChatStore`, KHÔNG phải một `useQuery` thứ hai: `useChatRealtime` gắn ở
 * `ProtectedShell` đã nạp `GET /chat/rooms` và `syncRoomList` sẵn cho toàn app. Gọi lại ở đây là hai
 * bản sao cùng dữ liệu, và bản nào tươi hơn thì tuỳ thứ tự response — đúng loại lệch không tái hiện được.
 *
 * Rổ **đã lưu trữ** thì phải hỏi riêng: `listRooms()` không tham số bị service ép `archived: false`, nên
 * phòng đã lưu trữ KHÔNG có trong rổ mặc định (docblock `syncRoomList`).
 *
 * ─── S17-CHAT-UX2-FE-1 (v2) ────────────────────────────────────────────────────────────────────────
 *  · **chip lọc nhanh** (CHAT-DEC-021 · SPEC-15 §9a) — «Tất cả» giữ 5 mục cố định, chip khác ra danh
 *    sách PHẲNG. Luật chia rổ ở `room-list-filter.ts` (module thuần, kiểm được trên dữ liệu);
 *  · **dòng phòng 56px** — preview «Người gửi: …» từ `room.lastMessage`, thời gian TƯƠNG ĐỐI,
 *    avatar/chấm online/«Ngừng hoạt động» của `room.peer`;
 *  · **GỠ `resolvedNames`** — `room.peer.name` có sẵn từ `GET /chat/rooms` nên DM có tên ngay khung
 *    hình đầu; nhãn dựng tại chỗ bằng `roomDisplayName`, không còn cache nào ở trang hay ở dock store.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
// `Search` ở ô LỌC PHÒNG, `MessagesSquare` cho lối vào tìm theo NỘI DUNG TIN (CHAT-SCREEN-005). Hai
// biểu tượng kính lúp cạnh nhau là lời mời gõ nhầm ô — chính hiểu nhầm mà docblock `visible` cảnh báo.
import {
  BellOff,
  ChevronDown,
  ChevronRight,
  MessageSquarePlus,
  MessagesSquare,
  Paperclip,
  Pin,
  Search,
} from "lucide-react";
import { chatApi, chatKeys, useAuthStore, useCan } from "@mediaos/web-core";
import { Badge, Button, Input, Skeleton, cn } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";
import { CHAT_PAIRS } from "@/routes/chat/constants";
import { formatRelativeTime, roomDisplayName } from "./chat-format";
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
import {
  DEFAULT_ROOM_FILTER_CHIP,
  ROOM_FILTER_CHIPS,
  chipNeedsArchivedScope,
  chipUsesSections,
  filterRoomsByChip,
  type RoomFilterChip,
} from "./room-list-filter";

interface RoomListPanelProps {
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
  /**
   * Mở hộp thoại tạo phòng. `undefined` ⇒ **ẩn hẳn nút**, không render nút vô hiệu.
   *
   * S17-CHAT-UX2-FE-5 làm prop này tuỳ chọn cho drawer. Một nút hiện ra mà không làm gì là thứ người
   * dùng bấm rồi tưởng hệ thống treo.
   */
  onCreateRoom?: () => void;
  /**
   * S7-CHAT-FE-4 — mở CHAT-SCREEN-005 (tìm theo NỘI DUNG tin), khác hẳn ô lọc phòng bên dưới.
   * `undefined` ⇒ ẩn nút (drawer không có cột tìm kiếm để mở).
   */
  onOpenSearch?: () => void;
  isBootstrapping: boolean;
  /**
   * S17-CHAT-UX2-FE-5 — hình dạng của cột.
   *
   *   `page`   (mặc định) cột trái của `/chat`: bề rộng cố định + viền phải
   *   `drawer` chiếm hết bề ngang vật chứa, không viền — dùng trong drawer và ở mốc 1 cột của `/chat`
   *
   * CHỈ khác bề rộng/viền: chia mục, chiều cao dòng, preview, `RoomRowMenu` giữ nguyên. Một "chế độ
   * compact" cắt bớt nội dung sẽ tạo ra hai bản danh sách phòng phải nuôi song song.
   */
  variant?: "page" | "drawer";
  /**
   * S17-CHAT-UX2-FE-5 — câu lọc theo tên/mã, ĐIỀU KHIỂN TỪ NGOÀI (tuỳ chọn).
   *
   * Không truyền ⇒ panel tự giữ state như trước (mọi caller cũ không đổi một dòng). Truyền ⇒ caller
   * giữ. Drawer cần vế sau: bấm một phòng là đẩy sang hội thoại và panel này UNMOUNT, nên câu vừa gõ
   * sẽ bốc hơi mỗi lần liếc một phòng rồi bấm ‹ quay lại.
   *
   * ⚠️ Đọc bằng `??` chứ KHÔNG `||`: `""` là câu lọc rỗng HỢP LỆ do caller đặt, `||` sẽ nuốt nó và rơi
   * về state nội bộ ⇒ hai nguồn sự thật lệch nhau ngay lần người dùng xoá hết ô tìm.
   */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Chip lọc nhanh, điều khiển từ ngoài (cùng lý do `query`). */
  chip?: RoomFilterChip;
  onChipChange?: (chip: RoomFilterChip) => void;
}

export function RoomListPanel({
  selectedRoomId,
  onSelectRoom,
  onCreateRoom,
  onOpenSearch,
  isBootstrapping,
  variant = "page",
  query: queryProp,
  onQueryChange,
  chip: chipProp,
  onChipChange,
}: RoomListPanelProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const canCreate = useCan(CHAT_PAIRS.CREATE_ROOM.action, CHAT_PAIRS.CREATE_ROOM.resourceType);
  // S8-CHAT-UX-FE-2 — cổng của DUY NHẤT mục "Lưu trữ phòng" trong menu. Ba mục còn lại (ghim · tắt
  // thông báo · đánh dấu chưa đọc) là tuỳ chọn CÁ NHÂN và không hỏi cặp quản trị nào — xem `useRoomPrefs`.
  const canArchive = useCan(CHAT_PAIRS.ARCHIVE_ROOM.action, CHAT_PAIRS.ARCHIVE_ROOM.resourceType);

  const [queryState, setQueryState] = useState("");
  /**
   * Chip đang chọn. **`useState`, KHÔNG `localStorage`** — §9a: chip không lưu, mỗi lần vào lại màn hình
   * đều về «Tất cả». (Trạng thái THU/MỞ mục thì VẪN nhớ — hai thứ khác nhau, đừng gộp khoá.)
   */
  const [chipState, setChipState] = useState<RoomFilterChip>(DEFAULT_ROOM_FILTER_CHIP);

  /**
   * S17-CHAT-UX2-FE-5 — controlled/uncontrolled: caller truyền thì caller giữ, KHÔNG giữ cả hai.
   *
   * `setQueryState` chỉ được gọi ở nhánh KHÔNG được điều khiển. Ghi vào state nội bộ khi đang được điều
   * khiển là dựng một bản sao thứ hai chạy song song: caller từ chối một giá trị (ví dụ chuẩn hoá
   * khoảng trắng) thì ô input hiện một đằng, danh sách lọc theo một nẻo.
   */
  const isQueryControlled = queryProp !== undefined;
  const query = queryProp ?? queryState;
  const setQuery = useCallback(
    (next: string): void => {
      if (isQueryControlled) onQueryChange?.(next);
      else setQueryState(next);
    },
    [isQueryControlled, onQueryChange],
  );

  const isChipControlled = chipProp !== undefined;
  const chip = chipProp ?? chipState;
  const setChip = useCallback(
    (next: RoomFilterChip): void => {
      if (isChipControlled) onChipChange?.(next);
      else setChipState(next);
    },
    [isChipControlled, onChipChange],
  );
  const showArchived = chipNeedsArchivedScope(chip);
  /** Menu ĐANG mở của phòng nào — một tại một thời điểm (mở cái thứ hai tự đóng cái trước). */
  const [openMenuRoomId, setOpenMenuRoomId] = useState<string | null>(null);
  /**
   * Lỗi của một THAO TÁC trong menu, không phải của khung nhìn — nên nó nằm ở đầu cột dưới dạng dải
   * `role="alert"`, không thay thế danh sách. Nuốt câm là điều duy nhất không được phép: người dùng vừa
   * thấy phòng nhảy lên mục "Đã ghim" rồi nhảy về, mà không có chữ nào nói vì sao.
   */
  const [actionError, setActionError] = useState<string | null>(null);

  const myUserId = useChatStore((s) => s.myUserId);
  const roomsById = useChatStore((s) => s.roomsById);
  const roomOrder = useChatStore((s) => s.roomOrder);
  const presenceByUser = useChatStore((s) => s.presenceByUser);
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

  const labelOf = useCallback(
    (room: ChatRoomDto): string =>
      // `undefined` = không có `members[]` ở danh sách. `roomDisplayName` nay đọc `room.peer.name`
      // (S17-CHAT-UX2-BE-1) nên DM vẫn ra ĐÚNG TÊN ngay khung hình đầu — không còn cache `resolvedNames`.
      roomDisplayName(room, undefined, myUserId, (code) => t("rooms.directFallback", { code })),
    [myUserId, t],
  );

  /**
   * Thứ tự ba tầng lọc LÀ hợp đồng, không phải sở thích:
   *
   *   rổ (lưu trữ hay không)  →  chip  →  ô tìm theo tên/mã
   *
   * Đảo hai tầng cuối thì gõ từ khoá trong chip «Chưa đọc» sẽ trả về cả phòng đã đọc. Đảo tầng đầu thì
   * một phòng đã lưu trữ lọt vào chip «Riêng», và người dùng không có cách nào biết vì sao nó ở đó.
   */
  const visible = useMemo(() => {
    const inScope = roomOrder
      .map((id) => roomsById[id])
      .filter((room): room is ChatRoomDto => room !== undefined)
      .filter((room) => (room.isArchived ?? false) === showArchived);

    const byChip = filterRoomsByChip(inScope, chip);

    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return byChip;
    // Lọc trên TÊN/MÃ phòng ở client. Tìm theo NỘI DUNG tin là `GET /chat/search` — màn riêng,
    // thuộc S7-CHAT-FE-4; trộn hai thứ vào một ô làm người dùng tưởng đã tìm hết.
    return byChip.filter(
      (room) =>
        labelOf(room).toLowerCase().includes(needle) ||
        room.roomCode.toLowerCase().includes(needle),
    );
  }, [chip, labelOf, query, roomOrder, roomsById, showArchived]);

  // ─── S8-CHAT-UX-FE-1: chia mục theo loại phòng (CHAT-DEC-013) ───
  // S17-CHAT-UX2-FE-1 — chỉ chip «Tất cả» mới chia mục. Chip khác ra danh sách PHẲNG (§9a), và `null`
  // ở đây là tín hiệu đó — không dựng một mục giả tên "kết quả" để nhánh render khỏi phải rẽ.
  const sections = useMemo(
    () => (chipUsesSections(chip) ? buildRoomSections(visible) : null),
    [chip, visible],
  );

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

  const renderRow = useCallback(
    (room: ChatRoomDto): React.ReactElement => (
      <RoomRow
        key={room.id}
        room={room}
        label={labelOf(room)}
        // Chấm online CHỈ có nghĩa ở DM: `chat:presence` fan-out tới peer của phòng `direct`, không tới
        // phòng nhóm. `?? false` chứ không `undefined`: vắng khoá = chưa biết = coi như offline.
        isPeerOnline={
          room.roomType === "direct" && room.peer !== null && room.peer !== undefined
            ? (presenceByUser[room.peer.userId] ?? false)
            : false
        }
        isMine={myUserId !== null && room.lastMessage?.senderId === myUserId}
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
    ),
    [
      archive,
      canArchive,
      isBusy,
      labelOf,
      markUnread,
      mute,
      myUserId,
      onSelectRoom,
      openMenuRoomId,
      presenceByUser,
      selectedRoomId,
      togglePin,
    ],
  );

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col",
        // `page`: 320px theo CHAT-DEC-026 (§9 SCREEN-001 v2 — 320/co giãn/340). Trước FE-5 là `w-72`
        // (288px), lệch 32px so với thiết kế.
        variant === "page" ? "w-80 shrink-0 border-r border-border" : "w-full",
      )}
      aria-label={t("rooms.heading")}
      data-testid="chat-room-list"
      data-variant={variant}
    >
      <RoomListHeader
        query={query}
        onQueryChange={setQuery}
        onOpenSearch={onOpenSearch}
        onCreateRoom={canCreate ? onCreateRoom : undefined}
      />

      <RoomFilterChipBar value={chip} onChange={setChip} />

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
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {query.trim().length > 0
              ? t("rooms.noSearchResult", { query: query.trim() })
              : showArchived
                ? t("rooms.emptyArchived")
                : chip !== "all"
                  ? t("rooms.emptyChip")
                  : `${t("rooms.empty")} ${canCreate ? t("rooms.emptyHint") : ""}`.trim()}
          </p>
        ) : sections === null ? (
          // Danh sách PHẲNG của chip ≠ «Tất cả». Một `<ul>` duy nhất ⇒ mỗi phòng đúng MỘT node, không
          // cần vị từ nào canh — bất biến "1 node" ở đây là do CẤU TRÚC, không do kỷ luật.
          <ul data-testid="chat-room-flat-list">{visible.map(renderRow)}</ul>
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

                {!isCollapsed && <ul>{section.rooms.map(renderRow)}</ul>}
              </section>
            );
          })
        )}
      </div>
    </aside>
  );
}

/**
 * S17-CHAT-UX2-FE-1 — thanh đầu v2 (wireframe §05): ô tìm chiếm hết bề ngang, hai nút biểu tượng.
 *
 * Tách khỏi `RoomListPanel` cùng lý do `RoomRow`/`RoomPreviewLine` đã tách: thân component chính vốn đã
 * dài, và mỗi khối JSX độc lập ở đây không đọc state nào ngoài thứ nó nhận qua props.
 *
 * `onCreateRoom === undefined` ⇒ **không render nút** (không phải render nút vô hiệu hoá): §14 nói ẩn hẳn
 * khi thiếu cặp quyền. Cổng thật vẫn ở server; đây chỉ là chuyện không mời người dùng bấm vào chỗ sẽ bị
 * từ chối. `onOpenSearch === undefined` cũng vậy, nhưng vì lý do khác (S17-CHAT-UX2-FE-5): trong drawer
 * KHÔNG có cột tìm kiếm nào để mở, nên nút đó sẽ là một nút chết.
 */
function RoomListHeader({
  query,
  onQueryChange,
  onOpenSearch,
  onCreateRoom,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onOpenSearch?: () => void;
  onCreateRoom?: () => void;
}): React.ReactElement {
  const { t } = useTranslation("chat");
  return (
    <div className="flex items-center gap-1.5 border-b border-border px-3 py-2.5">
      <div className="relative min-w-0 flex-1">
        <Search
          className="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("rooms.searchPlaceholder")}
          aria-label={t("rooms.searchPlaceholder")}
          className="h-8 pl-7 text-sm"
        />
      </div>
      {onOpenSearch !== undefined && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("search.openAria")}
          onClick={onOpenSearch}
          data-testid="chat-open-search"
        >
          <MessagesSquare className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
      {onCreateRoom !== undefined && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("rooms.newButtonAria")}
          onClick={onCreateRoom}
          data-testid="chat-create-room"
        >
          <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/**
 * S17-CHAT-UX2-FE-1 — hàng chip lọc nhanh (CHAT-DEC-021 · SPEC-15 §9a).
 *
 * `role="tablist"` KHÔNG dùng ở đây: chip không đổi khung nhìn sang một panel khác, nó lọc chính danh
 * sách bên dưới. `aria-pressed` trên nút là đúng ngữ nghĩa (nút bật/tắt) và không đòi quản lý focus kiểu
 * tab. Nhưng `role="group"` + nhãn thì CẦN: thiếu nó, người dùng trình đọc màn hình nhảy vào nút đầu tiên
 * mà không có gì nói đây là bộ lọc — họ nghe "Tất cả, nút, đang bật" và không biết tất cả CÁI GÌ.
 */
function RoomFilterChipBar({
  value,
  onChange,
}: {
  value: RoomFilterChip;
  onChange: (chip: RoomFilterChip) => void;
}): React.ReactElement {
  const { t } = useTranslation("chat");
  return (
    <div
      role="group"
      aria-label={t("rooms.chipsAria")}
      className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2"
      data-testid="chat-room-chips"
    >
      {ROOM_FILTER_CHIPS.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          data-testid="chat-room-chip"
          data-chip={key}
          onClick={() => onChange(key)}
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap transition-colors",
            value === key
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:bg-accent",
          )}
        >
          {t(`rooms.chips.${key}`)}
        </button>
      ))}
    </div>
  );
}

interface RoomRowProps {
  room: ChatRoomDto;
  /** Nhãn ĐÃ dựng ở cấp trên (phòng `direct` không có `name` nên nhãn là dẫn xuất). */
  label: string;
  /** Chỉ `true` ở phòng `direct` có peer đang online — xem docblock `RoomAvatar`. */
  isPeerOnline: boolean;
  /** Tin cuối là của CHÍNH TÔI ⇒ tiền tố «Bạn:» thay cho tên người gửi. */
  isMine: boolean;
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
 *
 * S17-CHAT-UX2-FE-1 giữ nguyên CẤU TRÚC đó và chỉ đổi NỘI DUNG hai dòng bên trong (dòng 2 từ "loại
 * phòng" thành preview tin cuối) — đổi cấu trúc là làm lại 35 ca test cho một thay đổi hình thức.
 */
function RoomRow({
  room,
  label,
  isPeerOnline,
  isMine,
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
  const isPeerInactive = room.roomType === "direct" && room.peer?.isActive === false;

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
          className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 text-left"
        >
          <RoomAvatar room={room} label={label} size="md" isOnline={isPeerOnline} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span
                className={cn("min-w-0 truncate text-sm", looksUnread && "font-semibold")}
                data-testid="chat-room-name"
              >
                {label}
              </span>
              {isPeerInactive && (
                <span
                  className="shrink-0 rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground"
                  data-testid="chat-room-peer-inactive"
                >
                  {t("rooms.peerInactive")}
                </span>
              )}
              <span className="flex-1" />
              {room.lastMessageAt && (
                <span
                  className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
                  data-testid="chat-room-time"
                >
                  {formatRelativeTime(room.lastMessageAt)}
                </span>
              )}
            </div>
            <RoomPreviewLine room={room} isMine={isMine} />
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

/**
 * S17-CHAT-UX2-FE-1 — dòng preview tin cuối (CHAT-DEC-022 · SPEC-15 §14 v2).
 *
 * ⚠️ **`lastMessage === null` ⇒ trả `null`, KHÔNG phải một `<p>` rỗng.** §14: phòng chưa có tin nào thì
 * để trống hẳn — một dòng trắng có chiều cao trông y hệt "đã tải xong nhưng mất chữ".
 *
 * ⚠️ `kind === 'recalled'` PHẢI ra chữ («Tin nhắn đã được thu hồi»), không phải khoảng trắng — cũng §14.
 * `excerpt` của nhánh đó luôn `null` ở server, nên đọc `excerpt` mà không rẽ theo `kind` là mất luôn.
 */
function RoomPreviewLine({
  room,
  isMine,
}: {
  room: ChatRoomDto;
  isMine: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation("chat");
  const last = room.lastMessage;
  if (last === null || last === undefined) return null;

  /**
   * Tiền tố người gửi (wireframe §05):
   *   · tin của tôi              ⇒ «Bạn: »
   *   · phòng nhóm/ban/dự án     ⇒ «{tên}: »
   *   · DM, tin của người kia    ⇒ KHÔNG tiền tố (chỉ có hai người, tên đã ở ngay dòng trên)
   *   · tin hệ thống             ⇒ KHÔNG tiền tố (nó không phải lời của ai)
   */
  const prefix =
    last.kind === "system"
      ? null
      : isMine
        ? t("rooms.preview.you")
        : room.roomType === "direct"
          ? null
          : (last.senderName ?? null);

  const body =
    last.kind === "recalled"
      ? t("rooms.preview.recalled")
      : last.excerpt !== null
        ? last.excerpt
        : last.attachmentCount > 0
          ? t("rooms.preview.files", { count: last.attachmentCount })
          : "";

  /**
   * ⚠️ Xét `body` MỘT MÌNH, KHÔNG `&& prefix === null`.
   *
   * `chat_messages.body` NOT NULL nhưng cho phép CHUỖI RỖNG, nên một tin rỗng-0-tệp là hàng hợp lệ ở DB.
   * Với tin như thế của CHÍNH MÌNH (hoặc trong phòng nhóm) thì `prefix` khác null, và điều kiện cũ cho
   * qua ⇒ vẽ ra «Bạn: » — một dòng chỉ có tiền tố và dấu hai chấm. Đó đúng là "dòng trắng gây hiểu nhầm
   * là lỗi" mà SPEC-15 §14 v2 cấm; tiền tố không mang thông tin nào khi không có nội dung đi kèm.
   */
  if (body === "") return null;

  return (
    <p
      className={cn(
        "truncate text-xs text-muted-foreground",
        (last.kind === "recalled" || last.kind === "system") && "italic",
      )}
      data-testid="chat-room-preview"
    >
      {prefix !== null && <span className="font-medium text-foreground/70">{prefix}: </span>}
      {body}
      {/* Kẹp giấy đi KÈM chữ, không thay chữ: `kind:'text'` vẫn có thể có tệp (API-13 §5.1d(1)), và ai
          đọc `kind === 'file'` để suy "có tệp" sẽ bỏ sót đúng ca phổ biến nhất — tin vừa có chữ vừa có ảnh.
          CẢ HAI nhánh `text` và `file` đều vẽ, đúng ký hiệu «📎 {{count}} tệp» của SPEC-15 §14 v2.
          `recalled`/`system` thì KHÔNG: `attachmentCount` của tin đã thu hồi là số liệu LỊCH SỬ vẫn > 0,
          và vẽ kẹp giấy ở đó là nói cho cả phòng biết tin vừa rút có đính kèm. */}
      {(last.kind === "text" || last.kind === "file") && last.attachmentCount > 0 && (
        <Paperclip
          className="ml-1 inline h-3 w-3 align-text-bottom"
          role="img"
          aria-label={t("rooms.preview.attachmentAria", { count: last.attachmentCount })}
          data-testid="chat-room-preview-clip"
        />
      )}
    </p>
  );
}
