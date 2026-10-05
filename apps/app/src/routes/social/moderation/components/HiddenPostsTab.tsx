/**
 * S16-SOCIAL-FE-3 (L2) — tab «Bài đang ẩn» của `SOC-SCREEN-010` (plan D11; owner ký O4 = a).
 *
 * Đọc `SOCIAL-API-001` với `{ status: "hidden", sort: "latest" }` (keyset, KHÔNG có tổng số), «Hiện lại»
 * bằng `SOCIAL-API-006` với ĐÚNG `{ hidden: false }`.
 *
 * ┌─ NĂM ĐIỀU DỄ LÀM SAI ────────────────────────────────────────────────────────────────────────────┐
 * │ 1. Cổng: 001 `status=hidden` thiếu `manage:feed-post` là 403 ⇒ `enabled` theo `useCan`. Màn không  │
 * │    mount tab này cho người thiếu quyền; `enabled` là lớp thứ hai, không phải lớp duy nhất.         │
 * │ 2. Khoá cache RIÊNG `socialKeys.moderation.hiddenPosts()` — không dùng `socialKeys.feed.list(…)`: │
 * │    dòng cuộn `/feed` chỉ gác `view:feed`, bài ẩn nằm chung nhánh là để dữ liệu của cổng CHẶT lẫn   │
 * │    vào entry mà cổng LỎNG đọc được.                                                                │
 * │ 3. Giới hạn của nguồn (server loại bài trong NHÓM khi vắng `groupId`, không trả tổng — plan M4)    │
 * │    LUÔN ghi trên màn, kể cả khi rỗng: «Không có bài nào đang ẩn» mà thiếu câu đó là nói quá.       │
 * │ 4. Dải kết quả của 006 sống ở TAB, không ở hàng: sau khi làm mới, hàng vừa bấm biến mất và mọi thứ │
 * │    mount dưới nó mất theo (plan B6).                                                               │
 * │ 5. Avatar chỉ vẽ theo TÊN, không truyền `src` (plan D8). Body vẽ như văn bản thuần.                │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Dòng GỌN tự vẽ — cố ý KHÔNG dùng `PostCard` / `useFeedActions`: người kiểm duyệt cần nhận ra bài và
 * hiện lại nó, không cần cảm xúc/bình luận/menu của thẻ bài.
 */
import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Avatar, Button } from "@mediaos/ui";
import { socialApi, socialKeys, useCan } from "@mediaos/web-core";
import type {
  FeedPostDto,
  FeedPostPageDto,
  ListFeedQueryDto,
  ModerateFeedPostDto,
} from "@mediaos/contracts";
import { AdminErrorNotice } from "../../admin/components/AdminErrorNotice";
import type { AdminErrorReason } from "../../admin/lib/admin-errors";
import { authorDisplayName, relativeTime } from "../../feed/lib/feed-format";
import { describeModerationReadError, describeUnhidePostError } from "../lib/moderation-errors";

type HiddenFeedQuery = Pick<ListFeedQueryDto, "status" | "sort"> &
  Partial<Pick<ListFeedQueryDto, "cursor">>;
type HiddenPostsData = InfiniteData<FeedPostPageDto, string | undefined>;

/** Dải kết quả của lượt 006 gần nhất. `retryPostId` có ⇔ gửi lại NGUYÊN yêu cầu đó có thể thành công. */
type ActionNotice =
  | { kind: "done" }
  | { kind: "failed"; reason: AdminErrorReason; retryPostId: string | null };

const HIDDEN_FEED_QUERY = { status: "hidden", sort: "latest" } as const;
const SKELETON_ROWS = [0, 1, 2] as const;
const PLACEHOLDER_CLASS =
  "rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground";

/** Tham số 001: con trỏ CHỈ có mặt từ lượt hai (khoá vắng, không phải `undefined`). */
function hiddenFeedQuery(cursor: string | undefined): HiddenFeedQuery {
  return cursor === undefined ? { ...HIDDEN_FEED_QUERY } : { ...HIDDEN_FEED_QUERY, cursor };
}

/** Body 006 của «Hiện lại»: ĐÚNG một khoá — kèm `pinned`/`commentsLocked` là đổi thứ người dùng không bấm. */
function unhideBody(): ModerateFeedPostDto {
  return { hidden: false };
}

function withoutPost(data: HiddenPostsData | undefined, postId: string) {
  if (data === undefined) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      data: page.data.filter((post) => post.id !== postId),
    })),
  };
}

interface HiddenPostRowProps {
  post: FeedPostDto;
  isBusy: boolean;
  onUnhide: (postId: string) => void;
}

function HiddenPostRow({ post, isBusy, onUnhide }: HiddenPostRowProps): React.ReactElement {
  const { t } = useTranslation("social");
  const authorName = authorDisplayName(post.author, t("admin.moderation.hidden.authorUnknown"));

  return (
    <article className="rounded-lg border border-border bg-card p-3">
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <Avatar name={authorName} size="sm" />
        <span className="font-medium text-foreground">{authorName}</span>
        <time dateTime={post.publishedAt} className="ml-auto text-xs text-muted-foreground">
          {relativeTime(post.publishedAt)}
        </time>
      </header>

      {post.body === null ? (
        <p className="mt-2 text-sm italic text-muted-foreground">
          {t("admin.moderation.hidden.noBody")}
        </p>
      ) : (
        <p className="mt-2 line-clamp-3 whitespace-pre-line break-words text-sm text-foreground">
          {post.body}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <Link
          to="/feed/posts/$postId"
          params={{ postId: post.id }}
          className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("admin.moderation.hidden.viewPost")}
        </Link>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isBusy}
          onClick={() => onUnhide(post.id)}
        >
          {t("admin.moderation.hidden.unhide")}
        </Button>
      </div>
    </article>
  );
}

export function HiddenPostsTab(): React.ReactElement | null {
  const { t } = useTranslation("social");
  const queryClient = useQueryClient();
  const canManagePosts = useCan("manage", "feed-post");
  const [notice, setNotice] = React.useState<ActionNotice | null>(null);

  const query = useInfiniteQuery({
    queryKey: socialKeys.moderation.hiddenPosts(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => socialApi.listFeed(hiddenFeedQuery(pageParam)),
    // «Tải thêm» ⇔ server CÒN trang: `nextCursor !== null`.
    getNextPageParam: (last) => (last.nextCursor === null ? undefined : last.nextCursor),
    enabled: canManagePosts,
    // Danh sách kiểm duyệt cũ mà trông như mới là mời hiện lại một bài đã được người khác xử lý.
    staleTime: 0,
  });

  const unhide = useMutation({
    // Mọi thứ gửi đi nằm trong `variables` — thân hàm KHÔNG đọc state (v5 nạp lại closure trong effect).
    mutationFn: (postId: string) => socialApi.moderatePost(postId, unhideBody()),
    onSuccess: (_post, postId) => {
      setNotice({ kind: "done" });
      // Gỡ hàng ngay: trong lúc chờ refetch, nút «Hiện lại» của bài vừa hiện không còn để bấm lần nữa.
      queryClient.setQueryData<HiddenPostsData>(socialKeys.moderation.hiddenPosts(), (current) =>
        withoutPost(current, postId),
      );
      void queryClient.invalidateQueries({ queryKey: socialKeys.moderation.hiddenPosts() });
      void queryClient.invalidateQueries({ queryKey: socialKeys.feed.allOf() });
      void queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(postId) });
    },
    onError: (err: unknown, postId) => {
      const { reason, invalidate, retryable } = describeUnhidePostError(err);
      setNotice({ kind: "failed", reason, retryPostId: retryable ? postId : null });
      if (invalidate) {
        void queryClient.invalidateQueries({ queryKey: socialKeys.moderation.hiddenPosts() });
      }
    },
  });

  if (!canManagePosts) return null;

  const handleUnhide = (postId: string): void => {
    if (unhide.isPending) return;
    setNotice(null);
    unhide.mutate(postId);
  };

  const posts = (query.data?.pages ?? []).flatMap((page) => page.data);

  const renderBody = (): React.ReactElement => {
    if (query.isError) {
      const { reason, retryable } = describeModerationReadError(query.error);
      return (
        <AdminErrorNotice
          reason={reason}
          onRetry={retryable ? () => void query.refetch() : undefined}
        />
      );
    }
    if (query.data === undefined) {
      return (
        <div
          role="status"
          aria-label={t("admin.moderation.hidden.loadingAria")}
          className="flex flex-col gap-2"
        >
          {SKELETON_ROWS.map((row) => (
            <div key={row} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      );
    }
    return (
      <>
        {posts.length === 0 && !query.hasNextPage ? (
          <p className={PLACEHOLDER_CLASS}>{t("admin.moderation.hidden.empty")}</p>
        ) : (
          <ul aria-label={t("admin.moderation.hidden.listAria")} className="flex flex-col gap-2">
            {posts.map((post) => (
              <li key={post.id}>
                <HiddenPostRow post={post} isBusy={unhide.isPending} onUnhide={handleUnhide} />
              </li>
            ))}
          </ul>
        )}
        {query.hasNextPage && (
          <div className="flex justify-center">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t("admin.moderation.hidden.loadMore")}
            </Button>
          </div>
        )}
      </>
    );
  };

  return (
    <section className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("admin.moderation.hidden.limitNote")}</p>

      {/* Lượt đọc đang LỖI ⇒ không vẽ dải của 006: «danh sách đã được làm mới» cạnh «không tải được». */}
      {notice !== null && !query.isError && (
        <ActionNoticeBar notice={notice} onRetry={handleUnhide} onDismiss={() => setNotice(null)} />
      )}

      {renderBody()}
    </section>
  );
}

interface ActionNoticeBarProps {
  notice: ActionNotice;
  onRetry: (postId: string) => void;
  onDismiss: () => void;
}

function ActionNoticeBar({ notice, onRetry, onDismiss }: ActionNoticeBarProps): React.ReactElement {
  const { t } = useTranslation("social");
  if (notice.kind === "failed") {
    const { retryPostId } = notice;
    return (
      <AdminErrorNotice
        reason={notice.reason}
        onRetry={retryPostId === null ? undefined : () => onRetry(retryPostId)}
        onDismiss={onDismiss}
      />
    );
  }
  return (
    <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
      {t("admin.moderation.hidden.unhidden")}
    </p>
  );
}
