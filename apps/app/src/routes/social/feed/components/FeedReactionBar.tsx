/**
 * S16-SOCIAL-FE-1 — thanh cảm xúc cho bài & bình luận (SOCIAL-API-011/012/018/019).
 *
 * ┌─ 🔴 GATE LÀ `view:feed`, KHÔNG PHẢI MỘT CẶP RIÊNG ───────────────────────────────────────────┐
 * │ SPEC-16 §11.2: thích / bỏ thích / đổi emoji **KHÔNG có cặp quyền riêng** — chúng đi theo        │
 * │ `view:feed` + sở hữu hàng. Viết `useCan("create","feed-reaction")` là **bịa**: khoá đó không    │
 * │ tồn tại trong seed `0578` ⇒ `capabilities` không bao giờ có nó ⇒ nút thích **ẩn vĩnh viễn với   │
 * │ mọi người**, và không cổng nào bắt được. Ca **C7** là lưới cho đúng lỗi đó: nó assert rằng chỉ  │
 * │ với `view:feed` thì nút vẫn HIỆN.                                                               │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Bộ emoji lấy TỪ CONTRACTS (`feedReactionEmojiSchema.options`), KHÔNG chép tay. Bộ này đã sống ở
 * ba nơi phải khớp nhau (CHECK `chat_message_reactions_emoji_chk` · hằng drizzle `CHAT_REACTION_EMOJIS`
 * · enum contracts) — một bản sao nữa ở FE là chỗ thứ tư để trôi. Thêm nữa, cột `feed_reactions.emoji`
 * **KHÔNG có CHECK ở DB** (DB-17 §6.3) nên không có lưới nào đỡ nếu FE gửi mã lạ.
 *
 * Ký tự hiển thị thì PHẢI khai ở đây (mã là khoá lưu trữ, biểu tượng là trình bày), và khai bằng
 * `Record<FeedReactionEmojiDto, string>` ⇒ thêm mã thứ 7 ở contracts mà quên biểu tượng là **vỡ
 * typecheck**, không phải một ô trống lúc chạy.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { SmilePlus } from "lucide-react";
import { cn } from "@mediaos/ui";
import {
  feedReactionEmojiSchema,
  type FeedReactionEmojiDto,
  type FeedReactionSummaryDto,
} from "@mediaos/contracts";

export const FEED_REACTION_EMOJIS: readonly FeedReactionEmojiDto[] =
  feedReactionEmojiSchema.options;

const EMOJI_GLYPH: Record<FeedReactionEmojiDto, string> = {
  like: "👍",
  love: "❤️",
  haha: "😄",
  wow: "😮",
  sad: "😢",
  angry: "😠",
};

interface FeedReactionBarProps {
  /**
   * 🔴 **TÙY CHỌN — và đó là sự thật của hợp đồng, không phải sự lười.**
   *
   * `feedPostSchema` / `feedCommentSchema` trả `likeCount` + `myReaction`, **KHÔNG** trả mảng tổng
   * hợp theo emoji. Mảng đó chỉ xuất hiện trong phản hồi của `011/012/018/019`
   * (`feedReactionResultSchema.reactions`). Nghĩa là: lúc mới tải danh sách ta biết «có bao nhiêu
   * người thả» chứ chưa biết «thả emoji nào»; sau khi CHÍNH actor thả thì mới có bảng chi tiết.
   *
   * ⇒ `undefined` ⇒ chỉ hiện TỔNG (`likeCount`). Tuyệt đối không bịa một mảng rỗng rồi tính tổng
   * bằng 0 — làm thế là một bài 30 lượt thích hiện thành "không có cảm xúc nào".
   */
  reactions?: readonly FeedReactionSummaryDto[];
  /** Tổng số người đã thả, do SERVER tính. Client KHÔNG tự cộng trừ. */
  likeCount: number;
  /** Emoji actor đang thả, `null` = chưa thả. Đến từ `myReaction` của DTO. */
  myReaction: string | null;
  /** Đặt/đổi cảm xúc. `null` = gỡ (bấm lại đúng emoji đang thả). */
  onChange: (emoji: FeedReactionEmojiDto | null) => void;
  /** Đang gửi ⇒ khoá nút, tránh hai request chồng nhau trên cùng một mục tiêu. */
  isPending?: boolean;
  className?: string;
}

export function FeedReactionBar({
  reactions,
  likeCount,
  myReaction,
  onChange,
  isPending = false,
  className,
}: FeedReactionBarProps): React.ReactElement {
  const { t } = useTranslation("social");
  const [pickerOpen, setPickerOpen] = React.useState(false);

  // Có bảng chi tiết thì tổng lấy TỪ BẢNG (nó mới hơn — vừa về từ mutation); chưa có thì dùng
  // `likeCount` của DTO. Hai nguồn không được cộng vào nhau.
  const totalCount = reactions ? reactions.reduce((sum, r) => sum + r.count, 0) : likeCount;

  const pick = (emoji: FeedReactionEmojiDto): void => {
    setPickerOpen(false);
    // Bấm lại đúng emoji đang thả = gỡ. Người dùng không cần tìm một nút "bỏ thích" riêng.
    onChange(myReaction === emoji ? null : emoji);
  };

  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      data-testid="feed-reaction-bar"
    >
      <div className="relative">
        <button
          type="button"
          disabled={isPending}
          aria-haspopup="true"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-60",
            myReaction
              ? "font-medium text-primary hover:bg-accent"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {myReaction && EMOJI_GLYPH[myReaction as FeedReactionEmojiDto] ? (
            <span aria-hidden="true">{EMOJI_GLYPH[myReaction as FeedReactionEmojiDto]}</span>
          ) : (
            <SmilePlus className="h-4 w-4" aria-hidden="true" />
          )}
          <span>{t("reaction.trigger")}</span>
        </button>

        {pickerOpen && (
          <div
            role="menu"
            data-testid="feed-reaction-picker"
            className="absolute bottom-full left-0 z-20 mb-1 flex gap-1 rounded-full border border-border bg-popover p-1 shadow-md"
          >
            {FEED_REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                role="menuitem"
                aria-label={t(`reaction.${emoji}`)}
                onClick={() => pick(emoji)}
                className={cn(
                  "rounded-full px-1.5 py-1 text-lg transition-transform hover:scale-125",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  myReaction === emoji && "bg-accent",
                )}
              >
                <span aria-hidden="true">{EMOJI_GLYPH[emoji]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/*
        Tổng hợp hiện tại. `count` là số NGƯỜI thả emoji đó (server tính) — client TUYỆT ĐỐI không tự
        cộng trừ theo hành động lạc quan: phản hồi của 011/012 trả nguyên mảng `reactions` mới, dùng
        nó làm nguồn sự thật thay vì vá từng số.
      */}
      {totalCount > 0 && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {(reactions ?? [])
            .filter((r) => r.count > 0)
            .map((r) => (
              <span key={r.emoji} aria-hidden="true">
                {EMOJI_GLYPH[r.emoji as FeedReactionEmojiDto] ?? "•"}
              </span>
            ))}
          <span>{t("post.likeCount", { count: totalCount })}</span>
        </span>
      )}
    </div>
  );
}
