/**
 * S16-SOCIAL-FE-1 — ô soạn bình luận (SOCIAL-API-015).
 *
 * Gate `create:feed-comment` — cặp RIÊNG, khác `create:feed-post`. Không có ⇒ **ẩn ô soạn**, không
 * hiện rồi báo lỗi (SPEC-16 §14).
 *
 * ⚠️ **KHÔNG có nút đính kèm** — cùng lý do với `FeedComposer` (plan D8 · nợ N1): đường đăng ký tệp
 * cho SOCIAL chưa tồn tại và `foundation/files` đòi cặp mà nhân viên thường không có.
 *
 * ⚠️ Bài bị KHOÁ bình luận (`commentsLocked`) ⇒ ẩn ô soạn và nói rõ lý do. Hiện ô rồi để người ta gõ
 * xong mới ăn 409 là phí công của họ.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button, cn } from "@mediaos/ui";
import { useCan } from "@mediaos/web-core";
/**
 * 🔴 Trần độ dài bình luận là **`FEED_BODY_MAX` (4000)**, KHÔNG phải `FEED_COMMENT_BODY_MAX` (5000).
 *
 * Hai hằng này gần giống tên nhau nhưng nói hai chuyện khác nhau: 5000 là mức **CHECK của DB còn
 * chịu được**, 4000 là **trần SẢN PHẨM** mà `createFeedCommentSchema.body` (`feedBody()`) thật sự
 * ép. Dùng nhầm 5000 ở đây thì ô soạn cho gõ tới 5000 ký tự rồi ăn **400 từ Zod của server** ở ký tự
 * thứ 4001 — đúng kiểu lỗi mà người dùng không hiểu và dev không tìm ra vì "FE có kiểm rồi mà".
 */
import { FEED_BODY_MAX, type CreateFeedCommentDto } from "@mediaos/contracts";

interface CommentComposerProps {
  onSubmit: (dto: CreateFeedCommentDto) => void;
  isSubmitting: boolean;
  /** Đang trả lời một bình luận gốc. `null` = bình luận cấp 1. */
  replyTo?: { commentId: string; authorName: string } | null;
  onCancelReply?: () => void;
  locked?: boolean;
  className?: string;
}

export function CommentComposer({
  onSubmit,
  isSubmitting,
  replyTo = null,
  onCancelReply,
  locked = false,
  className,
}: CommentComposerProps): React.ReactElement | null {
  const { t } = useTranslation("social");
  const canComment = useCan("create", "feed-comment");
  const [body, setBody] = React.useState("");

  if (locked) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)} data-testid="comment-locked">
        {t("comment.locked")}
      </p>
    );
  }
  if (!canComment) return null;

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= FEED_BODY_MAX && !isSubmitting;

  const submit = (): void => {
    if (!canSubmit) return;
    onSubmit({
      body: trimmed,
      parentCommentId: replyTo?.commentId ?? null,
    } as CreateFeedCommentDto);
    setBody("");
    onCancelReply?.();
  };

  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="comment-composer">
      {replyTo && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t("comment.replyPlaceholder", { name: replyTo.authorName })}</span>
          <button
            type="button"
            onClick={onCancelReply}
            className="rounded underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("comment.cancelReply")}
          </button>
        </div>
      )}

      <label className="sr-only" htmlFor="feed-comment-body">
        {t("comment.placeholder")}
      </label>
      <textarea
        id="feed-comment-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("comment.placeholder")}
        rows={2}
        className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="flex justify-end">
        {/* Khoá khi đang gửi — cùng lý do C26 ở `FeedComposer`. */}
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={!canSubmit}
          data-testid="comment-submit"
        >
          {isSubmitting ? t("comment.submitting") : t("comment.submit")}
        </Button>
      </div>
    </div>
  );
}
