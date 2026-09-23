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
 *
 * H7/H1 (23/09/2026): bản đầu gọi 022 KHÔNG kèm `state` ⇒ `.default("acked")` của contracts khiến nửa
 * «chưa đọc» không bao giờ hỏi được — lý do của cổng `manage:feed-news` ở trên trở thành một phép đo
 * KHÔNG THOẢ ĐƯỢC, và trang offset (`total`) bị bỏ nên danh sách cắt im lặng ở người thứ 51. Nay panel
 * có hai tab + mẫu số toàn audience; nửa «chưa đọc» nằm sau ĐÚNG cổng cũ, không thêm cặp quyền nào.
 * Mutation 021 có `onError` — xem hộp trong `components/ActionErrorBanner.tsx` về "câm tuyệt đối".
 */
import * as React from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Avatar, Button, Skeleton, cn } from "@mediaos/ui";
import { ApiError, PermissionGate, socialApi, socialKeys, useCan } from "@mediaos/web-core";
import type { FeedAckPersonDto, FeedNewsItemDto } from "@mediaos/contracts";
import { PostBody } from "./components/PostBody";
import { ActionErrorBanner } from "./components/ActionErrorBanner";
import { authorDisplayName, relativeTime } from "./lib/feed-format";

/**
 * Hai NỬA của 022 — tên phải trùng `listPostAcksQuerySchema.state` của contracts.
 *
 * ⚠️ `state` ở contracts có `.default("acked")`: KHÔNG gửi tham số này thì server im lặng trả nửa
 * đã-đọc. Đó chính là cách màn hình cũ làm cho nhánh «Chưa đọc» không bao giờ tới được — mọi lời gọi
 * 022 từ file này vì vậy PHẢI khai `state` tường minh, kể cả khi đang muốn đúng giá trị mặc định.
 */
const ACK_STATES = ["acked", "unacked"] as const;
type AckState = (typeof ACK_STATES)[number];

const READERS_PAGE_SIZE = 50;
/**
 * Lời gọi ĐẾM nửa còn lại chỉ cần con số `total`. `limit: 1` để không kéo về 50 danh tính chỉ để
 * lấy một mẫu số — 022 là đường chiếu danh tính, đừng lấy nhiều hơn mức cần.
 */
const READERS_COUNT_PROBE_LIMIT = 1;

const tabLabelKey: Record<AckState, string> = {
  acked: "news.readersRead",
  unacked: "news.readersUnread",
};

function readerKey(p: FeedAckPersonDto, index: number): string {
  return p.employeeId ?? `${p.fullName ?? "?"}#${index}`;
}

/**
 * Bảng người đã/chưa đọc của MỘT tin (022) — chỉ mở khi có `manage:feed-news`.
 *
 * ┌─ VÌ SAO CÓ HAI TAB VÀ MỘT CON SỐ ───────────────────────────────────────────────────────────┐
 * │ HR mở màn này để biết «đã phổ biến xong chưa». Một danh sách 12 người toàn nhãn «Đã đọc» trả  │
 * │ lời câu đó SAI khi 200 người còn lại chưa đọc mà không có đường nào hiện ra. Nên: nửa «chưa    │
 * │ đọc» phải HỎI ĐƯỢC (tab), và mẫu số phải là TOÀN BỘ audience (`readersCount`).                 │
 * │ `total` của 022 là tổng của NỬA đang hỏi — muốn mẫu số audience thì phải cộng cả hai nửa, nên  │
 * │ mới có lời gọi đếm thứ hai.                                                                    │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
function NewsReaders({ postId }: { postId: string }): React.ReactElement {
  const { t } = useTranslation(["social", "common"]);
  const [state, setState] = React.useState<AckState>("acked");
  const otherState: AckState = state === "acked" ? "unacked" : "acked";

  const listQuery = useInfiniteQuery({
    queryKey: socialKeys.posts.acks(postId, { state }),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      socialApi.listPostAcks(postId, { state, page: pageParam, limit: READERS_PAGE_SIZE }),
    // Trang OFFSET, nên mốc "hết" là `total` chứ không phải một con trỏ. Đếm theo SỐ HÀNG ĐÃ TẢI
    // (không phải `page * limit`): server có quyền trả ít hơn `limit`, và khi đó công thức nhân sẽ
    // kết luận "hết" trong lúc vẫn còn người — đúng kiểu cắt im lặng đang phải vá.
    getNextPageParam: (last, all) => {
      if (last.data.length === 0) return undefined;
      const loaded = all.reduce((n, p) => n + p.data.length, 0);
      return loaded < last.total ? all.length + 1 : undefined;
    },
  });

  /** Chỉ lấy `total` của nửa KHÔNG hiển thị — xem hộp trên về mẫu số. */
  const otherTotalQuery = useQuery({
    queryKey: socialKeys.posts.acks(postId, { state: otherState, countOnly: true }),
    queryFn: () =>
      socialApi.listPostAcks(postId, {
        state: otherState,
        page: 1,
        limit: READERS_COUNT_PROBE_LIMIT,
      }),
    select: (p) => p.total,
  });

  const pages = listQuery.data?.pages ?? [];
  const people = pages.flatMap((p) => p.data);
  const currentTotal = pages[0]?.total;
  const otherTotal = otherTotalQuery.data;
  // Chỉ nói con số khi biết CẢ HAI nửa. Một mẫu số thiếu còn nguy hiểm hơn không có mẫu số nào.
  const counts =
    currentTotal != null && otherTotal != null
      ? {
          read: state === "acked" ? currentTotal : otherTotal,
          audience: currentTotal + otherTotal,
        }
      : null;

  return (
    <div data-testid="news-readers" className="flex flex-col gap-2">
      <div
        role="tablist"
        aria-label={t("news.readersTitle")}
        className="flex gap-1 rounded-md bg-muted p-0.5"
      >
        {ACK_STATES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={state === s}
            data-testid={`news-readers-tab-${s}`}
            onClick={() => setState(s)}
            className={cn(
              "rounded px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              state === s
                ? "bg-card font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(tabLabelKey[s])}
          </button>
        ))}
      </div>

      {counts && (
        <p className="text-xs text-muted-foreground" data-testid="news-readers-count">
          {t("news.readersCount", { read: counts.read, total: counts.audience })}
        </p>
      )}

      <NewsReadersBody
        state={state}
        people={people}
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        onRetry={() => void listQuery.refetch()}
      />

      {listQuery.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          data-testid="news-readers-more"
          onClick={() => void listQuery.fetchNextPage()}
          disabled={listQuery.isFetchingNextPage}
        >
          {listQuery.isFetchingNextPage ? t("state.loadingMore") : t("state.loadMore")}
        </Button>
      )}
    </div>
  );
}

interface NewsReadersBodyProps {
  state: AckState;
  people: FeedAckPersonDto[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

/** Ba nhánh loading/lỗi/rỗng của panel 022 — tách ra để `NewsReaders` chỉ lo dữ liệu. */
function NewsReadersBody({
  state,
  people,
  isLoading,
  isError,
  onRetry,
}: NewsReadersBodyProps): React.ReactElement {
  const { t } = useTranslation(["social", "common"]);

  if (isLoading) return <Skeleton className="h-16 w-full" data-testid="news-readers-loading" />;

  if (isError) {
    return (
      <div role="alert" data-testid="news-readers-error" className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground">{t("state.errorBody")}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("state.retry")}
        </Button>
      </div>
    );
  }

  if (people.length === 0) {
    // Hai nửa có hai nghĩa NGƯỢC nhau khi rỗng: «chưa ai xác nhận» vs «không còn ai chưa đọc».
    // Dùng chung một câu là tái lập đúng lỗi nhãn-nói-dối đang phải vá.
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="news-readers-empty"
        data-state={state}
      >
        {/* Hai câu KHÁC NHAU có chủ đích: rỗng ở nửa «đã đọc» = chưa ai đọc (đáng lo), rỗng ở nửa
            «chưa đọc» = mọi người đã đọc (tin mừng). Dùng chung một câu là nói sai một nửa. */}
        {state === "acked" ? t("news.readersEmpty") : t("news.readersAllRead")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1" data-testid="news-readers-list">
      {people.map((p, i) => (
        <li key={readerKey(p, i)} className="flex items-center gap-2 text-sm">
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
  const [ackError, setAckError] = React.useState<{ forbidden: boolean } | null>(null);

  const ackMutation = useMutation({
    mutationFn: () => socialApi.ackPost(item.id),
    onMutate: () => setAckError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: socialKeys.news.allOf() });
    },
    // 🔴 KHÔNG được bỏ nhánh này. Không có toast, không có `MutationCache.onError` — thiếu `onError`
    // thì 021 hỏng là câm tuyệt đối: nút nhả ra, nhãn về như cũ, người dùng đóng tab tin rằng đã xác
    // nhận. `feed_post_acks` append-only, không có đường sửa tay, nên cái thiếu đó là VĨNH VIỄN.
    onError: (err: unknown) =>
      setAckError({ forbidden: err instanceof ApiError && err.status === 403 }),
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

      {ackError && (
        <ActionErrorBanner
          kind="ack"
          forbidden={ackError.forbidden}
          onDismiss={() => setAckError(null)}
          className="mt-3"
        />
      )}

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
