/**
 * S8-CHAT-UX-FE-3 — thanh thả cảm xúc dưới một bong bóng tin (CHAT-FUNC-019 · CHAT-DEC-018).
 *
 * ⚠️ Bộ emoji lấy TỪ CONTRACTS (`chatReactionEmojiSchema.options`), KHÔNG chép tay ra một mảng thứ tư.
 * Bộ này đã sống ở BA chỗ phải khớp nhau (CHECK ở DB mig `0543` · hằng drizzle · enum Zod); một bản sao
 * nữa ở FE là chỗ thứ tư để trôi, và khi nó trôi thì người dùng bấm một emoji hợp lệ về mặt UI và nhận
 * 400 mà không hiểu vì sao.
 *
 * Ký tự hiển thị thì PHẢI khai ở đây: mã (`like`/`love`/…) là khoá lưu trữ, biểu tượng là việc trình bày.
 * `Record<ChatReactionEmoji, string>` ⇒ thêm mã thứ 7 ở contracts mà quên biểu tượng là **vỡ typecheck**,
 * không phải một ô trống lúc chạy.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SmilePlus } from "lucide-react";
import { Button, cn } from "@mediaos/ui";
import { chatReactionEmojiSchema, type ChatReactionEmoji } from "@mediaos/contracts";
import type { ChatMessageReactionDto } from "@mediaos/contracts";

/** Thứ tự hiển thị = thứ tự khai trong contracts (đã là thứ tự nghiệp vụ: like → love → haha → …). */
export const REACTION_EMOJIS: readonly ChatReactionEmoji[] = chatReactionEmojiSchema.options;

const EMOJI_GLYPH: Record<ChatReactionEmoji, string> = {
  like: "👍",
  love: "❤️",
  haha: "😄",
  wow: "😮",
  sad: "😢",
  angry: "😠",
};

interface ReactionBarProps {
  /** Tổng hợp hiện tại. Rỗng ⇒ chỉ hiện nút mở bộ chọn (và nó chỉ hiện khi hover/focus bong bóng). */
  reactions: readonly ChatMessageReactionDto[];
  /** Phòng đã lưu trữ / tin đã thu hồi ⇒ chỉ ĐỌC: hiện tổng hợp, không cho bấm. */
  readOnly: boolean;
  onToggle: (emoji: ChatReactionEmoji, currentlyMine: boolean) => void;
}

export function ReactionBar({
  reactions,
  readOnly,
  onToggle,
}: ReactionBarProps): React.ReactElement | null {
  const { t } = useTranslation("chat");
  const [isPickerOpen, setPickerOpen] = useState(false);

  // Không có cảm xúc nào VÀ không được thả ⇒ không vẽ gì. Trả `null` thay vì một div rỗng: div rỗng vẫn
  // chiếm chỗ trong `flex-col` của bong bóng và làm mọi tin dãn thêm một khoảng không giải thích được.
  if (reactions.length === 0 && readOnly) return null;

  const mineOf = (emoji: ChatReactionEmoji): boolean =>
    reactions.some((r) => r.emoji === emoji && r.mine);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1" data-testid="chat-reaction-bar">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          disabled={readOnly}
          onClick={() => onToggle(r.emoji, r.mine)}
          data-testid={`chat-reaction-${r.emoji}`}
          data-mine={r.mine ? "true" : undefined}
          // `aria-pressed` chứ không chỉ đổi màu: đây là một nút BẬT/TẮT, và người dùng bàn phím/đọc màn
          // hình phải biết mình đã thả hay chưa mà không cần nhìn thấy viền.
          aria-pressed={r.mine}
          aria-label={t("reaction.toggle", {
            emoji: t(`reaction.names.${r.emoji}`),
            count: r.count,
          })}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
            "disabled:cursor-default disabled:opacity-70",
            r.mine
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border bg-muted/40 hover:bg-accent",
          )}
        >
          <span aria-hidden="true">{EMOJI_GLYPH[r.emoji]}</span>
          <span className="tabular-nums">{r.count}</span>
        </button>
      ))}

      {!readOnly && (
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={t("reaction.open")}
            aria-expanded={isPickerOpen}
            onClick={() => setPickerOpen((open) => !open)}
            data-testid="chat-reaction-open"
          >
            <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>

          {isPickerOpen && (
            <div
              role="group"
              aria-label={t("reaction.pickerLabel")}
              data-testid="chat-reaction-picker"
              className="absolute bottom-full left-0 z-10 mb-1 flex gap-0.5 rounded-full border border-border bg-popover p-1 shadow-md"
            >
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={t(`reaction.names.${emoji}`)}
                  aria-pressed={mineOf(emoji)}
                  data-testid={`chat-reaction-pick-${emoji}`}
                  className="rounded-full px-1.5 py-0.5 text-base leading-none hover:bg-accent"
                  onClick={() => {
                    // Đóng bộ chọn NGAY, không chờ API: giữ nó mở trong lúc request bay làm người dùng
                    // bấm tiếp emoji thứ hai và tạo hai lần cập nhật lạc quan chồng nhau.
                    setPickerOpen(false);
                    onToggle(emoji, mineOf(emoji));
                  }}
                >
                  <span aria-hidden="true">{EMOJI_GLYPH[emoji]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
