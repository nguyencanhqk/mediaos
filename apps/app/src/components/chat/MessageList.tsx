/**
 * S7-CHAT-FE-2 — khung cuộn của hội thoại: cuộn ngược `beforeSeq` · NEO cuộn · dải ngày · gộp tin ·
 * bong bóng đang-gửi/gửi-lỗi · đánh dấu đã đọc (SPEC-15 §13.1 · §13.2 · §14).
 *
 * ⚠️ Điểm dễ hỏng nhất của cả WO nằm ở đây: **prepend làm nhảy khung nhìn**. Chèn 50 tin lên đầu làm
 * `scrollHeight` tăng đột ngột, và trình duyệt GIỮ NGUYÊN `scrollTop` ⇒ nội dung người dùng đang đọc
 * trôi xuống dưới màn hình. Phép bù phải đo `scrollHeight` NGAY TRƯỚC khi dữ liệu đổi và áp lại trong
 * `useLayoutEffect` (trước lượt vẽ) — làm trong `useEffect` là người dùng thấy một cú giật.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown } from "lucide-react";
import { Button, Skeleton, cn } from "@mediaos/ui";
import type { ChatRoomDto, ChatRoomMemberDto } from "@mediaos/contracts";
import type { PendingChatMessage, StoredChatMessage } from "@/stores/chat.store";
import { MAX_HISTORY_PER_ROOM } from "@/stores/chat.store";
import { NEAR_BOTTOM_THRESHOLD_PX } from "@/routes/chat/constants";
import { canRecallMessage, dayKeyOf, formatDayLabel } from "./chat-format";
import {
  MAX_UNREAD_CATCHUP_PAGES,
  UNREAD_DIVIDER_TOP_GAP_PX,
  locateUnreadAnchor,
  unreadSnapshotOf,
  unseenCountBelow,
  type UnreadAnchor,
} from "./chat-unread";
import { MessageBubble, type MessageBubbleActions } from "./MessageBubble";
import type { SeenByViewer } from "./SeenByAvatars";
import { isScrollNearBottom, scrollTopToReveal } from "./use-chat-viewport";

/** Khoảng cách tới ĐỈNH đủ để coi là "đang muốn xem tiếp lịch sử". */
const LOAD_OLDER_THRESHOLD_PX = 60;

/** Cùng người gửi + cách nhau dưới ngưỡng này ⇒ gộp (không lặp avatar + tên). */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Mỏ neo DOM của vạch chưa đọc — phép định vị tìm nó trong khung cuộn. */
const UNREAD_DIVIDER_TESTID = "chat-unread-divider";

/**
 * S20-CHAT-UNREAD-1 — pha của LẦN MỞ phòng: `pending` = còn phải định vị (tới vạch, hoặc chờ nạp tới
 * mốc); `done` = khung nhìn thuộc về người dùng. Đang `pending` thì không gì khác được kéo khung nhìn.
 */
type OpenPhase = "pending" | "done";

interface MessageListProps {
  room: ChatRoomDto;
  messages: readonly StoredChatMessage[];
  pending: readonly PendingChatMessage[];
  members: readonly ChatRoomMemberDto[];
  myUserId: string | null;
  myRole: "member" | "admin" | null;
  canRecallPair: boolean;
  canPinPair: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
  historyLimitReached: boolean;
  /**
   * S20-CHAT-UNREAD-1 — trang đầu của LẦN MỞ phòng này đã về (`useChatConversation.isFirstPageLoaded`).
   * Chưa về thì store có thể chỉ còn tin của lần ghé trước, hở một khúc ở giữa ⇒ chưa được đặt vạch.
   * Mặc định `true` cho nơi gọi không có vòng nạp trang đầu.
   */
  isFirstPageLoaded?: boolean;
  /**
   * S7-CHAT-FE-4 — tin cần LÀM NỔI + cuộn tới (đích của một lần nhảy từ tìm kiếm/ghim/tệp).
   *
   * `null` = không có gì để làm nổi. Khi khác `null`, danh sách **không** tự cuộn xuống đáy dù đây là
   * lần vẽ đầu: kéo người dùng xuống đáy ngay sau khi họ bấm vào một kết quả ở giữa lịch sử là huỷ đúng
   * thao tác họ vừa làm.
   */
  highlightMessageId?: string | null;
  /**
   * S8-CHAT-UX-FE-3 — bản đồ ảnh/tên từ **ROSTER phòng** (CHAT-DEC-019). Tra theo `senderId` khi vẽ.
   *
   * Truyền bản đồ chứ không truyền `avatarUrl` sẵn trên từng tin: nguồn ảnh là roster (ký 1 lô/phòng),
   * còn tin thì không mang ảnh — nhét ảnh vào `StoredChatMessage` sẽ nhân bản một URL ký có hạn lên hàng
   * trăm bản sao trong RAM và mở đường cho ai đó ký-theo-tin ở lần sửa sau.
   */
  avatarByUser?: ReadonlyMap<string, string | null>;
  nameByUser?: ReadonlyMap<string, string>;
  onLoadOlder: () => Promise<number>;
  onMarkRead: (seq: number) => void;
  onResendPending: (pending: PendingChatMessage) => void;
  onDiscardPending: (pending: PendingChatMessage) => void;
  actions: MessageBubbleActions;
}

export function MessageList({
  room,
  messages,
  pending,
  members,
  myUserId,
  myRole,
  canRecallPair,
  canPinPair,
  hasMoreOlder,
  isLoadingOlder,
  historyLimitReached,
  isFirstPageLoaded = true,
  highlightMessageId = null,
  avatarByUser,
  nameByUser,
  onLoadOlder,
  onMarkRead,
  onResendPending,
  onDiscardPending,
  actions,
}: MessageListProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * S20-CHAT-UNREAD-1 — ảnh chụp chưa đọc, chụp MỘT LẦN lúc dựng và TRƯỚC mọi `onMarkRead` (mỗi phòng
   * một lần dựng: `ChatPage` lẫn drawer đều gắn `key` theo phòng). Không đọc lại từ `room` mỗi lượt vẽ:
   * đánh dấu đọc kéo `unreadCount` về 0 và vạch sẽ biến mất đúng lúc người dùng vừa chạm đáy.
   *
   * `null` (không có tin chưa đọc, hoặc server cũ thiếu `unreadCount`/`lastMessageSeq`) ⇒ hành vi cũ:
   * khởi tạo «đang ở đáy», lần vẽ đầu xuống đáy và báo đọc.
   */
  const [unread] = useState(() => unreadSnapshotOf(room));
  const [openPhase, setOpenPhase] = useState<OpenPhase>(() =>
    unread === null ? "done" : "pending",
  );
  // ⚠️ `unread !== null` ⇒ KHỞI TẠO `false`. Mã cũ khởi tạo `true` nên effect đánh dấu đọc chạy ngay lần
  // vẽ đầu và badge về 0 trước khi người dùng thấy tin chưa đọc nào (ca RED của WO).
  const [isNearBottom, setNearBottom] = useState(unread === null);
  /**
   * Mốc của nút «↓ N tin mới»: `room_seq` cao nhất đã BÁO cho người dùng — đã thấy ở đáy, hoặc đã nằm
   * trong số của vạch. Chỉ tiến. Lúc mở = tin mới nhất đã biết: phần chưa đọc đã có vạch «N tin chưa đọc»
   * nói, nút chỉ đếm tin tới SAU lúc mở. Mốc cũ (`firstUnreadSeq − 1`) làm nút «↓ 25 tin mới» hiện ngay lần
   * vẽ đầu, lặp đúng số của vạch, và nút nổi giữa đáy khung đè lên chữ tin đang đọc (lượt đo trình duyệt).
   */
  const [seenUpToSeq, setSeenUpToSeq] = useState(() => {
    const known = room.lastMessageSeq;
    const loaded = messages.length > 0 ? messages[messages.length - 1].roomSeq : 0;
    return typeof known === "number" && Number.isFinite(known) ? Math.max(known, loaded) : loaded;
  });
  /** Vòng nạp `beforeSeq` CHỈ để với tới mốc chưa đọc (khác lần nạp do người dùng cuộn lên). */
  const [catchUp, setCatchUp] = useState({ pages: 0, exhausted: false });
  const catchUpInFlightRef = useRef(false);
  const [isPageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );

  /** Ảnh chụp hình học NGAY TRƯỚC khi prepend — `null` khi không có lần nạp lịch sử nào đang bay. */
  const anchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const canCatchUpOlder =
    openPhase === "pending" &&
    hasMoreOlder &&
    !historyLimitReached &&
    !catchUp.exhausted &&
    catchUp.pages < MAX_UNREAD_CATCHUP_PAGES;
  const unreadAnchor = useMemo<UnreadAnchor>(
    () =>
      unread === null
        ? { kind: "none" }
        : locateUnreadAnchor(messages, unread.firstUnreadSeq, canCatchUpOlder),
    [messages, unread, canCatchUpOlder],
  );
  // Tin làm nổi (`?msg=` / tìm kiếm / ghim) THẮNG vạch: danh sách lúc đó là cửa sổ ngữ cảnh, không phải
  // đuôi hội thoại. Trang đầu chưa về thì chưa vẽ vạch — dữ liệu còn có thể hở ở giữa.
  const dividerBeforeId =
    highlightMessageId === null &&
    unreadAnchor.kind === "message" &&
    (isFirstPageLoaded || openPhase === "done")
      ? unreadAnchor.messageId
      : null;

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // Đặt luôn «ở đáy» thay vì chờ sự kiện `scroll`: bấm «↓» là ý định đọc tới cuối, và khi nội dung
    // không đổi chiều cao thì trình duyệt có thể không bắn `scroll` nào.
    setNearBottom(true);
  }, []);

  const triggerLoadOlder = useCallback(() => {
    const el = scrollRef.current;
    if (!el || isLoadingOlder || !hasMoreOlder || historyLimitReached) return;
    anchorRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    void onLoadOlder().then((added) => {
      // Không thêm được gì (trang rỗng / phòng đã đổi) ⇒ BỎ mỏ neo. Giữ lại thì lần render kế tiếp vì
      // một lý do khác (tin mới tới) sẽ áp nhầm phép bù và kéo khung nhìn đi.
      if (added === 0) anchorRef.current = null;
    });
  }, [hasMoreOlder, historyLimitReached, isLoadingOlder, onLoadOlder]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // S20-CHAT-UNREAD-1 — lần mở còn đang định vị: khung đứng ở đỉnh trong lúc vòng nạp tới mốc chạy, và
    // một `scroll` lúc đó sẽ mở thêm lần nạp thứ hai (`triggerLoadOlder`) tranh với vòng nạp — hook trả 0
    // cho lần đến sau, vòng nạp tưởng hết lịch sử và dừng ở chỗ sai.
    if (openPhase === "pending") return;
    setNearBottom(isScrollNearBottom(el, NEAR_BOTTOM_THRESHOLD_PX));
    if (el.scrollTop <= LOAD_OLDER_THRESHOLD_PX) triggerLoadOlder();
  }, [openPhase, triggerLoadOlder]);

  // ── Neo cuộn sau khi prepend ───────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) return;
    anchorRef.current = null;
    // Giữ NGUYÊN tin đang nằm dưới con trỏ mắt: bù đúng phần chiều cao vừa mọc thêm ở PHÍA TRÊN.
    el.scrollTop = el.scrollHeight - anchor.scrollHeight + anchor.scrollTop;
  }, [messages]);

  // ── Tin mới tới ────────────────────────────────────────────────────────────
  useEffect(() => {
    const latest = messages.length > 0 ? messages[messages.length - 1] : null;
    const latestId = latest?.id ?? null;
    if (latestId === lastMessageIdRef.current) return;
    const isFirstPaint = lastMessageIdRef.current === null;
    lastMessageIdRef.current = latestId;
    if (latest === null) return;

    // S7-CHAT-FE-4: đang có tin được làm nổi ⇒ khung nhìn thuộc về nó, không phải về đáy. Thiếu vế này
    // thì lần vẽ đầu của một cửa sổ ngữ cảnh cuộn thẳng xuống đáy và tin người dùng vừa bấm biến mất
    // khỏi màn hình trước khi họ kịp đọc.
    if (highlightMessageId !== null) return;

    // S20-CHAT-UNREAD-1 — lần mở còn đang định vị (tới vạch chưa đọc) ⇒ khung nhìn thuộc về phép định
    // vị bên dưới. Thiếu vế này thì lần vẽ đầu cuộn thẳng xuống đáy như mã cũ.
    if (openPhase === "pending") return;

    // Người dùng đang đọc tin cũ ⇒ TUYỆT ĐỐI không kéo khung nhìn của họ. Nút «↓ N tin mới» tự hiện
    // (số dẫn xuất từ `seenUpToSeq`, không cần cờ).
    if (isFirstPaint || isNearBottom) scrollToBottom();
  }, [messages, isNearBottom, scrollToBottom, highlightMessageId, openPhase]);

  // ── Định vị lần mở tại vạch chưa đọc (S20-CHAT-UNREAD-1) ───────────────────
  //
  // `useLayoutEffect`: đặt `scrollTop` TRƯỚC lượt vẽ, người dùng không thấy cú nhảy đỉnh → vạch.
  useLayoutEffect(() => {
    if (openPhase !== "pending") return;
    // `?msg=` thắng vạch — cả khi tin làm nổi tới SAU lúc dựng (cửa sổ ngữ cảnh nạp chậm hơn).
    if (highlightMessageId !== null) {
      setOpenPhase("done");
      return;
    }
    if (!isFirstPageLoaded || unreadAnchor.kind === "older-needed") return;
    const el = scrollRef.current;
    if (!el) return;
    setOpenPhase("done");

    const divider =
      unreadAnchor.kind === "message"
        ? el.querySelector<HTMLElement>(`[data-testid="${UNREAD_DIVIDER_TESTID}"]`)
        : null;
    // Không có chỗ đặt vạch (mọi tin chưa đọc đã thu hồi) ⇒ như phòng không có tin chưa đọc.
    if (divider === null) {
      scrollToBottom();
      return;
    }
    el.scrollTop = scrollTopToReveal({
      targetTop: divider.getBoundingClientRect().top,
      viewportTop: el.getBoundingClientRect().top,
      scrollTop: el.scrollTop,
      gapPx: UNREAD_DIVIDER_TOP_GAP_PX,
    });
    // Phần chưa đọc lọt vừa khung nhìn ⇒ người dùng ĐANG thấy đáy rồi, không có cú cuộn nào để chờ.
    if (isScrollNearBottom(el, NEAR_BOTTOM_THRESHOLD_PX)) setNearBottom(true);
  }, [highlightMessageId, isFirstPageLoaded, openPhase, scrollToBottom, unreadAnchor]);

  // ── Nạp thêm tới mốc chưa đọc (> 1 trang) ──────────────────────────────────
  //
  // Cờ đang-bay ở REF (đọc đồng bộ): StrictMode chạy effect hai lần liền, cờ ở state thì lần hai vẫn thấy
  // `false`, gọi `onLoadOlder` lần nữa và nhận 0 (hook chặn lần trùng) ⇒ tưởng hết lịch sử. `catchUp`
  // trong deps để effect chạy lại sau MỖI lần về, kể cả khi trang về không đổi `unreadAnchor`.
  useEffect(() => {
    if (openPhase !== "pending" || highlightMessageId !== null || !isFirstPageLoaded) return;
    if (unreadAnchor.kind !== "older-needed" || isLoadingOlder || catchUpInFlightRef.current)
      return;
    catchUpInFlightRef.current = true;
    // `pages` tăng khi trang ĐÃ VỀ, không lúc xin: tăng sớm thì trong lúc trang cuối còn bay
    // `canCatchUpOlder` đã `false` ⇒ phép định vị đặt vạch tạm ở tin cũ nhất đang giữ và chốt `done`, rồi
    // trang về prepend KHÔNG mỏ neo — khung nhìn trôi khỏi vạch, mốc thật trong trang đó bị bỏ qua.
    const settle = (added: number): void => {
      catchUpInFlightRef.current = false;
      setCatchUp((c) => ({ pages: c.pages + 1, exhausted: c.exhausted || added === 0 }));
    };
    onLoadOlder().then(settle, () => settle(0));
  }, [
    catchUp,
    highlightMessageId,
    isFirstPageLoaded,
    isLoadingOlder,
    onLoadOlder,
    openPhase,
    unreadAnchor,
  ]);

  // ── Cuộn tới tin được làm nổi (S7-CHAT-FE-4) ───────────────────────────────
  useEffect(() => {
    if (highlightMessageId === null) return;
    const el = scrollRef.current?.querySelector(
      `[data-message-id="${CSS.escape(highlightMessageId)}"]`,
    );
    // Tin đích KHÔNG có trong danh sách là ca thật (cửa sổ nạp hụt, tin bị thu hồi và lọc đi): không
    // cuộn còn hơn cuộn tới chỗ sai. Dải "đang xem ngữ cảnh" vẫn hiện nên người dùng có đường thoát.
    el?.scrollIntoView({ block: "center" });
  }, [highlightMessageId, messages]);

  // ── Đánh dấu đã đọc ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isNearBottom || !isPageVisible || messages.length === 0) return;
    // `document.hidden`: tab ở nền không phải là "đã đọc". Không có vế này thì mở 5 tab là badge tắt
    // sạch dù người dùng chưa nhìn cái nào. Giữ CẢ HAI phép kiểm có chủ ý: `isPageVisible` là state —
    // nằm trong deps để effect CHẠY LẠI khi tab hiện lại, nhưng tụt một nhịp so với thực tế (tin mới tới
    // trước khi `visibilitychange` kịp cập nhật state); đọc đồng bộ `document.hidden` chặn khe đó.
    if (typeof document !== "undefined" && document.hidden) return;
    const latestSeq = messages[messages.length - 1].roomSeq;
    setSeenUpToSeq((prev) => Math.max(prev, latestSeq));
    onMarkRead(latestSeq);
  }, [isNearBottom, isPageVisible, messages, onMarkRead]);

  // S20-CHAT-UNREAD-1 — tab quay lại tiền cảnh khi khung đang ở đáy ⇒ báo đọc NGAY. Không nghe sự kiện này
  // thì phòng mở ở tab nền giữ badge tới khi có tin mới, dù người dùng đã nhìn thấy hết.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = (): void => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const latestSeq = messages.length > 0 ? messages[messages.length - 1].roomSeq : null;
  const unseenCount = unseenCountBelow(latestSeq, seenUpToSeq);
  // Ẩn khi đang xem cửa sổ ngữ cảnh: «↓» ở đó chỉ xuống đáy CỬA SỔ, lối về tin mới nhất là dải ngữ cảnh.
  const showJump =
    openPhase === "done" && !isNearBottom && unseenCount > 0 && highlightMessageId === null;

  // ── Dẫn xuất "đã xem bởi" (§13.2) — không bảng riêng ───────────────────────
  //
  // S17: trả VIEWER (id · tên · ảnh) thay vì mảng tên, để `SeenByAvatars` vẽ được dãy mặt. Ảnh lấy từ
  // `avatarByUser` (ROSTER phòng, CHAT-DEC-019) — KHÔNG ký lẻ theo từng người ở tầng này.
  const seenByFor = useCallback(
    (roomSeq: number): SeenByViewer[] =>
      members
        .filter(
          (m) =>
            m.userId !== myUserId &&
            m.lastReadSeq !== undefined &&
            m.lastReadSeq >= roomSeq &&
            m.userName,
        )
        .map((m) => ({
          userId: m.userId,
          name: m.userName ?? null,
          avatarUrl: avatarByUser?.get(m.userId) ?? null,
        })),
    [members, myUserId, avatarByUser],
  );

  /**
   * S17 — dựng SẴN các cờ bố cục trong MỘT lượt, thay vì tính trong lúc `.map()` render.
   *
   * Lý do bắt buộc phải đổi: `isLastOfGroup` cần NHÌN TỚI tin kế tiếp, mà vòng render cũ chỉ giữ được
   * tin TRƯỚC (`previous`). Tính hai cờ ở hai nơi khác nhau là mở đường cho chúng lệch nhau — cụm mở
   * bằng luật này và đóng bằng luật kia.
   *
   * `grouped` giữ NGUYÊN thuật toán của S7/S8 (cùng người · cùng ngày · trong `GROUP_WINDOW_MS` · tin
   * `system` cắt cụm) — bài đếm avatar đang neo đúng luật này.
   */
  const rows = useMemo(() => {
    let previousDayKey = "";
    let previous: StoredChatMessage | null = null;
    const out = messages.map((message) => {
      const dayKey = dayKeyOf(message.createdAt);
      const showDay = dayKey !== previousDayKey;
      previousDayKey = dayKey;

      // S20-CHAT-UNREAD-1 — vạch chưa đọc CẮT cụm: tin ngay dưới vạch phải mang tên + ảnh người gửi,
      // không thì người đọc nối tiếp không biết đoạn mới bắt đầu bằng lời của ai.
      const grouped =
        previous !== null &&
        !showDay &&
        message.id !== dividerBeforeId &&
        previous.senderId === message.senderId &&
        previous.messageType !== "system" &&
        message.messageType !== "system" &&
        new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
          GROUP_WINDOW_MS;
      previous = message;
      return { message, showDay, grouped, isLastOfGroup: true };
    });

    // Tin i là CUỐI cụm khi tin i+1 mở cụm mới (hoặc không còn tin nào sau nó).
    for (let i = 0; i < out.length - 1; i += 1) out[i].isLastOfGroup = !out[i + 1].grouped;
    return out;
  }, [messages, dividerBeforeId]);

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto pb-2"
        data-testid="chat-message-scroll"
      >
        {historyLimitReached ? (
          <p className="px-3 py-3 text-center text-xs text-muted-foreground">
            {t("conversation.historyLimitReached", { count: MAX_HISTORY_PER_ROOM })}
          </p>
        ) : hasMoreOlder ? (
          <div className="flex justify-center py-2">
            {isLoadingOlder ? (
              <div className="w-full space-y-2 px-3" aria-busy="true">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={triggerLoadOlder}>
                {t("conversation.loadOlder")}
              </Button>
            )}
          </div>
        ) : messages.length > 0 ? (
          <p className="px-3 py-3 text-center text-xs text-muted-foreground">
            {t("conversation.historyStart")}
          </p>
        ) : null}

        {rows.map(({ message, showDay, grouped, isLastOfGroup }) => {
          const isHighlighted = message.id === highlightMessageId;

          return (
            <div
              key={message.id}
              className={cn(
                isHighlighted &&
                  "rounded-md bg-primary/10 ring-1 ring-primary/40 ring-inset transition-colors",
              )}
              data-highlighted={isHighlighted ? "true" : undefined}
            >
              {showDay && (
                /*
                 * S17 — dải ngày DÍNH ĐỈNH khung cuộn: cuộn sâu vào giữa một ngày dài thì mốc ngày đã
                 * trôi khỏi màn hình và người đọc mất neo thời gian. `z-[5]` nằm DƯỚI thanh tác vụ nổi
                 * (`z-10`) để thanh không bị dải ngày cắt ngang khi hai thứ chạm nhau.
                 */
                <div className="sticky top-0 z-[5] flex items-center gap-3 bg-background/90 px-3 py-2 backdrop-blur-sm">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[11px] text-muted-foreground">
                    {formatDayLabel(message.createdAt, {
                      today: t("time.today"),
                      yesterday: t("time.yesterday"),
                    })}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              {message.id === dividerBeforeId && unread !== null && (
                <UnreadDivider
                  label={t("conversation.unreadDivider", { count: unread.count })}
                  aboveLabel={
                    unreadAnchor.kind === "message" && unreadAnchor.truncated
                      ? t("conversation.unreadAbove")
                      : null
                  }
                />
              )}
              <MessageBubble
                message={message}
                isMine={myUserId !== null && message.senderId === myUserId}
                isGrouped={grouped}
                isLastOfGroup={isLastOfGroup}
                replyTo={
                  message.replyToMessageId !== null ? byId.get(message.replyToMessageId) : undefined
                }
                canRecall={
                  canRecallPair &&
                  canRecallMessage({ message, myUserId, myRole, roomType: room.roomType })
                }
                canPin={canPinPair && !room.isArchived}
                seenBy={seenByFor(message.roomSeq)}
                senderAvatarUrl={avatarByUser?.get(message.senderId) ?? null}
                senderNameFallback={nameByUser?.get(message.senderId) ?? null}
                isArchived={room.isArchived ?? false}
                actions={actions}
              />
            </div>
          );
        })}

        {/*
         * Bong bóng LẠC QUAN — dưới cùng, không có `roomSeq` nên không xen vào thứ tự thật.
         *
         * S17: tin đang gửi LUÔN là tin của tôi ⇒ phải áp lề PHẢI và mang đúng nền `--bubble-mine` như
         * bong bóng thật. Để nó lề trái là tin "nhảy" từ trái sang phải ngay khi server xác nhận —
         * chuyển động không ai giải thích được và trông như gửi nhầm chỗ.
         */}
        {pending.map((p) => (
          <div
            key={p.clientMessageId}
            className="flex justify-end px-3 py-1"
            data-testid={`chat-pending-${p.status}`}
          >
            <div
              className={
                p.status === "failed"
                  ? "max-w-[min(42rem,78%)] rounded-2xl rounded-br-sm border border-destructive/50 px-3 py-2"
                  : "max-w-[min(42rem,78%)] rounded-2xl rounded-br-sm bg-bubble-mine px-3 py-2 opacity-60"
              }
            >
              <p className="whitespace-pre-wrap break-words text-sm">{p.body}</p>
              {p.status === "sending" ? (
                <p className="text-[11px] text-muted-foreground">{t("composer.sending")}</p>
              ) : (
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[11px] text-destructive">{t("composer.failed")}</span>
                  <Button variant="ghost" size="sm" onClick={() => onResendPending(p)}>
                    {t("composer.resend")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onDiscardPending(p)}>
                    {t("composer.discard")}
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {showJump && (
        <Button
          size="sm"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 gap-1 shadow-md"
          onClick={scrollToBottom}
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          {t("conversation.newMessagesCount", { count: unseenCount })}
        </Button>
      )}
    </div>
  );
}

/**
 * S20-CHAT-UNREAD-1 — vạch «N tin chưa đọc» (SPEC-15 §13.2). `aboveLabel` khác `null` khi vạch dừng ở tin
 * cũ nhất đang giữ vì không với được tới mốc: nói thẳng còn tin chưa đọc phía trên thay vì để người dùng
 * tưởng đây là tin chưa đọc đầu tiên.
 *
 * KHÔNG `role="separator"`: con của separator bị coi là trình bày và trình đọc màn hình bỏ qua dòng
 * «còn tin chưa đọc phía trên» — đúng câu cần đọc lên.
 */
function UnreadDivider({
  label,
  aboveLabel,
}: {
  label: string;
  aboveLabel: string | null;
}): React.ReactElement {
  return (
    <div className="px-3 py-2" data-testid={UNREAD_DIVIDER_TESTID}>
      {aboveLabel !== null && (
        <p className="pb-1 text-center text-[11px] text-muted-foreground">{aboveLabel}</p>
      )}
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-destructive/50" aria-hidden="true" />
        <span className="text-[11px] font-medium text-destructive">{label}</span>
        <span className="h-px flex-1 bg-destructive/50" aria-hidden="true" />
      </div>
    </div>
  );
}
