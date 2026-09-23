/**
 * S16-SOCIAL-FE-1 — danh sách bình luận MỘT CẤP + trả lời (SOCIAL-API-014).
 *
 * `feedCommentSchema.parentCommentId` `null` = bình luận gốc; khác `null` = trả lời. SPEC-16 chốt
 * **đúng một cấp** — trả lời của trả lời không tồn tại ở tầng dữ liệu, nên component này gom con về
 * dưới cha CHỨ KHÔNG đệ quy. Viết đệ quy ở đây là dựng sẵn một cấu trúc mà BE không sinh ra được.
 *
 * ⚠️ Con MỒ CÔI (cha đã bị xoá mềm nên không có trong trang hiện tại) **vẫn phải hiện**, ở mức gốc.
 * Bỏ qua chúng là làm biến mất bình luận của người ta mà không ai biết — im lặng, không lỗi.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Avatar, cn } from "@mediaos/ui";
import type { FeedCommentDto, FeedReactionEmojiDto } from "@mediaos/contracts";
import { PostBody } from "./PostBody";
import { FeedReactionBar } from "./FeedReactionBar";
import { authorDisplayName, relativeTime } from "../lib/feed-format";

interface CommentListProps {
  comments: readonly FeedCommentDto[];
  onReply: (comment: FeedCommentDto) => void;
  onDelete: (comment: FeedCommentDto) => void;
  onReactionChange: (comment: FeedCommentDto, emoji: FeedReactionEmojiDto | null) => void;
  className?: string;
}

interface CommentRowProps {
  comment: FeedCommentDto;
  isReply?: boolean;
  onReply: CommentListProps["onReply"];
  onDelete: CommentListProps["onDelete"];
  onReactionChange: CommentListProps["onReactionChange"];
}

function CommentRow({
  comment,
  isReply = false,
  onReply,
  onDelete,
  onReactionChange,
}: CommentRowProps): React.ReactElement {
  const { t } = useTranslation("social");
  const name = authorDisplayName(comment.author, t("post.unknownAuthor"));

  return (
    <li
      data-testid={isReply ? "comment-reply" : "comment-row"}
      className={cn("flex gap-2", isReply && "ml-8")}
    >
      <Avatar name={name} src={comment.author.avatarUrl ?? undefined} size="sm" />

      <div className="min-w-0 flex-1">
        <div className="rounded-lg bg-muted px-3 py-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-medium text-foreground">{name}</span>
            <span className="text-xs text-muted-foreground">
              {relativeTime(comment.createdAt)}
              {comment.editedAt ? ` · ${t("post.edited")}` : ""}
            </span>
          </div>
          <PostBody body={comment.body} />
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2">
          <FeedReactionBar
            reactions={undefined}
            likeCount={comment.likeCount}
            myReaction={comment.myReaction}
            onChange={(emoji) => onReactionChange(comment, emoji)}
          />

          {/*
            Trả lời chỉ mở ở cấp GỐC: hệ thống một cấp, nên một nút «Trả lời» trên chính một trả lời
            là lời hứa không giữ được (BE sẽ gắn nó vào cùng cha, không phải vào nó).
          */}
          {!isReply && (
            <button
              type="button"
              onClick={() => onReply(comment)}
              className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("comment.reply")}
            </button>
          )}

          {/* Xoá bình luận CỦA MÌNH — `isMine` là SỞ HỮU HÀNG từ DTO, không phải một cặp quyền. */}
          {comment.isMine && (
            <button
              type="button"
              onClick={() => onDelete(comment)}
              data-testid="comment-delete"
              className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("comment.delete")}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function CommentList({
  comments,
  onReply,
  onDelete,
  onReactionChange,
  className,
}: CommentListProps): React.ReactElement {
  const { t } = useTranslation("social");

  /**
   * Gom một cấp: gốc theo thứ tự server trả, trả lời xếp ngay dưới cha.
   *
   * Con mồ côi (cha không có trong `comments`) được coi như GỐC — xem docblock đầu file.
   */
  const { roots, repliesByParent } = React.useMemo(() => {
    const ids = new Set(comments.map((c) => c.id));
    const roots: FeedCommentDto[] = [];
    const repliesByParent = new Map<string, FeedCommentDto[]>();

    for (const c of comments) {
      const parentId = c.parentCommentId;
      if (parentId && ids.has(parentId)) {
        const list = repliesByParent.get(parentId) ?? [];
        list.push(c);
        repliesByParent.set(parentId, list);
      } else {
        roots.push(c);
      }
    }
    return { roots, repliesByParent };
  }, [comments]);

  if (comments.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)} data-testid="comment-empty">
        {t("comment.empty")}
      </p>
    );
  }

  return (
    <ul className={cn("flex flex-col gap-3", className)} data-testid="comment-list">
      {roots.map((root) => (
        <React.Fragment key={root.id}>
          <CommentRow
            comment={root}
            onReply={onReply}
            onDelete={onDelete}
            onReactionChange={onReactionChange}
          />
          {(repliesByParent.get(root.id) ?? []).map((reply) => (
            <CommentRow
              key={reply.id}
              comment={reply}
              isReply
              onReply={onReply}
              onDelete={onDelete}
              onReactionChange={onReactionChange}
            />
          ))}
        </React.Fragment>
      ))}
    </ul>
  );
}
