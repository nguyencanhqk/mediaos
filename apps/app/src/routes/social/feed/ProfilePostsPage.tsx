/**
 * S16-SOCIAL-FE-1 — `SOC-SCREEN-005` Trang cá nhân (SOCIAL-API-025).
 *
 * Phục vụ HAI route, cố ý dùng chung MỘT component:
 *  - `/feed/profiles/$employeeId` — bài của một đồng nghiệp;
 *  - `/feed/profiles/me`          — bài của CHÍNH mình (route TĨNH, xem dưới).
 *
 * ┌─ 🔴 VÌ SAO `/feed/profiles/me` PHẢI LÀ ROUTE TĨNH RIÊNG (plan W5, finding #2) ────────────────┐
 * │ Mục sidebar ME «Bài viết của tôi» cần một `path` CỐ ĐỊNH. Ba sự thật đóng mọi cửa khác:        │
 * │  (a) `SidebarItemMeta` không có `onClick` ⇒ không giải được placeholder lúc bấm;               │
 * │  (b) `ME_SIDEBAR` **KHÔNG** đi qua `pruneUnbuiltScreens` (đặc quyền của PAYROLL/SOCIAL) ⇒ mục  │
 * │      trỏ vào đường không tồn tại sẽ KHÔNG tự ẩn — nó thành link chết 404 hiện với mọi người;   │
 * │  (c) `"me"` không phải UUID nên không lọt được nhánh `$employeeId`.                            │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ `employeeId` của CHÍNH mình KHÔNG có trong auth store (`user` chỉ có `{id, companyId, email,
 * fullName, status}` — `id` là **userId**, không phải `employeeId`). Vì vậy nhánh `me` gọi
 * `listFeed({ authorUserId })` thay vì `listProfilePosts(employeeId)`: cùng một danh sách, nhưng hỏi
 * bằng khoá mà FE thật sự có. Đoán `employeeId === userId` là một lỗi im lặng trả về danh sách rỗng.
 */
import * as React from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { socialApi, socialKeys, useAuthStore } from "@mediaos/web-core";
import type { FeedPostDto } from "@mediaos/contracts";
import { ActionErrorBanner } from "./components/ActionErrorBanner";
import { FeedPostList } from "./components/FeedPostList";
import { buildPostMenuActions, useFeedActions } from "./lib/use-feed-actions";

interface ProfilePostsPageProps {
  /** `true` cho route tĩnh `/feed/profiles/me`. */
  isMe?: boolean;
}

export function ProfilePostsPage({ isMe = false }: ProfilePostsPageProps): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  const actions = useFeedActions();
  const params = useParams({ strict: false }) as { employeeId?: string };
  const myUserId = useAuthStore((s) => s.user?.id ?? null);

  const employeeId = isMe ? undefined : params.employeeId;

  const profileQuery = useInfiniteQuery({
    queryKey: isMe
      ? socialKeys.feed.list({ authorUserId: myUserId ?? "me" })
      : socialKeys.profilePosts(employeeId ?? ""),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      isMe
        ? socialApi.listFeed({
            ...(myUserId ? { authorUserId: myUserId } : {}),
            cursor: pageParam,
            limit: 20,
          })
        : socialApi.listProfilePosts(employeeId!, { cursor: pageParam, limit: 20 }),
    // Chưa biết mình là ai / chưa có id đồng nghiệp ⇒ đừng gọi: một request thiếu khoá chỉ trả về
    // danh sách của người khác hoặc 400, cả hai đều tệ hơn là chờ.
    enabled: isMe ? myUserId !== null : Boolean(employeeId),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const posts: FeedPostDto[] = React.useMemo(
    () => (profileQuery.data?.pages ?? []).flatMap((p) => p.data),
    [profileQuery.data],
  );

  /**
   * Tiêu đề: tên lấy từ chính bài ĐẦU TIÊN trong danh sách — FE không có endpoint hồ sơ ở WO này, và
   * `feedAuthorSchema` đã chở `fullName`. Danh sách rỗng ⇒ nhãn chung chung, KHÔNG in `employeeId`
   * ra màn hình (phơi id là đúng thứ `feedAuthorSchema` cố ý tránh khi không trả `userId`).
   */
  const title = isMe
    ? t("profile.titleMine")
    : posts[0]?.author.fullName
      ? t("profile.titleOther", { name: posts[0].author.fullName })
      : t("profile.titleUnknown");

  // Sáu hành động của menu ⋯ dựng bằng helper DÙNG CHUNG — bốn màn cùng một luật, một chỗ sửa.
  const buildMenuActions = (post: FeedPostDto) =>
    buildPostMenuActions(post, {
      actions,
      openDetail: (postId) => void navigate({ to: "/feed/posts/$postId", params: { postId } }),
    });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground" data-testid="profile-title">
        {title}
      </h1>

      {/* Cùng luật với Bảng tin/Đã lưu: hành động ghi hỏng PHẢI phát ra tín hiệu, không im lặng. */}
      {actions.actionError && (
        <ActionErrorBanner
          kind={actions.actionError.kind}
          forbidden={actions.actionError.forbidden}
          onDismiss={actions.clearActionError}
        />
      )}

      <FeedPostList
        posts={posts}
        isLoading={profileQuery.isLoading}
        isError={profileQuery.isError}
        onRetry={() => void profileQuery.refetch()}
        emptyText={isMe ? t("empty.profileMine") : t("empty.profile")}
        hasNextPage={profileQuery.hasNextPage}
        isFetchingNextPage={profileQuery.isFetchingNextPage}
        onLoadMore={() => void profileQuery.fetchNextPage()}
        actions={actions}
        buildMenuActions={buildMenuActions}
      />
    </div>
  );
}
