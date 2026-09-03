/**
 * S17-CHAT-UX2-FE-2 — **thanh tác vụ nổi** của một bong bóng (CHAT-DEC-024 · SPEC-15 §14).
 *
 * S7 để 3 nút nằm TRONG hàng flex của bong bóng, chiếm một cột cố định bên phải mọi tin. Bố cục hai
 * phía không còn chỗ cho cột đó (tin của tôi đã áp lề phải), nên thanh tác vụ **nổi lên trên mép trên**
 * của bong bóng và chỉ hiện khi trỏ vào / hội tụ bàn phím.
 *
 * ┌─ `pointer-events-none` khi ẩn KHÔNG phải chi tiết trang trí ───────────────────────────────────────┐
 * │ Thanh nằm ở `-top-3`, tức nó CHỒNG lên đáy của bong bóng phía trên. Một thanh `opacity-0` vẫn nhận │
 * │ chuột: người dùng bấm vào tin trên và trúng một nút vô hình của tin dưới. Nên khi ẩn thì tắt luôn  │
 * │ `pointer-events`, và bật lại ở `group-hover` / `focus-within`.                                     │
 * │                                                                                                    │
 * │ `pointer-events-none` KHÔNG cản bàn phím — nút vẫn nằm trong luồng tab, nhận `focus`, và chính     │
 * │ `focus-within` kéo thanh hiện ra. Dùng `invisible`/`hidden` thay cho cặp này là loại nút khỏi luồng│
 * │ tab ⇒ tác vụ tin nhắn biến mất hoàn toàn với người dùng bàn phím.                                  │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Menu `⋯` mở bằng `Popover` (portal + fixed) — cùng khuôn `RoomRowMenu`. Khi menu mở, thanh phải TIẾP
 * TỤC hiện dù chuột đã rời bong bóng: `data-open` giữ nó lại, nếu không thì menu nổi mồ côi phía trên
 * một bong bóng không còn thanh nào.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, CornerUpLeft, MoreHorizontal, Pin, ThumbsUp, Undo2 } from "lucide-react";
import { Button, Popover, cn } from "@mediaos/ui";

interface MessageActionsProps {
  /** Tin của tôi ⇒ thanh neo mép PHẢI (bong bóng ở phải); tin người khác ⇒ mép trái. */
  isMine: boolean;
  isPinned: boolean;
  /** Tôi đã thả 👍 chưa — quyết định trạng thái bật/tắt của nút thích nhanh. */
  isLiked: boolean;
  canPin: boolean;
  canRecall: boolean;
  /** Phòng lưu trữ ⇒ chỉ đọc: không thả cảm xúc (giữ đúng luật của `ReactionBar`). */
  isArchived: boolean;
  /** `false` khi tin không có phần chữ để chép (tin chỉ có tệp) ⇒ ẩn mục Sao chép. */
  hasBody: boolean;
  onQuickLike: () => void;
  onReply: () => void;
  onTogglePin: () => void;
  onRecall: () => void;
  onCopy: () => void;
}

export function MessageActions({
  isMine,
  isPinned,
  isLiked,
  canPin,
  canRecall,
  isArchived,
  hasBody,
  onQuickLike,
  onReply,
  onTogglePin,
  onRecall,
  onCopy,
}: MessageActionsProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const [isMenuOpen, setMenuOpen] = useState(false);

  return (
    <div
      data-testid="chat-message-actions"
      data-open={isMenuOpen ? "true" : "false"}
      className={cn(
        "absolute -top-3 z-10 flex items-center gap-0.5 rounded-full border border-border bg-popover px-0.5 py-0.5 shadow-sm",
        "pointer-events-none opacity-0 transition-opacity",
        "group-hover:pointer-events-auto group-hover:opacity-100",
        "focus-within:pointer-events-auto focus-within:opacity-100",
        "data-[open=true]:pointer-events-auto data-[open=true]:opacity-100",
        isMine ? "right-2" : "left-2",
      )}
    >
      {!isArchived && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          aria-label={t("message.quickLike")}
          // Nút BẬT/TẮT — người dùng bàn phím phải biết mình đã thả hay chưa mà không cần thấy màu.
          aria-pressed={isLiked}
          data-testid="chat-message-quick-like"
          onClick={onQuickLike}
        >
          <ThumbsUp
            className={cn("h-3.5 w-3.5", isLiked && "fill-current text-primary")}
            aria-hidden="true"
          />
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        aria-label={t("message.reply")}
        onClick={onReply}
      >
        <CornerUpLeft className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>

      {canPin && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          aria-label={isPinned ? t("message.unpin") : t("message.pin")}
          onClick={onTogglePin}
        >
          <Pin className={cn("h-3.5 w-3.5", isPinned && "fill-current")} aria-hidden="true" />
        </Button>
      )}

      {canRecall && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          aria-label={t("message.recall")}
          onClick={onRecall}
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      )}

      {hasBody && (
        <Popover
          open={isMenuOpen}
          onOpenChange={setMenuOpen}
          align={isMine ? "end" : "start"}
          className="min-w-[11rem] p-1"
          trigger={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label={t("message.moreActions")}
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              data-testid="chat-message-more"
              onClick={() => setMenuOpen(!isMenuOpen)}
            >
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          }
        >
          <ul role="menu" aria-label={t("message.actions")} className="space-y-0.5">
            <li role="none">
              <button
                type="button"
                role="menuitem"
                data-testid="chat-message-copy"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => {
                  // Đóng TRƯỚC khi chạy — cùng lý do đã ghi ở `RoomRowMenu`: để menu mở trên một hành
                  // động vừa xong là mời bấm lần hai.
                  setMenuOpen(false);
                  onCopy();
                }}
              >
                <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t("message.copy")}
              </button>
            </li>
          </ul>
        </Popover>
      )}
    </div>
  );
}
