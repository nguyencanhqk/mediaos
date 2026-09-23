/**
 * S16-SOCIAL-FE-1 — `SOC-SCREEN-003` Tin tức (SOCIAL-API-020 · 021 · 022).
 *
 * ┌─ 🔴 HAI CỔNG QUYỀN KHÁC NHAU TRÊN CÙNG MỘT MÀN — đừng gộp ───────────────────────────────────┐
 * │ • Danh sách tin + nút «Xác nhận đã đọc» → `view:feed`. Route 021 luôn dùng `actor.id` và body  │
 * │   KHÔNG nhận `userId`, nên không có đường ack hộ người khác ⇒ không cần cặp quản trị nào.      │
 * │ • Tab «Danh sách đã đọc» (022)          → **`manage:feed-news`**. Nửa "chưa đọc" của route đó  │
 * │   chiếu tên/avatar của MỌI người trong audience, kể cả người chưa tương tác gì — một đường     │
 * │   chiếu danh tính toàn công ty, không phải một danh sách tương tác.                            │
 * │ Gộp hai cổng làm một (dù theo chiều nào) là hoặc khoá mất tính năng của nhân viên thường, hoặc │
 * │ mở danh bạ cho họ. Ca **C9** giữ cả hai vế.                                                    │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import * as React from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Avatar, Button, Skeleton, cn } from "@mediaos/ui";
import { PermissionGate, socialApi, socialKeys, useCan } from "@mediaos/web-core";
import type { FeedNewsItemDto } from "@mediaos/contracts";
import { PostBody } from "./components/PostBody";
import { authorDisplayName, relativeTime } from "./lib/feed-format";

/** Bảng người đã/chưa đọc của MỘT tin (022) — chỉ mở khi có `manage:feed-news`. */
function NewsReaders({ postId }: { postId: string }): React.ReactElement {
  const { t } = useTranslation("social");
  const acksQuery = useQuery({
    queryKey: socialKeys.posts.acks(postId),
    queryFn: () => socialApi.listPostAcks(postId, { limit: 50 }),
  });

  if (acksQuery.isLoading) return <Skeleton className="h-16 w-full" />;
  if (acksQuery.isError) {
    return <p className="text-sm text-muted-foreground">{t("state.errorBody")}</p>;
  }

  const people = acksQuery.data?.data ?? [];
  if (people.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="news-readers-empty">
        {t("news.readersEmpty")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1" data-testid="news-readers-list">
      {people.map((p) => (
        <li key={p.employeeId ?? p.fullName} className="flex items-center gap-2 text-sm">
          <Avatar name={p.fullName ?? t("post.unknownAuthor")} size="sm" />
          <span className="flex-1 truncate text-foreground">
            {p.fullName ?? t("post.unknownAuthor")}
          </span>
          <span className="text-xs text-muted-foreground">
            {p.ackedAt ? t("news.readersRead") : t("news.readersUnread")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function NewsRow({ item }: { item: FeedNewsItemDto }): React.ReactElement {
  const { t } = useTranslation("social");
  const queryClient = useQueryClient();
  const canManageNews = useCan("manage", "feed-news");
  const [showReaders, setShowReaders] = React.useState(false);

  const ackMutation = useMutation({
    mutationFn: () => socialApi.ackPost(item.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: socialKeys.news.allOf() });
    },
  });

  return (
    <article
      data-testid="news-row"
      className="rounded-lg border border-border bg-card p-4"
      data-acked={item.ackedByMe}
    >
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium text-foreground">
          {authorDisplayName(item.author, t("post.unknownAuthor"))}
        </span>
        <span className="text-xs text-muted-foreground">{relativeTime(item.publishedAt)}</span>
        {item.pinned && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
            {t("post.pinned")}
          </span>
        )}
      </header>

      <PostBody body={item.body} collapsible className="mt-2" />

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
        {/*
          Nút ack chỉ có nghĩa với tin YÊU CẦU xác nhận. `ackedByMe` LUÔN có mặt (kể cả khi
          `requiresAck=false`, khi đó luôn `false`) — contracts cố ý làm vậy để FE không phải phân
          biệt `undefined` với `false`, hai thứ mang nghĩa hoàn toàn khác nhau.
        */}
        {item.requiresAck &&
          (item.ackedByMe ? (
            <span className="text-sm text-muted-foreground" data-testid="news-acked">
              {t("news.acked")}
            </span>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => ackMutation.mutate()}
              disabled={ackMutation.isPending}
              data-testid="news-ack-button"
            >
              {ackMutation.isPending ? t("news.acking") : t("news.ackButton")}
            </Button>
          ))}

        {/* 🔴 `manage:feed-news` — xem hộp cảnh báo ở đầu file. */}
        <PermissionGate action="manage" resourceType="feed-news">
          <button
            type="button"
            onClick={() => setShowReaders((v) => !v)}
            aria-expanded={showReaders}
            data-testid="news-readers-toggle"
            className="ml-auto rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("news.readersTab")}
          </button>
        </PermissionGate>
      </div>

      {/* Chỉ tải 022 khi người dùng THỰC SỰ mở — nó chiếu danh tính, đừng gọi sẵn cho vui. */}
      {showReaders && canManageNews && (
        <div className="mt-3 border-t border-border pt-3">
          <h3 className="mb-2 text-sm font-medium text-foreground">{t("news.readersTitle")}</h3>
          <NewsReaders postId={item.id} />
        </div>
      )}
    </article>
  );
}

export function NewsPage(): React.ReactElement {
  const { t } = useTranslation("social");

  const newsQuery = useInfiniteQuery({
    queryKey: socialKeys.news.list({}),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => socialApi.listNews({ cursor: pageParam, limit: 20 }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = React.useMemo(
    () => (newsQuery.data?.pages ?? []).flatMap((p) => p.data),
    [newsQuery.data],
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("news.title")}</h1>

      {newsQuery.isLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true" data-testid="news-loading">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : newsQuery.isError ? (
        <div
          role="alert"
          data-testid="news-error"
          className="rounded-lg border border-border bg-card p-6 text-center"
        >
          <p className="text-sm font-medium text-foreground">{t("state.errorTitle")}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={() => void newsQuery.refetch()}
          >
            {t("state.retry")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        // Câu rỗng RIÊNG của màn tin tức (C12) — khác bảng tin, khác đã lưu.
        <div
          data-testid="news-empty"
          className={cn("rounded-lg border border-dashed border-border p-8 text-center")}
        >
          <p className="text-sm text-foreground">{t("empty.news")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-testid="news-list">
          {items.map((item) => (
            <NewsRow key={item.id} item={item} />
          ))}
          {newsQuery.hasNextPage && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void newsQuery.fetchNextPage()}
              disabled={newsQuery.isFetchingNextPage}
            >
              {t("state.loadMore")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
