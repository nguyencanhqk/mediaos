/**
 * S16-SOCIAL-FE-1 — `SOC-SCREEN-004` Đã lưu (SOCIAL-API-010).
 *
 * `GET /social/saved` chỉ trả bài của CHÍNH actor (server ép, không có tham số nào chọn người khác)
 * và **không có bộ lọc** nào ngoài phân trang — nên màn này không có dải lọc, đúng như hợp đồng.
 *
 * Câu rỗng ở đây phải KHÁC câu của Bảng tin (ca C12): «bạn chưa lưu bài nào» + gợi ý cách lưu, chứ
 * không phải «chưa có bài nào trên bảng tin» — hai tình huống khác hẳn nhau.
 */
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { socialApi, socialKeys } from "@mediaos/web-core";
import type { FeedPostDto } from "@mediaos/contracts";
import { ActionErrorBanner } from "./components/ActionErrorBanner";
import { FeedPostList } from "./components/FeedPostList";
import { buildPostMenuActions, useFeedActions } from "./lib/use-feed-actions";

export function SavedPage(): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  const actions = useFeedActions();

  const savedQuery = useInfiniteQuery({
    queryKey: socialKeys.saved(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => socialApi.listSaved({ cursor: pageParam, limit: 20 }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const posts: FeedPostDto[] = React.useMemo(
    () => (savedQuery.data?.pages ?? []).flatMap((p) => p.data),
    [savedQuery.data],
  );

  // Sáu hành động của menu ⋯ dựng bằng helper DÙNG CHUNG — bốn màn cùng một luật, một chỗ sửa.
  const buildMenuActions = (post: FeedPostDto) =>
    buildPostMenuActions(post, {
      actions,
      openDetail: (postId) => void navigate({ to: "/feed/posts/$postId", params: { postId } }),
    });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("saved.title")}</h1>

      {/*
        🔴 Màn này là chỗ người dùng BỎ LƯU nhiều nhất. Không render `actionError` thì một lượt bỏ
        lưu hỏng sẽ im lặng tuyệt đối: bài vẫn nằm đó và họ tưởng mình bấm hụt.
      */}
      {actions.actionError && (
        <ActionErrorBanner
          kind={actions.actionError.kind}
          forbidden={actions.actionError.forbidden}
          onDismiss={actions.clearActionError}
        />
      )}

      <FeedPostList
        posts={posts}
        isLoading={savedQuery.isLoading}
        isError={savedQuery.isError}
        onRetry={() => void savedQuery.refetch()}
        emptyText={t("empty.saved")}
        emptyHint={t("empty.savedHint")}
        hasNextPage={savedQuery.hasNextPage}
        isFetchingNextPage={savedQuery.isFetchingNextPage}
        onLoadMore={() => void savedQuery.fetchNextPage()}
        actions={actions}
        buildMenuActions={buildMenuActions}
      />
    </div>
  );
}
