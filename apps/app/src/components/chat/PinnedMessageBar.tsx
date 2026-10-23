/**
 * S20-CHAT-MENTIONPIN-1 — thanh tin ghim ngay dưới đầu hội thoại (US-CHAT-NV-08 · CHAT-FUNC-010).
 *
 * Một dòng: tin ghim MỚI NHẤT (server sắp `pinned_at DESC`) + «1/N». Bấm thân thanh ⇒ nạp cửa sổ ngữ cảnh
 * quanh tin và làm nổi nó (cùng cơ chế `jumpToMessage` của trang); mũi tên ⇒ xoay sang tin kế. Dùng ở CẢ
 * trang lẫn drawer vì nó sống bên trong `ConversationPanel`.
 *
 * ⚠️ Nguồn dữ liệu là `chatApi.getPinned` với CÙNG `queryKey` như `RoomPinnedList` (bảng thông tin): một entry
 * cache, hai nơi hiển thị — ghim/bỏ ghim ở đâu cũng cập nhật cả hai. Người khác ghim/bỏ ghim ⇒ sự kiện
 * `chat:message-pinned` làm mất hiệu lực entry này (`use-chat-realtime.ts`); ở chế độ polling dự phòng
 * (không có WS) truy vấn tự nạp lại theo nhịp `CHAT_POLL_INTERVAL_MS`.
 *
 * Fail-soft có chủ đích: `getPinned` lỗi / đang tải / 0 tin ⇒ KHÔNG vẽ gì. Thanh là lối tắt, không được
 * chặn việc đọc hay gửi tin.
 *
 * Tin ghim đã bị THU HỒI ⇒ «Tin đã thu hồi», KHÔNG BAO GIỜ nội dung cũ: server đã che `body` trong DTO,
 * và nếu entry cache còn giữ bản trước thu hồi thì bản trong store (đã nhận `chat:message-recalled`) thắng.
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronUp, Pin, PinOff } from "lucide-react";
import type { ChatMessageDto } from "@mediaos/contracts";
import { chatApi, chatKeys } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import { CONTEXT_AFTER, CONTEXT_BEFORE } from "@/routes/chat/constants";
import { CHAT_POLL_INTERVAL_MS, useChatStore } from "@/stores/chat.store";

interface PinnedMessageBarProps {
  roomId: string;
  /** Đủ tư cách bỏ ghim (cặp quyền + admin phòng / phòng 1-1). `false` ⇒ KHÔNG có nút — server vẫn là cổng thật. */
  canUnpin: boolean;
  onUnpin: (messageId: string) => void;
}

/** Khoá `localStorage` của trạng thái thu gọn — theo PHÒNG, không theo người (máy này, trình duyệt này). */
export const pinnedBarCollapsedKey = (roomId: string): string =>
  `mediaos.chat.pinnedBar.collapsed.${roomId}`;

function readCollapsed(roomId: string): boolean {
  try {
    return window.localStorage.getItem(pinnedBarCollapsedKey(roomId)) === "1";
  } catch {
    // Chế độ riêng tư / bộ nhớ bị chặn ⇒ mặc định MỞ: mất "nhớ thu gọn" tốt hơn mất cả thanh.
    return false;
  }
}

function writeCollapsed(roomId: string, collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(pinnedBarCollapsedKey(roomId), "1");
    else window.localStorage.removeItem(pinnedBarCollapsedKey(roomId));
  } catch {
    // Không ghi được ⇒ chỉ là không nhớ qua lần tải sau; trạng thái trong phiên vẫn đúng.
  }
}

/** Nạp cửa sổ quanh tin đích rồi vào chế độ ngữ cảnh — cùng hai lời gọi với `ChatPage.jumpToMessage`. */
function useJumpToPinned(roomId: string): (message: ChatMessageDto) => Promise<boolean> {
  const enterMessageContext = useChatStore((s) => s.enterMessageContext);
  return useCallback(
    async (message: ChatMessageDto): Promise<boolean> => {
      try {
        const [olderPage, newerPage] = await Promise.all([
          chatApi.getMessages(roomId, { beforeSeq: message.roomSeq + 1, limit: CONTEXT_BEFORE }),
          chatApi.getMessages(roomId, { afterSeq: message.roomSeq, limit: CONTEXT_AFTER }),
        ]);
        const window = [...olderPage, ...newerPage];
        if (!window.some((m) => m.id === message.id)) return false;
        enterMessageContext(roomId, window, { messageId: message.id, seq: message.roomSeq });
        return true;
      } catch (err: unknown) {
        console.error(`[chat] không mở được ngữ cảnh của tin ghim ${message.id}:`, err);
        return false;
      }
    },
    [enterMessageContext, roomId],
  );
}

export function PinnedMessageBar({
  roomId,
  canUnpin,
  onUnpin,
}: PinnedMessageBarProps): React.ReactElement | null {
  const { t } = useTranslation("chat");
  const isConnected = useChatStore((s) => s.connectionStatus === "connected");
  const storeMessages = useChatStore((s) => s.messagesByRoom[roomId]);
  const pinnedQuery = useQuery({
    queryKey: chatKeys.rooms.pinned(roomId),
    queryFn: () => chatApi.getPinned(roomId),
    refetchInterval: isConnected ? false : CHAT_POLL_INTERVAL_MS,
  });
  const [index, setIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(() => readCollapsed(roomId));
  const [jumpFailed, setJumpFailed] = useState(false);
  const jump = useJumpToPinned(roomId);

  const pinned = pinnedQuery.data ?? [];
  const total = pinned.length;
  if (pinnedQuery.isError || total === 0) return null;

  const position = index % total;
  const current = pinned[position] as ChatMessageDto;
  const recalledInStore = storeMessages?.some((m) => m.id === current.id && m.recalledAt !== null);
  const isRecalled = current.recalledAt !== null || recalledInStore === true;
  const preview = isRecalled
    ? t("message.recalled")
    : current.body && current.body.length > 0
      ? current.body
      : t("conversation.pinnedBar.attachment");

  const toggleCollapsed = (next: boolean): void => {
    setCollapsed(next);
    writeCollapsed(roomId, next);
  };

  return (
    <div
      role="region"
      aria-label={t("conversation.pinnedBar.aria")}
      data-testid="chat-pinned-bar"
      className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-xs"
    >
      <Pin className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      {collapsed ? (
        <button
          type="button"
          aria-expanded={false}
          onClick={() => toggleCollapsed(false)}
          data-testid="chat-pinned-bar-expand"
          className="min-w-0 flex-1 truncate text-left text-muted-foreground hover:text-foreground"
        >
          {t("conversation.pinnedBar.expand", { count: total })}
        </button>
      ) : (
        <>
          <button
            type="button"
            title={t("conversation.pinnedBar.jump")}
            onClick={() => {
              setJumpFailed(false);
              void jump(current).then((ok) => setJumpFailed(!ok));
            }}
            data-testid="chat-pinned-bar-jump"
            className="min-w-0 flex-1 truncate text-left hover:underline"
          >
            <span className="font-medium">
              {current.senderName ?? t("message.unknownSender")}:{" "}
            </span>
            {/* Text node — `body` là chuỗi người dùng gõ, React escape (không HTML thô). */}
            <span className="text-muted-foreground" data-testid="chat-pinned-bar-preview">
              {preview}
            </span>
          </button>
          <span
            className="shrink-0 tabular-nums text-muted-foreground"
            data-testid="chat-pinned-bar-position"
          >
            {t("conversation.pinnedBar.position", { index: position + 1, total })}
          </span>
          {total > 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              aria-label={t("conversation.pinnedBar.next")}
              onClick={() => setIndex((i) => (i + 1) % total)}
              data-testid="chat-pinned-bar-next"
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
          {canUnpin && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              aria-label={t("conversation.pinnedBar.unpin")}
              onClick={() => onUnpin(current.id)}
              data-testid="chat-pinned-bar-unpin"
            >
              <PinOff className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            aria-label={t("conversation.pinnedBar.collapse")}
            aria-expanded={true}
            onClick={() => toggleCollapsed(true)}
            data-testid="chat-pinned-bar-collapse"
          >
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </>
      )}
      {jumpFailed && (
        <span role="alert" className="shrink-0 text-destructive">
          {t("conversation.pinnedBar.jumpFailed")}
        </span>
      )}
    </div>
  );
}
