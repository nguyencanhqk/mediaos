/**
 * S16-SOCIAL-FE-1 — `SOC-SCREEN-001` Bảng tin (SOCIAL-API-001 · 002 · 023).
 *
 * Một màn, HAI chế độ đọc, chọn bằng `?q=`:
 *  - không có `q` ⇒ dòng cuộn `GET /social/feed` (001);
 *  - có `q`      ⇒ kết quả `GET /social/search` (023), **câu rỗng RIÊNG** (ca C12).
 * Gộp vào một màn vì kết quả tìm kiếm trả CÙNG thẻ bài và cùng cách phân trang — tách thành route
 * thứ hai chỉ để đổi nguồn dữ liệu là nhân đôi mọi thứ còn lại.
 *
 * ⚠️ Bộ lọc sống trong URL (plan D6). Badge «N bài mới» chỉ ĐẾM, bấm mới tải lại (plan D7) — xem
 * `useFeedRealtime`.
 *
 * ⚠️ **«Dải ô liên kết nhanh» (SC-14) CỐ Ý VẮNG.** SPEC-16 §9 liệt nó trong `SOC-SCREEN-001`, nhưng
 * nó thuộc track C và owner đã ký hoãn sang `S16-SOCIAL-FE-3` (plan finding #11). Màn này vì vậy ship
 * THIẾU phần đó — nói ra ở đây để người đọc sau không tưởng là quên.
 */
import * as React from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { socialApi, socialKeys, useCan } from "@mediaos/web-core";
import type { CreateFeedPostDto, FeedPostDto, FeedSortDto } from "@mediaos/contracts";
import { useFeedRealtime } from "@/hooks/use-feed-realtime";
import { FeedComposer } from "./components/FeedComposer";
import { FeedPostList } from "./components/FeedPostList";
import { NewFeedPostsBadge } from "./components/NewFeedPostsBadge";
import { buildPostMenuActions, useFeedActions } from "./lib/use-feed-actions";

interface FeedRouteSearch {
  sort?: FeedSortDto;
  tag?: string;
  type?: string;
  /** Từ khoá tìm kiếm (SOCIAL-API-023). Có ⇒ màn chuyển sang chế độ kết quả. */
  q?: string;
  /** Lời chúc sinh nhật điền sẵn vào composer — THAM SỐ CHỈ CỦA FE, không gửi lên API. */
  wish?: string;
}

export function FeedPage(): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = useSearch({ strict: false }) as FeedRouteSearch;
  const actions = useFeedActions();
  const { newPostCount, reset: resetNewPosts } = useFeedRealtime();
  const canManagePost = useCan("manage", "feed-post");

  const isSearching = Boolean(search.q && search.q.trim().length > 0);

  /**
   * Tham số gửi lên API — **KHÔNG** mang `wish` (tham số của FE) và **KHÔNG** mang `status` nếu người
   * dùng không có `manage:feed-post`: route 001 ném **403** cho `status` khác `published` ở tầng 2,
   * nên gửi bừa là biến một bộ lọc thành một màn lỗi.
   */
  const listParams = React.useMemo(
    () => ({
      ...(search.sort ? { sort: search.sort } : {}),
      ...(search.tag ? { tag: search.tag } : {}),
      ...(search.type ? { type: search.type } : {}),
    }),
    [search.sort, search.tag, search.type],
  );

  const feedQuery = useInfiniteQuery({
    queryKey: isSearching ? socialKeys.search({ q: search.q }) : socialKeys.feed.list(listParams),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      isSearching
        ? socialApi.search({ q: search.q!.trim(), cursor: pageParam, limit: 20 })
        : socialApi.listFeed({ ...listParams, cursor: pageParam }),
    // `nextCursor: null` = trang cuối. Trả `undefined` để react-query tắt `hasNextPage`.
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const createMutation = useMutation({
    mutationFn: (dto: CreateFeedPostDto) => socialApi.createPost(dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: socialKeys.feed.allOf() });
      // Bài của CHÍNH mình vừa đăng cũng đi qua WS về lại; reset để badge không đếm nó.
      resetNewPosts();
    },
  });

  const posts: FeedPostDto[] = React.useMemo(
    () => (feedQuery.data?.pages ?? []).flatMap((p) => p.data),
    [feedQuery.data],
  );

  /** Bấm badge: tải lại danh sách + cuộn lên đầu + reset đếm (D7). KHÔNG chèn bài. */
  const onBadgeClick = (): void => {
    void queryClient.invalidateQueries({
      queryKey: isSearching ? socialKeys.search({ q: search.q }) : socialKeys.feed.list(listParams),
    });
    resetNewPosts();
    /**
     * ⚠️ Guard `typeof window.scrollTo === "function"` là VÔ DỤNG ở đây — đo thật trong jsdom: nó
     * **có** định nghĩa `scrollTo`, nên guard luôn đi lọt; jsdom ghi `Error: Not implemented:
     * window.scrollTo` ra virtual console (không ném cho caller). Dòng log đó vẫn xuất hiện dù có
     * `try/catch`, và đó là hành vi ĐÚNG của jsdom, không phải lỗi cần vá.
     *
     * `try/catch` giữ lại cho môi trường nhúng nào đó THỰC SỰ ném: cuộn là việc TRANG TRÍ, hỏng nó
     * không được phép hỏng việc tải lại danh sách — thứ người dùng vừa bấm badge để làm.
     */
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      // Môi trường không cuộn được (jsdom, webview hạn chế) — bỏ qua, không phải lỗi nghiệp vụ.
    }
  };

  // Sáu hành động của menu ⋯ dựng bằng helper DÙNG CHUNG — bốn màn cùng một luật, một chỗ sửa.
  const buildMenuActions = (post: FeedPostDto) =>
    buildPostMenuActions(post, {
      actions,
      openDetail: (postId) => void navigate({ to: "/feed/posts/$postId", params: { postId } }),
    });

  const setSort = (sort: FeedSortDto): void => {
    void navigate({
      to: "/feed",
      search: (prev: Record<string, unknown>) => ({ ...prev, sort }),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <FeedComposer
        onSubmit={(dto) => createMutation.mutate(dto)}
        isSubmitting={createMutation.isPending}
        prefillBody={search.wish ? t("birthday.wishPrefill", { name: search.wish }) : undefined}
      />

      {/* Bộ lọc — giá trị đọc TỪ URL, không từ state nội bộ (D6). */}
      {!isSearching && (
        <div className="flex flex-wrap items-center gap-2" data-testid="feed-filters">
          <span className="text-sm text-muted-foreground">{t("filter.sortLabel")}</span>
          {(["active", "latest"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              aria-pressed={(search.sort ?? "active") === s}
              data-testid={`feed-sort-${s}`}
              className="rounded-full px-3 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:font-medium aria-pressed:text-accent-foreground"
            >
              {s === "active" ? t("filter.sortActive") : t("filter.sortLatest")}
            </button>
          ))}

          {search.tag && (
            <button
              type="button"
              onClick={() =>
                void navigate({
                  to: "/feed",
                  search: (prev: Record<string, unknown>) => {
                    const { tag: _tag, ...rest } = prev;
                    return rest;
                  },
                })
              }
              className="rounded-full bg-accent px-3 py-1 text-sm text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("filter.clearTag", { tag: search.tag })}
            </button>
          )}

          {/* Bộ lọc trạng thái CHỈ cho người có `manage:feed-post` — xem ghi chú ở `listParams`. */}
          {canManagePost && (
            <span className="text-xs text-muted-foreground">{t("filter.statusLabel")}</span>
          )}
        </div>
      )}

      <NewFeedPostsBadge count={newPostCount} onClick={onBadgeClick} />

      <FeedPostList
        posts={posts}
        isLoading={feedQuery.isLoading}
        isError={feedQuery.isError}
        onRetry={() => void feedQuery.refetch()}
        // 🔴 Ba câu rỗng KHÁC NHAU (C12): tìm kiếm rỗng ≠ bảng tin rỗng.
        emptyText={isSearching ? t("empty.search") : t("empty.feed")}
        emptyHint={isSearching ? t("empty.searchHint") : t("empty.feedHint")}
        hasNextPage={feedQuery.hasNextPage}
        isFetchingNextPage={feedQuery.isFetchingNextPage}
        onLoadMore={() => void feedQuery.fetchNextPage()}
        actions={actions}
        buildMenuActions={buildMenuActions}
      />
    </div>
  );
}
