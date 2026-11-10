/**
 * S16-SOCIAL-FEMODINVAL-1 + S16-SOCIAL-FESTALELISTS-1 — MỘT nguồn cho tập khoá cache «mọi bề mặt đang
 * vẽ bài». Trước đây bốn nơi tự chép tay (menu ⋯ của thẻ bài · màn Kiểm duyệt · hộp thoại xét duyệt sáng
 * kiến · huy hiệu qua màn Kiểm duyệt) và hai trong số đó thiếu khoá — mỗi lần nối thêm một bề mặt là một
 * lần có nơi quên.
 *
 * Người dùng:
 *  · `feed/lib/use-feed-actions.ts`   — thích · lưu · ẩn · khoá · xoá (menu ⋯), `moderation: "queues"` cho ẩn/xoá;
 *  · `moderation/lib/moderation-invalidation.ts` — `invalidatePostSurfaces` (kiểm duyệt, «Hiện lại», huy hiệu);
 *  · `ideas/IdeaReviewDialog.tsx`     — xét duyệt sáng kiến.
 *
 * ⚠️ ĐÍCH DANH, không `invalidateQueries()` trần (làm mới cả sinh nhật · catalog huy hiệu mỗi lần bấm «thích»).
 * Tiền tố `search` / `profile-posts` CẮT từ chính hàm khoá của web-core (đổi tên khoá thì tiền tố đổi theo);
 * `socialKeys.search()` trần KHÔNG khớp `[…,"search",{q}]` vì phần tử thứ ba là `undefined`.
 * Chi tiết / bình luận của MỘT bài do nơi gọi tự làm mới (chỉ nơi gọi biết id bài) — hoặc truyền `postId`.
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { socialKeys } from "@mediaos/web-core";

/** Tiền tố MỌI danh sách `025` (trang cá nhân đồng nghiệp, mọi `employeeId`). Không nằm dưới `feed.allOf()`. */
const PROFILE_POSTS_PREFIX = socialKeys.profilePosts("").slice(0, socialKeys.all.length + 1);
/** Tiền tố MỌI kết quả tìm kiếm `023` (mọi `q`). Không nằm dưới `feed.allOf()`. */
const SEARCH_PREFIX = socialKeys.search().slice(0, socialKeys.all.length + 1);

/**
 * Mức làm mới thêm của hàng đợi kiểm duyệt:
 *  · `"none"`   — thích · lưu · xét duyệt sáng kiến: không đổi gì ở hàng đợi;
 *  · `"hidden"` — chỉ tab «Bài đang ẩn» (màn Kiểm duyệt, «Hiện lại», đổi tên/biểu tượng huy hiệu);
 *  · `"queues"` — thêm hàng đợi báo cáo: ẩn / xoá từ menu ⋯ làm báo cáo về bài đó đổi nghĩa.
 */
export type ModerationRefresh = "none" | "hidden" | "queues";

/** Mọi danh sách đang vẽ bài. `kudos.lists()` chứ không `allOf()`: catalog huy hiệu không đổi theo bài. */
export function postListKeys(moderation: ModerationRefresh = "none"): readonly QueryKey[] {
  const base: QueryKey[] = [
    socialKeys.feed.allOf(),
    socialKeys.saved(),
    socialKeys.news.allOf(),
    socialKeys.polls.allOf(),
    socialKeys.ideas.allOf(),
    socialKeys.kudos.lists(),
    PROFILE_POSTS_PREFIX,
    SEARCH_PREFIX,
  ];
  if (moderation === "none") return base;
  const hidden = [...base, socialKeys.moderation.hiddenPosts()];
  return moderation === "hidden" ? hidden : [...hidden, socialKeys.moderation.reports.lists()];
}

export interface InvalidatePostListsOptions {
  moderation?: ModerationRefresh;
  /** Có ⇒ làm mới thêm chi tiết của đúng bài đó. */
  postId?: string;
}

export function invalidatePostLists(
  queryClient: QueryClient,
  { moderation = "none", postId }: InvalidatePostListsOptions = {},
): void {
  const keys =
    postId === undefined
      ? postListKeys(moderation)
      : [...postListKeys(moderation), socialKeys.posts.detail(postId)];
  keys.forEach((queryKey) => {
    void queryClient.invalidateQueries({ queryKey });
  });
}
