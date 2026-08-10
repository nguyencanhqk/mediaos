/**
 * S7-CHAT-FE-2 — cột giữa: đầu phòng · danh sách tin · ô soạn (SPEC-15 §9 CHAT-SCREEN-001).
 *
 * Nơi ghép mọi mảnh: `useChatConversation` lo con trỏ/IO, `MessageList` lo cuộn/DOM, `MessageComposer`
 * lo nháp. Component này chỉ nối chúng và giữ ba trạng thái ĐIỀU PHỐI: tin đang trả lời, hộp xác nhận
 * thu hồi, và bản đồ `clientMessageId → fileIds` để "Gửi lại" không đánh rơi tệp.
 */
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { History, Info, MessageSquare } from "lucide-react";
import { ApiError, chatApi, chatKeys, useCan } from "@mediaos/web-core";
import { Button, EmptyState, Skeleton } from "@mediaos/ui";
import type { ChatReactionEmoji, ChatRoomDto, ChatRoomMemberDto } from "@mediaos/contracts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useChatStore, type PendingChatMessage, type StoredChatMessage } from "@/stores/chat.store";
import { CHAT_PAIRS } from "@/routes/chat/constants";
import { ConnectionBanner } from "./ConnectionBanner";
import { MessageComposer, type ComposerSubmitPayload } from "./MessageComposer";
import { MessageList } from "./MessageList";
import { TypingIndicator } from "./TypingIndicator";
import { roomDisplayName } from "./chat-format";
import { useChatConversation } from "./use-chat-conversation";
import { useRoomRoster } from "./use-room-roster";
import { CallButtons } from "./call/CallButtons";
import { useOptionalCallContext } from "./call/CallProvider";

interface ConversationPanelProps {
  room: ChatRoomDto;
  members: readonly ChatRoomMemberDto[];
  myRole: "member" | "admin" | null;
  isInfoOpen?: boolean;
  onToggleInfo?: () => void;
  /**
   * S7-CHAT-FE-3 — vẽ thanh đầu phòng (tên + nút ⓘ) hay không. Mặc định `true` (trang `/chat`).
   *
   * Panel nổi truyền `false` vì nó CÓ thanh tiêu đề riêng với affordance khác hẳn (thu nhỏ · đóng · mở
   * toàn màn hình). Hai thanh chồng nhau trong một cửa sổ cao 26rem là ăn mất ~15% chiều cao đọc tin.
   *
   * Đây là MỘT cờ hiển thị, KHÔNG phải một chế độ: không có nhánh logic nào khác rẽ theo nó. Mọi hành vi
   * còn lại (gửi · gửi lại · thu hồi · ghim · cuộn ngược · đánh dấu đã đọc · banner mất kết nối) giống
   * hệt trang — đó là lý do panel nổi dùng LẠI component này thay vì có bản rút gọn của riêng nó.
   */
  showHeader?: boolean;
}

export function ConversationPanel({
  room,
  members,
  myRole,
  isInfoOpen = false,
  onToggleInfo,
  showHeader = true,
}: ConversationPanelProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const queryClient = useQueryClient();

  const canRecallPair = useCan(
    CHAT_PAIRS.RECALL_MESSAGE.action,
    CHAT_PAIRS.RECALL_MESSAGE.resourceType,
  );
  const canPinPair = useCan(CHAT_PAIRS.PIN_MESSAGE.action, CHAT_PAIRS.PIN_MESSAGE.resourceType);

  const myUserId = useChatStore((s) => s.myUserId);
  const messages = useChatStore((s) => s.messagesByRoom[room.id]);
  const pendingMap = useChatStore((s) => s.pendingByClientId);
  const discardPendingSend = useChatStore((s) => s.discardPendingSend);
  const applyIncomingMessage = useChatStore((s) => s.applyIncomingMessage);
  // S7-CHAT-FE-4 — phòng này có đang xem NGỮ CẢNH của một kết quả tìm kiếm/ghim/tệp không.
  const context = useChatStore((s) => s.contextByRoom[room.id]);
  const exitMessageContext = useChatStore((s) => s.exitMessageContext);

  const conversation = useChatConversation(room.id);

  /**
   * S8-CHAT-UX-FE-3 — ROSTER phòng: nguồn avatar + tên người gửi (CHAT-DEC-019) và ảnh chụp "đang online".
   * Đây là nguồn KHÁC `members` (prop, từ `getRoom`): roster gồm cả người ĐÃ RỜI. Xem `use-room-roster.ts`.
   */
  const roster = useRoomRoster(room.id);
  const patchMessageReactions = useChatStore((s) => s.patchMessageReactions);

  /** S7-CALL-FE-1 — `null` khi cây không có `<CallProvider>` (test lẻ). Xem chỗ dùng ở thanh đầu phòng. */
  const callContext = useOptionalCallContext();

  /**
   * Rời chế độ ngữ cảnh về dòng thời gian mới nhất.
   *
   * HAI vế bắt buộc đi cùng: `exitMessageContext` xoá mỏ neo **và** danh sách cũ, `reload()` nạp lại
   * trang mới nhất. Thiếu vế hai thì phòng đứng trắng cho tới khi người dùng đổi sang phòng khác rồi
   * quay lại — trạng thái trông y hệt "mất mạng".
   */
  const leaveContext = useCallback(() => {
    exitMessageContext(room.id);
    conversation.reload();
  }, [conversation, exitMessageContext, room.id]);

  const [replyTo, setReplyTo] = useState<StoredChatMessage | null>(null);
  const [recallTarget, setRecallTarget] = useState<StoredChatMessage | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * `clientMessageId → fileIds` của những lần gửi ĐANG chờ.
   *
   * `PendingChatMessage` (FE-1) chỉ mang `body` — cố ý, vì nó là hình dạng dùng chung với panel nổi.
   * Không giữ bản đồ này thì bấm "Gửi lại" một tin có 3 tệp sẽ gửi lại **mỗi phần chữ**, im lặng đánh
   * rơi tệp: người dùng thấy tin gửi thành công và tin đó thiếu đúng thứ họ muốn gửi.
   */
  const pendingFileIdsRef = useRef<Record<string, string[]>>({});

  const pendingForRoom: PendingChatMessage[] = Object.values(pendingMap).filter(
    (p) => p.roomId === room.id,
  );

  const submit = useCallback(
    async (payload: ComposerSubmitPayload): Promise<boolean> => {
      // S7-CHAT-FE-4 — gửi tin trong lúc đang xem ngữ cảnh ⇒ RỜI ngữ cảnh TRƯỚC. Tin vừa gửi có
      // `roomSeq` lớn hơn cửa sổ nên chốt chèn sẽ chặn nó: người dùng bấm Gửi, thấy bong bóng "đang
      // gửi" rồi… không thấy tin đâu. Không có thông báo lỗi nào vì không có lỗi nào cả.
      if (context !== undefined) leaveContext();
      if (payload.fileIds.length > 0) {
        pendingFileIdsRef.current[payload.clientMessageId] = payload.fileIds;
      }
      const ok = await conversation.sendMessage({
        clientMessageId: payload.clientMessageId,
        body: payload.body,
        fileIds: payload.fileIds,
        ...(payload.replyToMessageId ? { replyToMessageId: payload.replyToMessageId } : {}),
      });
      if (ok) delete pendingFileIdsRef.current[payload.clientMessageId];
      return ok;
    },
    [context, conversation, leaveContext],
  );

  const resend = useCallback(
    (p: PendingChatMessage) => {
      // ⚠️ TÁI DÙNG `p.clientMessageId` — KHÔNG sinh khoá mới. Khoá mới nghĩa là "tin mới" với server,
      // và nếu lần gửi trước thật ra đã tới nơi thì người dùng nhận HAI tin giống hệt.
      void conversation.sendMessage({
        clientMessageId: p.clientMessageId,
        body: p.body,
        fileIds: pendingFileIdsRef.current[p.clientMessageId] ?? [],
      });
    },
    [conversation],
  );

  const discard = useCallback(
    (p: PendingChatMessage) => {
      delete pendingFileIdsRef.current[p.clientMessageId];
      discardPendingSend(p.clientMessageId);
    },
    [discardPendingSend],
  );

  const recallMutation = useMutation({
    mutationFn: (messageId: string) => chatApi.recallMessage(messageId),
    onSuccess: (updated) => {
      // Response POST đã là bản ĐÃ che (`body: null` + `recalledAt`) — nạp thẳng, không chờ echo WS:
      // ở `polling-fallback` không có echo nào cả và tin sẽ hiện nguyên nội dung tới nhịp bù kế tiếp.
      applyIncomingMessage(updated);
      void queryClient.invalidateQueries({ queryKey: chatKeys.rooms.pinned(room.id) });
      setRecallTarget(null);
    },
    onError: () => setActionError(t("message.recallFailed")),
  });

  const pinMutation = useMutation({
    mutationFn: ({ messageId, pinned }: { messageId: string; pinned: boolean }) =>
      pinned ? chatApi.unpinMessage(messageId) : chatApi.pinMessage(messageId),
    onSuccess: (updated) => {
      applyIncomingMessage(updated);
      void queryClient.invalidateQueries({ queryKey: chatKeys.rooms.pinned(room.id) });
    },
    onError: (err: unknown) => {
      // 409 = chạm trần 20 tin ghim/phòng — thông điệp riêng, vì "không ghim được" không cho người dùng
      // biết phải làm gì tiếp.
      setActionError(
        err instanceof ApiError && err.status === 409
          ? t("message.pinLimitReached")
          : t("message.pinFailed"),
      );
    },
  });

  /**
   * S8-CHAT-UX-FE-3 — bật/tắt một cảm xúc (CHAT-FUNC-019).
   *
   * ⚠️ Cập nhật LẠC QUAN + HOÀN NGUYÊN, và bản chụp `previous` phải lấy **trong `onClick`** (tức ở đây,
   * trước khi gọi API) chứ không đọc store bên trong `mutationFn`: đọc state trong `mutationFn` cho ta
   * giá trị của lần render lúc mutation được TẠO, không phải lúc nó CHẠY
   * (memory `react-query-v5-stale-mutationfn-closure`). Sai bản chụp ⇒ "hoàn nguyên" ghi đè bằng một
   * trạng thái cũ hơn nữa, và người dùng thấy cảm xúc của người khác biến mất.
   */
  const toggleReaction = useCallback(
    (message: StoredChatMessage, emoji: ChatReactionEmoji, currentlyMine: boolean) => {
      const previous = message.reactions ?? [];
      const optimistic = currentlyMine
        ? previous
            .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r))
            // `count` chạm 0 ⇒ bỏ hẳn khỏi mảng: `chatMessageReactionSchema.count` là `.positive()`, một
            // phần tử `count: 0` là hình dạng server KHÔNG BAO GIỜ trả và không có gì để vẽ.
            .filter((r) => r.count > 0)
        : previous.some((r) => r.emoji === emoji)
          ? previous.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r))
          : [...previous, { emoji, count: 1, mine: true }];

      patchMessageReactions(room.id, message.id, optimistic);

      const request = currentlyMine
        ? chatApi.unreactFromMessage(message.id, emoji).then(() => null)
        : chatApi.reactToMessage(message.id, emoji);

      void request
        .then((fresh) => {
          // `PUT` trả tổng hợp mới KÈM `mine` ⇒ thay thẳng (chính xác tuyệt đối, kể cả khi người khác vừa
          // thả cùng lúc). `DELETE` là 204 không thân ⇒ giữ bản lạc quan; sự kiện `chat:reaction` sẽ hoà
          // con số thật về ngay sau đó.
          if (fresh !== null) patchMessageReactions(room.id, message.id, fresh);
        })
        .catch(() => {
          // HOÀN NGUYÊN — cùng một hàm, gọi lại với giá trị TRƯỚC. Im lặng ở đây là để lại một con số sai
          // trên màn hình vĩnh viễn, và người dùng không có cách nào biết thao tác của họ đã trượt.
          patchMessageReactions(room.id, message.id, previous);
          setActionError(t("reaction.failed"));
        });
    },
    [patchMessageReactions, room.id, t],
  );

  const title = roomDisplayName(room, members, myUserId, (code) =>
    t("rooms.directFallback", { code }),
  );

  /**
   * Chấm "đang online" — CHỈ ở phòng `direct` (`done_when #5`).
   *
   * KHÔNG vẽ ở phòng nhóm/phòng ban/dự án: sự kiện `chat:presence` chỉ fan-out tới peer DM (cố ý — phát
   * trạng thái online của mọi người tới mọi phòng họ tham gia là rò lịch làm việc), nên ở phòng đông
   * người con số vừa nhiễu vừa CŨ. Danh sách thành viên có chấm riêng (ảnh chụp, `RoomInfoPanel`).
   */
  const directPeerId =
    room.roomType === "direct"
      ? (roster.members.find((m) => m.userId !== myUserId && !m.leftAt)?.userId ?? null)
      : null;
  const isPeerOnline = useChatStore((s) =>
    directPeerId === null ? false : (s.presenceByUser[directPeerId] ?? false),
  );

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col" aria-label={title}>
      {showHeader && (
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              {directPeerId !== null && isPeerOnline && (
                <>
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                    aria-hidden="true"
                    data-testid="chat-peer-online-dot"
                  />
                  {/* Chấm màu là tín hiệu THỊ GIÁC — người đọc màn hình cần chữ, không có chữ thì trạng
                      thái này đơn giản không tồn tại với họ. */}
                  <span className="sr-only">{t("presence.online")}</span>
                </>
              )}
              <span className="truncate">
                {t(`rooms.types.${room.roomType}`)}
                {members.length > 0 &&
                  ` · ${t("conversation.membersCount", { count: members.length })}`}
              </span>
            </p>
          </div>
          {/*
           * S7-CALL-FE-1 — nút gọi. `callContext === null` (cây không có `<CallProvider>`: test lẻ,
           * story) ⇒ KHÔNG render: một nút gọi không có máy trạng thái phía sau là nút bấm không có
           * gì xảy ra. Cổng quyền + cổng 1-1 nằm trong chính `CallButtons`.
           */}
          {callContext !== null && (
            <CallButtons
              room={room}
              members={roster.members}
              isBusy={callContext.phase !== "idle"}
              onStartCall={(kind) => callContext.startCall(room.id, kind)}
            />
          )}
          {onToggleInfo && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                isInfoOpen ? t("conversation.infoToggleClose") : t("conversation.infoToggle")
              }
              aria-pressed={isInfoOpen}
              onClick={onToggleInfo}
            >
              <Info className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </header>
      )}

      <ConnectionBanner />

      {/*
       * Dải "đang xem ngữ cảnh" — bắt buộc phải LUÔN hiện khi chốt chèn đang bật (§0.5 của plan): trong
       * chế độ này tin mới không rơi vào danh sách, và một phòng im lặng không có lời giải thích là
       * trạng thái không phân biệt được với hỏng.
       */}
      {context !== undefined && (
        <div
          className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2 text-xs"
          role="status"
          data-testid="chat-context-banner"
        >
          <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-muted-foreground">
            {t("conversation.contextMode")}
          </span>
          <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={leaveContext}>
            {t("conversation.contextExit")}
          </Button>
        </div>
      )}

      {actionError !== null && (
        <p
          className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          {actionError}
        </p>
      )}

      {conversation.isInitialLoading ? (
        <div className="flex-1 space-y-3 p-4" aria-busy="true" data-testid="chat-messages-loading">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-10 w-3/5" />
        </div>
      ) : conversation.loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
          <p className="text-sm text-muted-foreground">{t("conversation.loadError")}</p>
          <Button variant="outline" size="sm" onClick={conversation.reload}>
            {t("conversation.retry")}
          </Button>
        </div>
      ) : (messages?.length ?? 0) === 0 && pendingForRoom.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={MessageSquare}
            title={t("conversation.empty")}
            description={t("conversation.emptyHint")}
          />
        </div>
      ) : (
        <MessageList
          room={room}
          messages={messages ?? []}
          pending={pendingForRoom}
          members={members}
          myUserId={myUserId}
          myRole={myRole}
          canRecallPair={canRecallPair}
          canPinPair={canPinPair}
          hasMoreOlder={conversation.hasMoreOlder}
          isLoadingOlder={conversation.isLoadingOlder}
          historyLimitReached={conversation.historyLimitReached}
          highlightMessageId={context?.targetMessageId ?? null}
          avatarByUser={roster.avatarByUser}
          nameByUser={roster.nameByUser}
          onLoadOlder={conversation.loadOlder}
          onMarkRead={conversation.markReadUpTo}
          onResendPending={resend}
          onDiscardPending={discard}
          actions={{
            onReply: setReplyTo,
            onPin: (m) => pinMutation.mutate({ messageId: m.id, pinned: false }),
            onUnpin: (m) => pinMutation.mutate({ messageId: m.id, pinned: true }),
            onRecall: setRecallTarget,
            onToggleReaction: toggleReaction,
          }}
        />
      )}

      {/* Dải "đang gõ" — GIỮA danh sách và ô soạn, đúng chỗ mắt người tìm nó. Nằm NGOÀI nhánh điều kiện
          ở trên để nó vẫn hiện khi phòng đang rỗng: người kia gõ tin ĐẦU TIÊN của phòng là lúc chỉ báo
          có ích nhất. */}
      <TypingIndicator roomId={room.id} nameByUser={roster.nameByUser} />

      <MessageComposer
        roomId={room.id}
        isArchived={room.isArchived ?? false}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSubmit={submit}
      />

      {recallTarget !== null && (
        <ConfirmDialog
          open
          title={t("message.recallConfirmTitle")}
          description={t("message.recallConfirmBody")}
          confirmLabel={t("message.recallConfirmAction")}
          cancelLabel={t("message.cancel")}
          destructive
          busy={recallMutation.isPending}
          onConfirm={() => recallMutation.mutate(recallTarget.id)}
          onCancel={() => setRecallTarget(null)}
        />
      )}
    </section>
  );
}
