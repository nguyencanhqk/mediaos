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
import { MessageBubble, type MessageBubbleActions } from "./MessageBubble";

/** Khoảng cách tới ĐỈNH đủ để coi là "đang muốn xem tiếp lịch sử". */
const LOAD_OLDER_THRESHOLD_PX = 60;

/** Cùng người gửi + cách nhau dưới ngưỡng này ⇒ gộp (không lặp avatar + tên). */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

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
   * S7-CHAT-FE-4 — tin cần LÀM NỔI + cuộn tới (đích của một lần nhảy từ tìm kiếm/ghim/tệp).
   *
   * `null` = không có gì để làm nổi. Khi khác `null`, danh sách **không** tự cuộn xuống đáy dù đây là
   * lần vẽ đầu: kéo người dùng xuống đáy ngay sau khi họ bấm vào một kết quả ở giữa lịch sử là huỷ đúng
   * thao tác họ vừa làm.
   */
  highlightMessageId?: string | null;
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
  highlightMessageId = null,
  onLoadOlder,
  onMarkRead,
  onResendPending,
  onDiscardPending,
  actions,
}: MessageListProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setNearBottom] = useState(true);
  const [hasUnseenBelow, setUnseenBelow] = useState(false);

  /** Ảnh chụp hình học NGAY TRƯỚC khi prepend — `null` khi không có lần nạp lịch sử nào đang bay. */
  const anchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setUnseenBelow(false);
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
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
    setNearBottom(near);
    if (near) setUnseenBelow(false);
    if (el.scrollTop <= LOAD_OLDER_THRESHOLD_PX) triggerLoadOlder();
  }, [triggerLoadOlder]);

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

    // Người dùng đang đọc tin cũ ⇒ TUYỆT ĐỐI không kéo khung nhìn của họ. Chỉ báo có tin mới.
    if (isFirstPaint || isNearBottom) scrollToBottom();
    else setUnseenBelow(true);
  }, [messages, isNearBottom, scrollToBottom, highlightMessageId]);

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
    if (!isNearBottom || messages.length === 0) return;
    // `document.hidden`: tab ở nền không phải là "đã đọc". Không có vế này thì mở 5 tab là badge tắt
    // sạch dù người dùng chưa nhìn cái nào.
    if (typeof document !== "undefined" && document.hidden) return;
    onMarkRead(messages[messages.length - 1].roomSeq);
  }, [isNearBottom, messages, onMarkRead]);

  // ── Dẫn xuất "đã xem bởi" (§13.2) — không bảng riêng ───────────────────────
  const seenByFor = useCallback(
    (roomSeq: number): string[] =>
      members
        .filter(
          (m) =>
            m.userId !== myUserId &&
            m.lastReadSeq !== undefined &&
            m.lastReadSeq >= roomSeq &&
            m.userName,
        )
        .map((m) => m.userName as string),
    [members, myUserId],
  );

  let previousDayKey = "";
  let previous: StoredChatMessage | null = null;

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

        {messages.map((message) => {
          const dayKey = dayKeyOf(message.createdAt);
          const showDay = dayKey !== previousDayKey;
          previousDayKey = dayKey;

          const grouped =
            previous !== null &&
            !showDay &&
            previous.senderId === message.senderId &&
            previous.messageType !== "system" &&
            message.messageType !== "system" &&
            new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
              GROUP_WINDOW_MS;
          previous = message;

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
                <div className="my-2 flex items-center gap-3 px-3">
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
              <MessageBubble
                message={message}
                isMine={myUserId !== null && message.senderId === myUserId}
                isGrouped={grouped}
                replyTo={
                  message.replyToMessageId !== null ? byId.get(message.replyToMessageId) : undefined
                }
                canRecall={
                  canRecallPair &&
                  canRecallMessage({ message, myUserId, myRole, roomType: room.roomType })
                }
                canPin={canPinPair && !room.isArchived}
                seenBy={seenByFor(message.roomSeq)}
                actions={actions}
              />
            </div>
          );
        })}

        {/* Bong bóng LẠC QUAN — dưới cùng, không có `roomSeq` nên không xen vào thứ tự thật. */}
        {pending.map((p) => (
          <div
            key={p.clientMessageId}
            className="px-3 py-1 pl-13"
            data-testid={`chat-pending-${p.status}`}
          >
            <div
              className={
                p.status === "failed"
                  ? "rounded-md border border-destructive/50 px-3 py-2"
                  : "opacity-60"
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

      {hasUnseenBelow && (
        <Button
          size="sm"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 gap-1 shadow-md"
          onClick={scrollToBottom}
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          {t("conversation.newMessages")}
        </Button>
      )}
    </div>
  );
}
