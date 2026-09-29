/**
 * S16-SOCIAL-FE-2B — tab «Bài viết» của trang nhóm = feed `001 ?groupId` + ô soạn `audience='group'`
 * (plan D9/D10 + §8 M1/M3).
 *
 * Ba trạng thái, KHÔNG gộp:
 *  - `canReadPosts` (public, hoặc thành viên active) ⇒ feed; ô soạn chỉ khi `canPost` (active);
 *  - `isManageViewer` (manage nhìn nhóm KÍN mình không thuộc) ⇒ khối riêng, **KHÔNG gọi `001`**:
 *    server trả 200 RỖNG ở đây (manage không nới đọc bài), nên «Nhóm chưa có bài» sẽ là câu SAI;
 *  - còn lại ⇒ không feed (không tới được thực tế: nhóm kín không thuộc thì `032` đã 404).
 *
 * 🔴 KHÔNG `useFeedRealtime`, KHÔNG `NewFeedPostsBadge` (done_when #3): WS chỉ có room CÔNG TY
 * (`wsFeedPostCreatedEventSchema.audience = literal('company')`, `emitPostCreated` bỏ bài nhóm) — gắn
 * vào đây là badge đếm bài CÔNG TY trong trang nhóm. Badge theo nhóm chờ `S16-SOCIAL-BE-2C`.
 *
 * Khoá query và lời gọi dùng CÙNG một object `{groupId, sort}` (plan §8 M1 — `sort:'newest'` từng lọt
 * vào plan dù API chỉ nhận `active|latest`). Khoá nằm dưới `feed.allOf()` ⇒ đăng/xoá/ẩn bài tự làm mới.
 */
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { socialApi, socialKeys } from "@mediaos/web-core";
import type { FeedGroupDto, FeedPostDto } from "@mediaos/contracts";
import { ActionErrorBanner } from "../../feed/components/ActionErrorBanner";
import { CreatePostNotices } from "../../feed/components/CreatePostNotices";
import { FeedComposer } from "../../feed/components/FeedComposer";
import { FeedPostList } from "../../feed/components/FeedPostList";
import { useCreatePost } from "../../feed/lib/use-create-post";
import { buildPostMenuActions, useFeedActions } from "../../feed/lib/use-feed-actions";
import type { GroupCapabilities } from "../lib/group-capabilities";

interface GroupPostsTabProps {
  group: FeedGroupDto;
  caps: GroupCapabilities;
}

const GROUP_FEED_PAGE = 20;

export function GroupPostsTab({ group, caps }: GroupPostsTabProps): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  const actions = useFeedActions();
  const createPost = useCreatePost({ groupId: group.id });

  const feedParams = React.useMemo(() => ({ groupId: group.id, sort: "latest" as const }), [group.id]);
  const feedQuery = useInfiniteQuery({
    queryKey: socialKeys.feed.list(feedParams),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      socialApi.listFeed({ ...feedParams, cursor: pageParam, limit: GROUP_FEED_PAGE }),
    enabled: caps.canReadPosts,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const posts: FeedPostDto[] = React.useMemo(
    () => (feedQuery.data?.pages ?? []).flatMap((p) => p.data),
    [feedQuery.data],
  );

  if (caps.isManageViewer) {
    return (
      <div
        role="status"
        data-testid="group-manage-viewer"
        className="flex items-start gap-2 rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground"
      >
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {t("groups.page.manageViewer")}
      </div>
    );
  }

  if (!caps.canReadPosts) return <></>;

  const buildMenuActions = (post: FeedPostDto) =>
    buildPostMenuActions(post, {
      actions,
      openDetail: (postId) => void navigate({ to: "/feed/posts/$postId", params: { postId } }),
    });

  return (
    <div className="flex flex-col gap-4" data-testid="group-posts">
      {actions.actionError && (
        <ActionErrorBanner
          kind={actions.actionError.kind}
          forbidden={actions.actionError.forbidden}
          onDismiss={actions.clearActionError}
        />
      )}
      <CreatePostNotices
        postError={createPost.postError}
        clearPostError={createPost.clearPostError}
        droppedMentionCount={createPost.droppedMentionCount}
        clearDroppedMentions={createPost.clearDroppedMentions}
      />

      {caps.canPost ? (
        <FeedComposer groupId={group.id} onSubmit={createPost.submit} isSubmitting={createPost.isPending} />
      ) : (
        <p data-testid="group-join-to-post" className="text-sm text-muted-foreground">
          {t("groups.actions.publicNonMemberHint")}
        </p>
      )}

      <FeedPostList
        posts={posts}
        isLoading={feedQuery.isLoading}
        isError={feedQuery.isError}
        onRetry={() => void feedQuery.refetch()}
        emptyText={caps.canPost ? t("groups.page.emptyPostsCanPost") : t("groups.page.emptyPosts")}
        hasNextPage={feedQuery.hasNextPage}
        isFetchingNextPage={feedQuery.isFetchingNextPage}
        onLoadMore={() => void feedQuery.fetchNextPage()}
        actions={actions}
        buildMenuActions={buildMenuActions}
      />
    </div>
  );
}
