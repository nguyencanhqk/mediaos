/**
 * S16-SOCIAL-FE-1 — `SOC-SCREEN-002` Chi tiết bài (SOCIAL-API-003 · 013 · 014 · 015 · 017).
 *
 * Bài + toàn bộ bình luận + danh sách người đã bày tỏ cảm xúc.
 *
 * ⚠️ **Bài đã xoá / không còn quyền xem ⇒ trạng thái RỖNG có nghĩa, không phải màn lỗi** (ca C8).
 * Server trả 404 cho CẢ HAI tình huống — cố ý: phân biệt chúng là nói cho người gọi biết "bài này có
 * tồn tại, chỉ là bạn không được xem", tức một oracle dò nội dung. FE vì vậy cũng chỉ được hiện đúng
 * một câu cho cả hai.
 */
import * as React from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Button, Skeleton } from "@mediaos/ui";
import { ApiError, socialApi, socialKeys } from "@mediaos/web-core";
import type { CreateFeedCommentDto, FeedCommentDto } from "@mediaos/contracts";
import { PostCard } from "./components/PostCard";
import { CommentList } from "./components/CommentList";
import { CommentComposer } from "./components/CommentComposer";
import { useFeedActions } from "./lib/use-feed-actions";

export function PostDetailPage(): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const actions = useFeedActions();
  const { postId } = useParams({ strict: false }) as { postId: string };

  const [replyTo, setReplyTo] = React.useState<{ commentId: string; authorName: string } | null>(
    null,
  );

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

  const createComment = useMutation({
    mutationFn: (dto: CreateFeedCommentDto) => socialApi.createComment(postId, dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: socialKeys.posts.comments(postId) });
      // `commentCount` nằm trên chính bài ⇒ phải làm mới cả chi tiết, không chỉ danh sách bình luận.
      void queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(postId) });
    },
  });

  const deleteComment = useMutation({
    mutationFn: (commentId: string) => socialApi.deleteComment(commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: socialKeys.posts.comments(postId) });
      void queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(postId) });
    },
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

  if (postQuery.isError || !postQuery.data) {
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

      <PostCard
        post={post}
        variant="detail"
        reactionSummary={actions.reactionSummaries[post.id]}
        isReactionPending={actions.pendingReactionPostId === post.id}
        isSavePending={actions.pendingSavePostId === post.id}
        onReactionChange={(emoji) => actions.setReaction(post.id, emoji)}
        onToggleSave={() => actions.toggleSave(post.id, post.savedByMe)}
        menuActions={{
          onCopyLink: () => {
            void navigator.clipboard?.writeText(window.location.href);
          },
          onEdit: () => {},
          onDelete: () => {
            actions.remove(post.id);
            void navigate({ to: "/feed" });
          },
          onToggleHidden: () => actions.moderate(post.id, { hidden: post.status !== "hidden" }),
          onToggleComments: () => actions.moderate(post.id, { locked: !post.commentsLocked }),
          onTogglePinned: () => actions.moderate(post.id, { pinned: !post.pinned }),
        }}
      />

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">{t("comment.heading")}</h2>

        <CommentComposer
          onSubmit={(dto) => createComment.mutate(dto)}
          isSubmitting={createComment.isPending}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          locked={post.commentsLocked}
          className="mb-4"
        />

        <CommentList
          comments={comments}
          onReply={(c) =>
            setReplyTo({
              commentId: c.id,
              authorName: c.author.fullName ?? t("post.unknownAuthor"),
            })
          }
          onDelete={(c) => deleteComment.mutate(c.id)}
          onReactionChange={(c, emoji) => {
            // Cảm xúc trên BÌNH LUẬN đi đường 018/019 — khác đường của bài (011/012), cùng bảng
            // `feed_reactions` đa hình phía DB nhưng KHÁC route.
            void (
              emoji === null
                ? socialApi.deleteCommentReaction(c.id)
                : socialApi.putCommentReaction(c.id, emoji)
            ).then(() =>
              queryClient.invalidateQueries({ queryKey: socialKeys.posts.comments(postId) }),
            );
          }}
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
