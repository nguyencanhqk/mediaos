/**
 * S16-SOCIAL-FE-1 — các hành động dùng chung trên MỘT bài (cảm xúc · lưu · kiểm duyệt · xoá).
 *
 * Tách ra vì cả 5 màn đều cần đúng bộ này; để mỗi màn tự viết là năm bản sao của cùng một luật
 * invalidate, và bốn trong số đó sẽ trôi.
 *
 * ⚠️ **Invalidate ĐÍCH DANH, không `invalidateQueries()` trần.** Gọi trần sẽ làm mới cả widget sinh
 * nhật, cả tin nổi bật, cả danh sách của màn khác đang nằm trong cache — mỗi lần ai đó bấm «thích».
 */
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { socialApi, socialKeys } from "@mediaos/web-core";
import type {
  FeedPostDto,
  FeedReactionEmojiDto,
  FeedReactionSummaryDto,
} from "@mediaos/contracts";
import type { PostCardMenuActions } from "../components/PostCardMenu";

export interface FeedActions {
  /**
   * Bảng tổng hợp cảm xúc THEO BÀI, tích luỹ từ phản hồi của `011/012`.
   *
   * Sống trong state của hook chứ không trong cache React Query: nó là dữ liệu PHỤ của một mutation,
   * không phải một truy vấn có khoá riêng. Nhét vào cache sẽ đẻ ra một entry mà không query nào đọc.
   */
  reactionSummaries: Record<string, readonly FeedReactionSummaryDto[]>;
  setReaction: (postId: string, emoji: FeedReactionEmojiDto | null) => void;
  toggleSave: (postId: string, currentlySaved: boolean) => void;
  moderate: (
    postId: string,
    patch: { hidden?: boolean; locked?: boolean; pinned?: boolean },
  ) => void;
  remove: (postId: string) => void;
  pendingReactionPostId: string | null;
  pendingSavePostId: string | null;
}

export function useFeedActions(): FeedActions {
  const queryClient = useQueryClient();
  const [reactionSummaries, setReactionSummaries] = React.useState<
    Record<string, readonly FeedReactionSummaryDto[]>
  >({});

  /** Làm mới đúng hai nhánh mà một thay đổi trên bài có thể ảnh hưởng. */
  const invalidatePostLists = (postId?: string): void => {
    void queryClient.invalidateQueries({ queryKey: socialKeys.feed.allOf() });
    void queryClient.invalidateQueries({ queryKey: socialKeys.saved() });
    if (postId) {
      void queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(postId) });
    }
  };

  const reactionMutation = useMutation({
    mutationFn: ({ postId, emoji }: { postId: string; emoji: FeedReactionEmojiDto | null }) =>
      emoji === null
        ? socialApi.deletePostReaction(postId)
        : socialApi.putPostReaction(postId, emoji),
    onSuccess: (result) => {
      // Dùng NGUYÊN mảng server trả về làm nguồn sự thật, không tự cộng trừ từng số.
      setReactionSummaries((prev) => ({ ...prev, [result.targetId]: result.reactions }));
      invalidatePostLists(result.targetId);
    },
  });

  const saveMutation = useMutation({
    mutationFn: ({ postId, currentlySaved }: { postId: string; currentlySaved: boolean }) =>
      currentlySaved ? socialApi.unsavePost(postId) : socialApi.savePost(postId),
    onSuccess: (result) => invalidatePostLists(result.postId),
  });

  const moderateMutation = useMutation({
    mutationFn: ({
      postId,
      patch,
    }: {
      postId: string;
      patch: { hidden?: boolean; locked?: boolean; pinned?: boolean };
    }) =>
      socialApi.moderatePost(postId, {
        ...(patch.hidden !== undefined ? { status: patch.hidden ? "hidden" : "published" } : {}),
        ...(patch.locked !== undefined ? { commentsLocked: patch.locked } : {}),
        ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      } as Parameters<typeof socialApi.moderatePost>[1]),
    onSuccess: (post) => invalidatePostLists(post.id),
  });

  const deleteMutation = useMutation({
    mutationFn: (postId: string) => socialApi.deletePost(postId),
    onSuccess: () => invalidatePostLists(),
  });

  return {
    reactionSummaries,
    setReaction: (postId, emoji) => reactionMutation.mutate({ postId, emoji }),
    toggleSave: (postId, currentlySaved) => saveMutation.mutate({ postId, currentlySaved }),
    moderate: (postId, patch) => moderateMutation.mutate({ postId, patch }),
    remove: (postId) => deleteMutation.mutate(postId),
    pendingReactionPostId: reactionMutation.isPending
      ? (reactionMutation.variables?.postId ?? null)
      : null,
    pendingSavePostId: saveMutation.isPending ? (saveMutation.variables?.postId ?? null) : null,
  };
}

/**
 * Dựng bộ hành động cho menu ⋯ của MỘT bài.
 *
 * ┌─ VÌ SAO LÀ MỘT HÀM DÙNG CHUNG, KHÔNG PHẢI SÁU ARROW LẶP LẠI Ở MỖI MÀN ──────────────────────┐
 * │ Bốn màn (`FeedPage` · `SavedPage` · `ProfilePostsPage` · `PostDetailPage`) đều render cùng   │
 * │ `PostCard` nên đều cần đúng sáu hành động này. Bản đầu của WO chép chúng vào từng màn — bốn   │
 * │ bản sao của cùng một luật, và ba trong số đó chắc chắn sẽ trôi khi luật đổi (ví dụ khi         │
 * │ «Báo cáo» của FE-3 được thêm vào menu).                                                       │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ `onToggleHidden` đọc `post.status` — trường **OPTIONAL**, chỉ có mặt với tác giả hoặc người có
 * `manage:feed-post`. Với người đọc thường nó `undefined` ⇒ `!== "hidden"` ⇒ "ẩn bài". Điều đó KHÔNG
 * nguy hiểm vì mục menu tương ứng cũng chỉ hiện cho người có `manage:feed-post` (xem `PostCardMenu`),
 * nhưng đừng suy ra rằng `status` luôn có — dùng nó ở chỗ khác mà quên là một lỗi im lặng.
 */
export function buildPostMenuActions(
  post: Pick<FeedPostDto, "id" | "status" | "commentsLocked" | "pinned">,
  deps: {
    actions: Pick<FeedActions, "moderate" | "remove">;
    /** Mở màn chi tiết (chỗ sửa bài). `undefined` ⇒ đang Ở chính màn đó. */
    openDetail?: (postId: string) => void;
    /** Sau khi xoá. `undefined` ⇒ ở lại (danh sách tự refetch). */
    afterDelete?: () => void;
  },
): PostCardMenuActions {
  return {
    onCopyLink: () => {
      // `?.` vì `navigator.clipboard` KHÔNG tồn tại trên http không phải localhost (và trong jsdom).
      // Sao chép link hỏng không được phép làm chết cả menu.
      void navigator.clipboard?.writeText(`${window.location.origin}/feed/posts/${post.id}`);
    },
    onEdit: () => deps.openDetail?.(post.id),
    onDelete: () => {
      deps.actions.remove(post.id);
      deps.afterDelete?.();
    },
    onToggleHidden: () => deps.actions.moderate(post.id, { hidden: post.status !== "hidden" }),
    onToggleComments: () => deps.actions.moderate(post.id, { locked: !post.commentsLocked }),
    onTogglePinned: () => deps.actions.moderate(post.id, { pinned: !post.pinned }),
  };
}
