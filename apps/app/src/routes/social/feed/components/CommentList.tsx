/**
 * S16-SOCIAL-FE-1 — danh sách bình luận MỘT CẤP + trả lời (SOCIAL-API-014).
 *
 * `feedCommentSchema.parentCommentId` `null` = bình luận gốc; khác `null` = trả lời. SPEC-16 chốt
 * **đúng một cấp** — trả lời của trả lời không tồn tại ở tầng dữ liệu, nên component này gom con về
 * dưới cha CHỨ KHÔNG đệ quy. Viết đệ quy ở đây là dựng sẵn một cấu trúc mà BE không sinh ra được.
 *
 * ⚠️ Con MỒ CÔI (cha đã bị xoá mềm nên không có trong trang hiện tại) **vẫn phải hiện**, ở mức gốc.
 * Bỏ qua chúng là làm biến mất bình luận của người ta mà không ai biết — im lặng, không lỗi.
 *
 * ┌─ 🔴 BA TRẠNG THÁI, KHÔNG PHẢI MỘT (H5 · FULL gate 23/09/2026) ──────────────────────────────┐
 * │ `isLoading` / `isError` là **bắt buộc**, không mặc định. Bản đầu không có chúng: cả "đang     │
 * │ tải" lẫn "GET trả 500" đều rơi xuống `comments = []` ⇒ «Chưa có bình luận nào.» — trong khi   │
 * │ thẻ bài ngay trên vẫn ghi «12 bình luận». Người đọc kết luận 12 bình luận vừa bị xoá sạch.    │
 * │ Một câu RỖNG sai sự thật nguy hiểm hơn một khối lỗi, vì nó trông như trạng thái bình thường.  │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Avatar, Button, Skeleton, cn } from "@mediaos/ui";
import type { FeedCommentDto, FeedReactionEmojiDto } from "@mediaos/contracts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PostBody } from "./PostBody";
import { FeedReactionBar } from "./FeedReactionBar";
import { authorDisplayName, relativeTime } from "../lib/feed-format";

interface CommentListProps {
  comments: readonly FeedCommentDto[];
  /** Truy vấn `014` đang chạy lượt ĐẦU. Xem hộp cảnh báo đầu file. */
  isLoading: boolean;
  /** Truy vấn `014` hỏng — KHÔNG được im lặng thành danh sách rỗng. */
  isError: boolean;
  onRetry: () => void;
  onReply: (comment: FeedCommentDto) => void;
  onDelete: (comment: FeedCommentDto) => void;
  onReactionChange: (comment: FeedCommentDto, emoji: FeedReactionEmojiDto | null) => void;
  /** Bình luận đang chờ phản hồi `018/019` ⇒ khoá ĐÚNG thanh cảm xúc của nó (H6). */
  pendingReactionCommentId?: string | null;
  className?: string;
}

interface CommentRowProps {
  comment: FeedCommentDto;
  isReply?: boolean;
  isReactionPending?: boolean;
  onReply: CommentListProps["onReply"];
  onDelete: CommentListProps["onDelete"];
  onReactionChange: CommentListProps["onReactionChange"];
}

function CommentRow({
  comment,
  isReply = false,
  isReactionPending = false,
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
            // Khoá trong lúc chờ `018/019`: bấm nhanh hai lần là hai request đua nhau trên cùng một
            // mục tiêu, và cái về sau thắng — người dùng thấy emoji nhảy về cái họ KHÔNG chọn.
            isPending={isReactionPending}
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
  isLoading,
  isError,
  onRetry,
  onReply,
  onDelete,
  onReactionChange,
  pendingReactionCommentId = null,
  className,
}: CommentListProps): React.ReactElement {
  const { t } = useTranslation("social");
  // Nhãn «Hủy» dùng chung — không dựng bản sao trong bundle `social` để hai chỗ khỏi trôi khỏi nhau.
  const { t: tc } = useTranslation("common");

  /**
   * Bình luận đang chờ xác nhận xoá. Giữ NGUYÊN đối tượng (không chỉ id) để `onDelete` nhận đúng
   * hàng người dùng đã bấm, kể cả khi danh sách vừa được refetch xen vào giữa.
   */
  const [pendingDelete, setPendingDelete] = React.useState<FeedCommentDto | null>(null);

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

  // Thứ tự BA nhánh là có nghĩa: đang tải đè lên lỗi cũ (đang thử lại thì đừng còn kêu lỗi), và cả
  // hai đè lên câu rỗng — chỉ được nói «chưa có bình luận nào» khi ĐÃ BIẾT là không có.
  if (isLoading) {
    return (
      <div
        className={cn("flex flex-col gap-3", className)}
        data-testid="comment-loading"
        aria-busy="true"
      >
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (isError) {
    /**
     * Chỉ dùng `state.errorBody` (câu chung «Đã có lỗi khi tải dữ liệu…») — `state.errorTitle` nói
     * «Không tải được **bảng tin**», sai chỗ ở đây. Bundle `social` chưa có tiêu đề riêng cho lỗi
     * tải BÌNH LUẬN; thêm khoá nằm ngoài phạm vi file được sửa ở lượt vá này (nợ đã báo lại).
     */
    return (
      <div
        role="alert"
        data-testid="comment-error"
        className={cn("rounded-lg border border-border bg-card p-4 text-center", className)}
      >
        <p className="text-sm text-muted-foreground">{t("state.errorBody")}</p>
        <Button type="button" variant="outline" className="mt-3" onClick={onRetry}>
          {t("state.retry")}
        </Button>
      </div>
    );
  }

  if (comments.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)} data-testid="comment-empty">
        {t("comment.empty")}
      </p>
    );
  }

  return (
    <>
      <ul className={cn("flex flex-col gap-3", className)} data-testid="comment-list">
        {roots.map((root) => (
          <React.Fragment key={root.id}>
            <CommentRow
              comment={root}
              isReactionPending={pendingReactionCommentId === root.id}
              onReply={onReply}
              onDelete={setPendingDelete}
              onReactionChange={onReactionChange}
            />
            {(repliesByParent.get(root.id) ?? []).map((reply) => (
              <CommentRow
                key={reply.id}
                comment={reply}
                isReply
                isReactionPending={pendingReactionCommentId === reply.id}
                onReply={onReply}
                onDelete={setPendingDelete}
                onReactionChange={onReactionChange}
              />
            ))}
          </React.Fragment>
        ))}
      </ul>

      {/*
        🔴 Xoá bình luận PHẢI hỏi. Nút «Xoá» nằm sát «Trả lời», cùng cỡ chữ, và thao tác KHÔNG hoàn
        tác được (`017` xoá mềm nhưng FE không có đường khôi phục). Khoá `comment.confirmDelete` đã
        nằm trong bundle từ đầu WO với đúng 0 call-site — hộp hỏi được dự tính rồi không bao giờ dựng.
      */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("comment.confirmDelete")}
        confirmLabel={t("comment.delete")}
        cancelLabel={tc("actions.cancel")}
        destructive
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
