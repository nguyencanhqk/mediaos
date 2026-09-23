/**
 * S16-SOCIAL-FE-1 — `SOC-SCREEN-002` Chi tiết bài (SOCIAL-API-003 · 013 · 014 · 015 · 017).
 *
 * Bài + toàn bộ bình luận + danh sách người đã bày tỏ cảm xúc.
 *
 * ⚠️ **Bài đã xoá / không còn quyền xem ⇒ trạng thái RỖNG có nghĩa, không phải màn lỗi** (ca C8).
 * Server trả 404 cho CẢ HAI tình huống — cố ý: phân biệt chúng là nói cho người gọi biết "bài này có
 * tồn tại, chỉ là bạn không được xem", tức một oracle dò nội dung. FE vì vậy cũng chỉ được hiện đúng
 * một câu cho cả hai.
 *
 * ┌─ 🔴 …NHƯNG CHỈ 404 MỚI ĐƯỢC KỂ CÂU ĐÓ (H4 · FULL gate 23/09/2026) ──────────────────────────┐
 * │ Bản đầu gom MỌI lỗi vào khối "không tìm thấy": lỗi mạng, 500, và cả **ZodError trên HTTP      │
 * │ 200** (`apiFetch` gọi `schema.parse` sau khi thấy `res.ok` ⇒ hợp đồng lệch KHÔNG ném           │
 * │ `ApiError`). Hậu quả: BE đổi một khoá trong `feedPostSchema` ⇒ toàn công ty đọc được rằng mọi │
 * │ bài đã bị xoá, không nút thử lại, và không ai đi tìm lỗi parse vì màn hình trông bình thường.  │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import * as React from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Button, Skeleton } from "@mediaos/ui";
import { ApiError, socialApi, socialKeys } from "@mediaos/web-core";
import type {
  CreateFeedCommentDto,
  FeedCommentDto,
  FeedReactionEmojiDto,
} from "@mediaos/contracts";
import { PostCard } from "./components/PostCard";
import { CommentList } from "./components/CommentList";
import { CommentComposer } from "./components/CommentComposer";
import { ActionErrorBanner, type ActionErrorKind } from "./components/ActionErrorBanner";
import { buildPostMenuActions, useFeedActions } from "./lib/use-feed-actions";

interface LocalActionError {
  kind: ActionErrorKind;
  forbidden: boolean;
}

export function PostDetailPage(): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const actions = useFeedActions();
  const { postId } = useParams({ strict: false }) as { postId: string };

  const [replyTo, setReplyTo] = React.useState<{ commentId: string; authorName: string } | null>(
    null,
  );

  /**
   * Lỗi của các đường ghi RIÊNG của màn này (bình luận + cảm xúc trên bình luận). Các đường ghi
   * trên BÀI đã có `actions.actionError` của `useFeedActions`; hai nguồn hội tụ về ĐÚNG MỘT dải ở
   * dưới — hai dải chồng nhau chỉ làm người dùng đọc nhầm cái cũ.
   */
  const [localError, setLocalError] = React.useState<LocalActionError | null>(null);
  const { actionError: hookError, clearActionError } = actions;

  const reportLocalError = (kind: ActionErrorKind) => (err: unknown) => {
    // Lỗi MỚI thay lỗi cũ: giữ lại lỗi của hook sẽ hiện câu của một hành động khác, đã xảy ra trước.
    clearActionError();
    setLocalError({ kind, forbidden: err instanceof ApiError && err.status === 403 });
  };

  // Chiều ngược lại: hook vừa báo lỗi ⇒ lỗi cục bộ cũ hết hiệu lực.
  React.useEffect(() => {
    if (hookError) setLocalError(null);
  }, [hookError]);

  const shownError: LocalActionError | null = hookError ?? localError;

  const postQuery = useQuery({
    queryKey: socialKeys.posts.detail(postId),
    queryFn: () => socialApi.getPost(postId),
    // 404 là một CÂU TRẢ LỜI (bài đã xoá / không được xem), không phải lỗi mạng ⇒ đừng thử lại 3 lần
    // rồi mới hiện. Lỗi khác vẫn theo chính sách retry mặc định.
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });

  const commentsQuery = useInfiniteQuery({
    queryKey: socialKeys.posts.comments(postId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => socialApi.listComments(postId, { cursor: pageParam, limit: 20 }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: postQuery.isSuccess,
  });

  /** Làm mới đúng hai nhánh mà một thay đổi về bình luận chạm tới (`commentCount` nằm TRÊN bài). */
  const invalidateComments = (): void => {
    void queryClient.invalidateQueries({ queryKey: socialKeys.posts.comments(postId) });
    void queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(postId) });
  };

  const createComment = useMutation({
    mutationFn: (dto: CreateFeedCommentDto) => socialApi.createComment(postId, dto),
    onSuccess: () => {
      invalidateComments();
      setLocalError(null);
    },
    // Thiếu `onError` ở đây là câm TUYỆT ĐỐI: app không có hệ toast và `QueryClient` ở `main.tsx`
    // không khai `MutationCache.onError` ⇒ nút nhả ra như cũ, không một ký tự nào xuất hiện.
    onError: reportLocalError("comment"),
  });

  const deleteComment = useMutation({
    mutationFn: (commentId: string) => socialApi.deleteComment(commentId),
    onSuccess: () => {
      invalidateComments();
      setLocalError(null);
    },
    onError: reportLocalError("commentDelete"),
  });

  /**
   * Cảm xúc trên BÌNH LUẬN đi đường `018/019` — khác đường của bài (`011/012`), cùng bảng
   * `feed_reactions` đa hình phía DB nhưng KHÁC route.
   *
   * 🔴 Từng là `void (…).then(…)` trần: không `.catch` ⇒ hỏng im lặng 100% **và** một unhandled
   * promise rejection (lớp lỗi làm CI đỏ trong khi mọi test PASS); không pending ⇒ bấm nhanh hai
   * lần là hai request đua nhau trên cùng một mục tiêu, cái về sau thắng.
   */
  const commentReaction = useMutation({
    mutationFn: ({
      commentId,
      emoji,
    }: {
      commentId: string;
      emoji: FeedReactionEmojiDto | null;
    }) =>
      emoji === null
        ? socialApi.deleteCommentReaction(commentId)
        : socialApi.putCommentReaction(commentId, emoji),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: socialKeys.posts.comments(postId) });
      setLocalError(null);
    },
    onError: reportLocalError("reaction"),
  });

  const comments: FeedCommentDto[] = React.useMemo(
    () => (commentsQuery.data?.pages ?? []).flatMap((p) => p.data),
    [commentsQuery.data],
  );

  if (postQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" data-testid="post-detail-loading">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  // 🔴 CHỈ `ApiError` 404 mới là "bài không còn đó". Mọi thứ khác — 500, mất mạng, `ZodError` khi
  // HTTP 200 — là LỖI CỦA HỆ THỐNG, và phải được kể ra như lỗi, kèm đường thử lại. Xem hộp ở đầu file.
  if (postQuery.error instanceof ApiError && postQuery.error.status === 404) {
    // Một câu cho CẢ "đã xoá" lẫn "không được xem" — xem docblock đầu file.
    return (
      <div
        data-testid="post-detail-not-found"
        className="rounded-lg border border-dashed border-border p-8 text-center"
      >
        <p className="text-sm font-medium text-foreground">{t("detail.notFound")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("detail.notFoundBody")}</p>
        <Link
          to="/feed"
          className="mt-3 inline-flex items-center gap-1 rounded text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("detail.backToFeed")}
        </Link>
      </div>
    );
  }

  if (postQuery.isError || !postQuery.data) {
    // Cùng khuôn với `FeedPostList` — người dùng phải BIẾT là hỏng và tự thử lại được.
    return (
      <div
        role="alert"
        data-testid="post-detail-error"
        className="rounded-lg border border-border bg-card p-6 text-center"
      >
        <p className="text-sm font-medium text-foreground">{t("state.errorTitle")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("state.errorBody")}</p>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => void postQuery.refetch()}
        >
          {t("state.retry")}
        </Button>
      </div>
    );
  }

  const post = postQuery.data;

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/feed"
        className="inline-flex w-fit items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("detail.backToFeed")}
      </Link>

      {/*
        ĐÚNG MỘT dải cho mọi đường ghi của màn (bài + bình luận). `role="alert"` ⇒ trình đọc màn hình
        đọc ngay; đặt trên cùng để nó không bị cuộn khuất khi lỗi xảy ra ở cuối trang.
      */}
      {shownError && (
        <ActionErrorBanner
          kind={shownError.kind}
          forbidden={shownError.forbidden}
          onDismiss={() => {
            clearActionError();
            setLocalError(null);
          }}
        />
      )}

      <PostCard
        post={post}
        variant="detail"
        reactionSummary={actions.reactionSummaries[post.id]}
        isReactionPending={actions.pendingReactionPostId === post.id}
        isSavePending={actions.pendingSavePostId === post.id}
        onReactionChange={(emoji) => actions.setReaction(post.id, emoji)}
        onToggleSave={() => actions.toggleSave(post.id, post.savedByMe)}
        // Cùng helper với 4 màn kia. `openDetail` BỎ TRỐNG vì ta đang ĐỨNG ở màn chi tiết — một mục
        // menu điều hướng về chính trang đang mở là cái bẫy, không phải tính năng. Xoá xong thì phải
        // rời trang: ở lại sẽ hiện "không tìm thấy bài viết" cho bài mình vừa chủ động xoá.
        menuActions={buildPostMenuActions(post, {
          actions,
          afterDelete: () => void navigate({ to: "/feed" }),
        })}
      />

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">{t("comment.heading")}</h2>

        <CommentComposer
          // `mutateAsync`, KHÔNG `mutate`: hợp đồng mới của composer là «chỉ dọn ô soạn khi Promise
          // RESOLVE». `mutate` trả `void` ⇒ composer không có cách nào biết lượt gửi đã xong ⇒ giữ
          // nguyên chữ đã gõ mãi mãi (an toàn, nhưng vướng — người dùng phải tự xoá sau mỗi lượt).
          onSubmit={(dto) => createComment.mutateAsync(dto)}
          isSubmitting={createComment.isPending}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          locked={post.commentsLocked}
          className="mb-4"
        />

        <CommentList
          comments={comments}
          // Ba trạng thái của `014` đi XUỐNG component; bản đầu giữ chúng lại ở đây nên cả "đang
          // tải" lẫn "500" đều hiện thành «Chưa có bình luận nào.» (H5).
          isLoading={commentsQuery.isLoading}
          isError={commentsQuery.isError}
          onRetry={() => void commentsQuery.refetch()}
          pendingReactionCommentId={
            commentReaction.isPending ? (commentReaction.variables?.commentId ?? null) : null
          }
          onReply={(c) =>
            setReplyTo({
              commentId: c.id,
              authorName: c.author.fullName ?? t("post.unknownAuthor"),
            })
          }
          onDelete={(c) => deleteComment.mutate(c.id)}
          onReactionChange={(c, emoji) => commentReaction.mutate({ commentId: c.id, emoji })}
        />

        {commentsQuery.hasNextPage && (
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={() => void commentsQuery.fetchNextPage()}
            disabled={commentsQuery.isFetchingNextPage}
          >
            {t("comment.loadMore")}
          </Button>
        )}
      </section>
    </div>
  );
}
