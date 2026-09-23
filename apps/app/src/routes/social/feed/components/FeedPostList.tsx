/**
 * S16-SOCIAL-FE-1 — danh sách thẻ bài + 5 trạng thái của SPEC-16 §14, dùng chung cho 4 màn
 * (`001` Bảng tin · `004` Đã lưu · `005` Trang cá nhân · kết quả tìm kiếm).
 *
 * ┌─ 🔴 BA CÂU RỖNG KHÁC NHAU (ca C12) ──────────────────────────────────────────────────────────┐
 * │ `emptyText` là **bắt buộc**, không có mặc định. Một mặc định kiểu «chưa có dữ liệu» sẽ được    │
 * │ dùng ở cả ba chỗ và người dùng ở màn tìm kiếm sẽ đọc «chưa có bài nào» — sai sự thật, và đẩy   │
 * │ họ đi sửa nhầm thứ (đăng bài mới thay vì đổi từ khoá).                                         │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Loading dùng **skeleton hình THẺ BÀI**, không phải spinner giữa trang (UI-07 §34b.5): spinner làm
 * cả cột nhảy chiều cao khi dữ liệu về.
 */
import { useTranslation } from "react-i18next";
import { Button, Skeleton, cn } from "@mediaos/ui";
import type { FeedPostDto, FeedReactionEmojiDto } from "@mediaos/contracts";
import { PostCard } from "./PostCard";
import type { PostCardMenuActions } from "./PostCardMenu";
import type { FeedActions } from "../lib/use-feed-actions";

interface FeedPostListProps {
  posts: readonly FeedPostDto[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** Câu rỗng RIÊNG của từng màn — xem hộp cảnh báo ở đầu file. */
  emptyText: string;
  emptyHint?: string;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  actions: FeedActions;
  buildMenuActions: (post: FeedPostDto) => PostCardMenuActions;
  className?: string;
}

function PostCardSkeleton(): React.ReactElement {
  return (
    <div className="rounded-lg border border-border bg-card p-4" aria-busy="true">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Skeleton className="mt-3 h-16 w-full" />
    </div>
  );
}

export function FeedPostList({
  posts,
  isLoading,
  isError,
  onRetry,
  emptyText,
  emptyHint,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
  actions,
  buildMenuActions,
  className,
}: FeedPostListProps): React.ReactElement {
  const { t } = useTranslation("social");

  if (isLoading) {
    return (
      <div
        className={cn("flex flex-col gap-3", className)}
        data-testid="feed-loading"
        aria-label={t("state.loadingAria")}
      >
        <PostCardSkeleton />
        <PostCardSkeleton />
      </div>
    );
  }

  if (isError) {
    // Khối lỗi nằm TRONG cột giữa; hai rail do `PortalLayout` giữ nguyên (ca C13).
    return (
      <div
        role="alert"
        data-testid="feed-error"
        className={cn("rounded-lg border border-border bg-card p-6 text-center", className)}
      >
        <p className="text-sm font-medium text-foreground">{t("state.errorTitle")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("state.errorBody")}</p>
        <Button type="button" variant="outline" className="mt-3" onClick={onRetry}>
          {t("state.retry")}
        </Button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div
        data-testid="feed-empty"
        className={cn("rounded-lg border border-dashed border-border p-8 text-center", className)}
      >
        <p className="text-sm text-foreground">{emptyText}</p>
        {emptyHint && <p className="mt-1 text-sm text-muted-foreground">{emptyHint}</p>}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="feed-post-list">
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          reactionSummary={actions.reactionSummaries[post.id]}
          isReactionPending={actions.pendingReactionPostId === post.id}
          isSavePending={actions.pendingSavePostId === post.id}
          onReactionChange={(emoji: FeedReactionEmojiDto | null) =>
            actions.setReaction(post.id, emoji)
          }
          onToggleSave={() => actions.toggleSave(post.id, post.savedByMe)}
          menuActions={buildMenuActions(post)}
        />
      ))}

      {hasNextPage && (
        <Button
          type="button"
          variant="outline"
          onClick={onLoadMore}
          disabled={isFetchingNextPage}
          data-testid="feed-load-more"
        >
          {isFetchingNextPage ? t("state.loadingMore") : t("state.loadMore")}
        </Button>
      )}
    </div>
  );
}
