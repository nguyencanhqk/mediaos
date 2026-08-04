/**
 * S7-CHAT-FE-2 — mọi I/O của MỘT phòng đang mở: nạp trang đầu · cuộn ngược `beforeSeq` · gửi tin ·
 * đánh dấu đã đọc (SPEC-15 §13.1 · §13.2 · §14).
 *
 * Vì sao hook riêng chứ không nhét vào component: `ConversationPanel` phải lo cuộn/neo/DOM, còn đây lo
 * con trỏ và đua bất đồng bộ. Trộn hai thứ là cách chắc chắn nhất để một `await` chen vào giữa phép đo
 * `scrollHeight` và phép bù `scrollTop`.
 *
 * Dữ liệu KHÔNG ở đây: tin sống trong `useChatStore` (dùng chung với panel nổi FE-3). Hook chỉ đẩy vào
 * store và trả về trạng thái tải/lỗi.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, chatApi } from "@mediaos/web-core";
import type { SendMessageRequest } from "@mediaos/contracts";
import { MAX_HISTORY_PER_ROOM, useChatStore } from "@/stores/chat.store";
import { MARK_READ_DEBOUNCE_MS, MESSAGE_PAGE_SIZE } from "@/routes/chat/constants";

export interface ChatConversationState {
  /** Trang đầu đang tải (chưa có tin nào trong store cho phòng này). */
  isInitialLoading: boolean;
  /** Lỗi nạp tin — KHÔNG bao gồm lỗi gửi (gửi có trạng thái riêng ở `pendingByClientId`). */
  loadError: boolean;
  isLoadingOlder: boolean;
  /** `room_seq` liên tục từ 1 (mig 0539) + v1 `visible_from_seq` luôn NULL ⇒ so sánh là đủ, không cần cờ. */
  hasMoreOlder: boolean;
  /** Đã chạm trần lịch sử giữ trong bộ nhớ ⇒ ngừng MỜI tải thêm và nói rõ, không âm thầm cắt. */
  historyLimitReached: boolean;
  reload: () => void;
  loadOlder: () => Promise<number>;
  sendMessage: (input: SendChatMessageInput) => Promise<boolean>;
  markReadUpTo: (seq: number) => void;
}

export interface SendChatMessageInput {
  /** Sinh MỘT LẦN lúc bắt đầu soạn; bấm "gửi lại" phải truyền LẠI đúng khoá này (server dedupe theo nó). */
  clientMessageId: string;
  body: string;
  fileIds?: string[];
  replyToMessageId?: string;
}

export function useChatConversation(roomId: string | null): ChatConversationState {
  const [isInitialLoading, setInitialLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [isLoadingOlder, setLoadingOlder] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const messages = useChatStore((s) => (roomId ? s.messagesByRoom[roomId] : undefined));
  const oldestSeq = messages?.length ? messages[0].roomSeq : undefined;
  const messageCount = messages?.length ?? 0;

  /**
   * Phòng mà lần nạp đang bay THUỘC VỀ. Người dùng bấm nhanh qua 3 phòng thì 3 request cùng bay; response
   * về không theo thứ tự gửi. Không có chốt này thì tin phòng A đổ vào lúc đang mở phòng C — và vì
   * `applyIncomingMessage` gắn tin theo `message.roomId` nên dữ liệu KHÔNG sai, chỉ có trạng thái
   * loading/error nhấp nháy sai phòng. Vẫn phải chặn: trạng thái lỗi treo ở phòng khoẻ là bug người dùng
   * thấy được.
   */
  const activeRoomRef = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);

  // ── Trang đầu + vòng đời theo dõi phòng ────────────────────────────────────
  useEffect(() => {
    activeRoomRef.current = roomId;
    if (!roomId) return;

    const store = useChatStore.getState();
    store.subscribeToRoom(roomId);

    let cancelled = false;
    const already = (store.messagesByRoom[roomId]?.length ?? 0) > 0;
    // Đã có tin trong store (WS đẩy về từ trước, hoặc quay lại phòng vừa xem) ⇒ không gọi lại trang đầu.
    // Lưới bù + `chat:message` giữ nó tươi; gọi lại chỉ tốn round-trip và làm nhấp nháy skeleton.
    if (!already) setInitialLoading(true);
    setLoadError(false);

    void chatApi
      .getMessages(roomId, { limit: MESSAGE_PAGE_SIZE })
      .then((page) => {
        if (cancelled || activeRoomRef.current !== roomId) return;
        for (const message of page) useChatStore.getState().applyIncomingMessage(message);
      })
      .catch((err: unknown) => {
        if (cancelled || activeRoomRef.current !== roomId) return;
        // 404 = `assertMember` từ chối ⇒ mình không (còn) thuộc phòng. Dọn store thay vì hiện "lỗi tải":
        // phòng ma ở lại danh sách với badge cũ là thứ người dùng bấm mãi không vào được.
        if (err instanceof ApiError && err.status === 404) {
          useChatStore.getState().removeRoomForSelf(roomId);
          return;
        }
        setLoadError(true);
        console.error(`[chat] không tải được tin của phòng ${roomId}:`, err);
      })
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });

    return () => {
      cancelled = true;
      const s = useChatStore.getState();
      s.unsubscribeFromRoom(roomId);
      // Trả RAM về trần sống. Gọi Ở CLEANUP chứ không lúc đang xem: cắt danh sách trong khi khung nhìn
      // đang neo vào một tin cũ là cách chắc chắn làm cuộn nhảy (plan §3).
      s.trimRoomHistory(roomId);
    };
  }, [roomId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  // ── Cuộn ngược ─────────────────────────────────────────────────────────────
  const loadOlder = useCallback(async (): Promise<number> => {
    if (!roomId || loadingOlderRef.current) return 0;
    const current = useChatStore.getState().oldestKnownSeq(roomId);
    if (current === undefined || current <= 1) return 0;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await chatApi.getMessages(roomId, {
        beforeSeq: current,
        limit: MESSAGE_PAGE_SIZE,
      });
      if (activeRoomRef.current !== roomId) return 0;
      const before = useChatStore.getState().messagesByRoom[roomId]?.length ?? 0;
      // `prependOlderMessages`, KHÔNG phải `applyIncomingMessage`: đường kia BỎ QUA tin cũ hơn mọi tin
      // đang giữ khi danh sách đã đầy ⇒ từ trang thứ hai trở đi nút "tải thêm" im lặng không làm gì
      // (plan §0.4). Nó còn đụng `unreadCount` của phòng, mà tin CŨ không được quyền chạm.
      useChatStore.getState().prependOlderMessages(roomId, page);
      const after = useChatStore.getState().messagesByRoom[roomId]?.length ?? 0;
      return after - before;
    } catch (err: unknown) {
      if (activeRoomRef.current === roomId) {
        console.error(`[chat] không tải được tin cũ hơn của phòng ${roomId}:`, err);
      }
      return 0;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [roomId]);

  // ── Gửi ────────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (input: SendChatMessageInput): Promise<boolean> => {
      if (!roomId) return false;
      const store = useChatStore.getState();
      store.applyOptimisticSend(input.clientMessageId, roomId, input.body);

      const payload: SendMessageRequest = {
        body: input.body,
        clientMessageId: input.clientMessageId,
        ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
        ...(input.fileIds && input.fileIds.length > 0 ? { fileIds: input.fileIds } : {}),
      };

      try {
        const sent = await chatApi.sendMessage(roomId, payload);
        // Bong bóng tạm CHỈ được giải quyết bởi CHÍNH response POST của nó (FE-1 §R3.4) — ghép theo thứ
        // tự với echo WS từng nuốt mất tin gửi lỗi.
        useChatStore.getState().resolvePendingSend(input.clientMessageId, sent);
        return true;
      } catch (err: unknown) {
        // GIỮ entry ở trạng thái `failed`: nút "Gửi lại" phải dùng LẠI đúng `clientMessageId` cũ để
        // server dedupe. Xoá entry ở đây là xoá luôn chữ người dùng vừa gõ.
        useChatStore.getState().resolvePendingSend(input.clientMessageId, null);
        console.error("[chat] gửi tin thất bại:", err);
        return false;
      }
    },
    [roomId],
  );

  // ── Nâng cấp đính kèm đến từ WS ────────────────────────────────────────────
  /**
   * Tin đẩy về qua WS mang đính kèm **không có URL ký** (`attachmentUrl` → `undefined`) — masking cố ý,
   * vì quyết định ký là per-recipient còn emit là fan-out một payload cho cả phòng.
   * `wsChatAttachmentSchema` dặn client tự đi hỏi REST bản của CHÍNH MÌNH.
   *
   * Không có vòng này thì tệp mới gửi đứng ở "đang lấy liên kết" VĨNH VIỄN khi WS khoẻ — lưới bù chỉ
   * chạy lúc mất kết nối. `insertMessage` đã có sẵn đường NÂNG CẤP `attachments` khi trùng `id`
   * (FE-1 dựng đúng cho tình huống này), nên chỉ cần kéo lại trang mới nhất.
   *
   * `attemptedRef` chặn vòng lặp: mỗi tin chỉ xin MỘT lần. Server trả `url: null` (từ chối ký) cũng là
   * một câu trả lời — nó chuyển trạng thái sang "không tải được" và điều kiện tự tắt; nhưng nếu request
   * hỏng thì không có cờ này ta sẽ nện API mỗi lần render.
   */
  const attemptedRef = useRef<Set<string>>(new Set());
  const unresolvedIds = useMemo(
    () =>
      (messages ?? [])
        .filter((m) => m.attachments.some((a) => !("url" in a)))
        .map((m) => m.id)
        .filter((id) => !attemptedRef.current.has(id)),
    [messages],
  );

  useEffect(() => {
    if (!roomId || unresolvedIds.length === 0) return;
    for (const id of unresolvedIds) attemptedRef.current.add(id);
    void chatApi
      .getMessages(roomId, { limit: MESSAGE_PAGE_SIZE })
      .then((page) => {
        if (activeRoomRef.current !== roomId) return;
        for (const message of page) useChatStore.getState().applyIncomingMessage(message);
      })
      .catch((err: unknown) => {
        console.error(`[chat] không lấy được liên kết tệp của phòng ${roomId}:`, err);
      });
  }, [roomId, unresolvedIds]);

  useEffect(() => {
    // Đổi phòng ⇒ quên các lần đã thử: `attemptedRef` là bộ nhớ CỦA MỘT phòng.
    attemptedRef.current = new Set();
  }, [roomId]);

  // ── Đánh dấu đã đọc ────────────────────────────────────────────────────────
  const sentReadSeqRef = useRef<Record<string, number>>({});
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markReadUpTo = useCallback(
    (seq: number) => {
      if (!roomId || !Number.isFinite(seq) || seq <= 0) return;
      // CHỈ TIẾN. Server cũng bỏ qua số lùi (CHAT-ERR-018) nhưng đó không phải lý do để nện API mỗi lần
      // cuộn — và con trỏ lùi giữa hai thiết bị thì thiết bị chậm kéo lùi badge của thiết bị nhanh.
      if ((sentReadSeqRef.current[roomId] ?? 0) >= seq) return;
      if (readTimerRef.current) clearTimeout(readTimerRef.current);
      readTimerRef.current = setTimeout(() => {
        const target = roomId;
        if ((sentReadSeqRef.current[target] ?? 0) >= seq) return;
        sentReadSeqRef.current[target] = seq;
        void chatApi.markRead(target, { seq }).catch((err: unknown) => {
          // Thất bại ⇒ NHẢ con trỏ ra để lần cuộn sau thử lại. Giữ nguyên nghĩa là badge phòng này kẹt
          // đỏ tới khi tải lại trang, im lặng tuyệt đối.
          sentReadSeqRef.current[target] = 0;
          console.error(`[chat] không đánh dấu đọc được phòng ${target}:`, err);
        });
      }, MARK_READ_DEBOUNCE_MS);
    },
    [roomId],
  );

  useEffect(
    () => () => {
      if (readTimerRef.current) clearTimeout(readTimerRef.current);
    },
    [],
  );

  return {
    isInitialLoading: isInitialLoading && messageCount === 0,
    loadError,
    isLoadingOlder,
    hasMoreOlder: oldestSeq !== undefined && oldestSeq > 1,
    historyLimitReached: messageCount >= MAX_HISTORY_PER_ROOM,
    reload,
    loadOlder,
    sendMessage,
    markReadUpTo,
  };
}
