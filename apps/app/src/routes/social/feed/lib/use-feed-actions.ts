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
import { ApiError, socialApi, socialKeys } from "@mediaos/web-core";
import type {
  FeedPostDto,
  FeedReactionEmojiDto,
  FeedReactionSummaryDto,
  ModerateFeedPostDto,
} from "@mediaos/contracts";
import type { PostCardMenuActions } from "../components/PostCardMenu";
import type { ActionErrorReason } from "../components/ActionErrorBanner";
import { postActionErrorReason } from "./feed-errors";

/**
 * Hành động nào vừa hỏng. Dùng để chọn CÂU nói với người dùng — «không ghim được bài» khác hẳn
 * «không thả được cảm xúc», và một câu chung chung («Đã xảy ra lỗi») thì không giúp họ quyết định
 * làm gì tiếp.
 */
export type FeedActionKind = "reaction" | "save" | "moderate" | "delete";

/**
 * Tiền tố MỌI danh sách `025` (trang cá nhân ĐỒNG NGHIỆP, mọi `employeeId`) = `["social","profile-posts"]`.
 *
 * Nhánh này KHÔNG nằm dưới `feed.allOf()` (chỉ `/feed/profiles/me` đi `feed.list`), và web-core chưa có
 * `allOf` cho nó ⇒ CẮT từ chính `socialKeys.profilePosts` thay vì chép literal: đổi tên khoá ở web-core
 * thì tiền tố đổi theo, không trôi im lặng. Review LIGHT 02/10/2026 (FEMODERRMSG-1): thiếu nó thì bài bị
 * xoá/ẩn vẫn nằm trên trang đồng nghiệp — cả sau lượt kiểm duyệt THÀNH CÔNG lẫn sau 404 «postGone».
 */
const PROFILE_POSTS_PREFIX = socialKeys.profilePosts("").slice(0, socialKeys.all.length + 1);

/**
 * Tiền tố MỌI kết quả tìm kiếm `023` (mọi `q`) = `["social","search"]` — `/feed?q=…` đọc
 * `socialKeys.search({q})`, KHÔNG nằm dưới `feed.allOf()`. Cắt từ chính `socialKeys.search` như
 * `PROFILE_POSTS_PREFIX`; KHÔNG dùng `socialKeys.search()` trần: `[…,"search",undefined]` không khớp một
 * phần `[…,"search",{q}]` (cùng lý do `socialKeys.groups.lists()`). Review LIGHT 03/10/2026
 * (FEMODERRMSG-1, LOW): thiếu nó thì ở chế độ tìm kiếm, thẻ của bài đã mất vẫn nằm trên màn trong khi
 * dải «postGone» nói dữ liệu đã được tải lại.
 */
const SEARCH_PREFIX = socialKeys.search().slice(0, socialKeys.all.length + 1);

export interface FeedActionError {
  kind: FeedActionKind;
  /**
   * 403. Tách riêng vì hai ca này đòi hai hành vi khác nhau của người dùng: mất quyền thì thử lại
   * bao nhiêu lần cũng vô ích (đi hỏi quản trị), còn lỗi mạng/500 thì thử lại là đúng.
   */
  forbidden: boolean;
  /**
   * S16-SOCIAL-FEMODERRMSG-1 — lý do CỤ THỂ đọc từ `error.code` (`postActionErrorReason`); thắng
   * `forbidden` ở banner. `null` ⇒ câu forbidden/generic. Hôm nay chỉ có `"postGone"` (404
   * `SOCIAL-ERR-001`): bài đã bị xoá/ẩn giữa chừng — «vui lòng thử lại» ở đây là lời khuyên sai.
   */
  reason: ActionErrorReason | null;
}

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
  /**
   * `patch` CHÍNH LÀ body `006` (`ModerateFeedPostDto`), đi thẳng xuống API — KHÔNG có lớp ánh xạ.
   *
   * Bản đầu nhận `{hidden, locked, pinned}` rồi dịch `hidden` → `{status:"hidden"|"published"}` và
   * ép kiểu `as` cho qua; `006` là `.strict()` nên MỌI lượt ẩn/bỏ ẩn đều 400 (`S16-SOCIAL-FEMODPAYLOAD-1`,
   * đo thật 30/09/2026). Nhận đúng kiểu hợp đồng thì literal ở chỗ gọi được kiểm excess-property:
   * một khoá lạ là lỗi `tsc`, không phải lỗi người kiểm duyệt gặp trên PROD.
   *
   * Chỉ đưa trường THỰC SỰ đổi: `pinned` gác cặp riêng (`manage:feed-news`) ở tầng 2, kèm thừa nó là 403.
   */
  moderate: (postId: string, patch: ModerateFeedPostDto) => void;
  /**
   * `onDone` chạy trong `onSuccess` của mutation, KHÔNG chạy ngay sau khi gọi. Ca hỏng mà chữ ký này
   * sinh ra để chặn: màn chi tiết truyền `() => navigate({to:"/feed"})`; gọi nó cạnh `mutate()` sẽ
   * đá người dùng về bảng tin TRƯỚC khi biết xoá được hay không, và khi server trả 403 thì bài vẫn
   * còn nguyên trong khi người dùng tin là đã xoá xong.
   */
  remove: (postId: string, onDone?: () => void) => void;
  pendingReactionPostId: string | null;
  pendingSavePostId: string | null;
  /** Hành động ghi gần nhất bị hỏng; `null` = chưa có lỗi nào. Màn PHẢI render nó ra. */
  actionError: FeedActionError | null;
  clearActionError: () => void;
}

export function useFeedActions(): FeedActions {
  const queryClient = useQueryClient();
  const [reactionSummaries, setReactionSummaries] = React.useState<
    Record<string, readonly FeedReactionSummaryDto[]>
  >({});
  const [actionError, setActionError] = React.useState<FeedActionError | null>(null);

  /**
   * Làm mới đúng các nhánh mà một thay đổi trên bài có thể ảnh hưởng.
   *
   * S16-SOCIAL-FE-2 (plan §8 H5): thêm danh sách bình chọn (040) + sáng kiến (045) — xoá/ẩn một bài
   * poll/idea mà hai danh sách đó không làm mới thì màn 007/008 và widget rail còn một dòng trỏ vào
   * bài đã 404. Không biết loại bài ở đây (`remove`/`moderate` chỉ có `postId`) nên làm mới cả hai;
   * hai danh sách ngắn, phân trang OFFSET — rẻ hơn một dòng chết.
   */
  const invalidatePostLists = (postId?: string): void => {
    void queryClient.invalidateQueries({ queryKey: socialKeys.feed.allOf() });
    void queryClient.invalidateQueries({ queryKey: socialKeys.saved() });
    void queryClient.invalidateQueries({ queryKey: socialKeys.polls.allOf() });
    void queryClient.invalidateQueries({ queryKey: socialKeys.ideas.allOf() });
    // S16-SOCIAL-FE-2C — bài kudos bị xoá/ẩn cũng phải rời màn 009 + widget «Vinh danh tháng này».
    void queryClient.invalidateQueries({ queryKey: socialKeys.kudos.lists() });
    // S16-SOCIAL-FEMODERRMSG-1 — trang cá nhân đồng nghiệp (`025`), xem `PROFILE_POSTS_PREFIX`.
    void queryClient.invalidateQueries({ queryKey: PROFILE_POSTS_PREFIX });
    // S16-SOCIAL-FEMODERRMSG-1 — kết quả tìm kiếm (`023`, `/feed?q=…`), xem `SEARCH_PREFIX`.
    void queryClient.invalidateQueries({ queryKey: SEARCH_PREFIX });
    // S16-SOCIAL-FEMODERRMSG-1 — tin tức (`020`): khung portal luôn hiện «tin nổi bật» qua
    // `news.list({ highlight })`, nên bài tin đã mất phải rời cả khung (cùng khoá `NewsPage` tự làm mới).
    void queryClient.invalidateQueries({ queryKey: socialKeys.news.allOf() });
    if (postId) {
      void queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(postId) });
    }
  };

  /**
   * Một `onError` cho cả bốn mutation. KHÔNG bỏ trống cái nào: app này không có hệ toast và
   * `QueryClient` ở `main.tsx` không khai `MutationCache.onError`, nên mutation thiếu `onError` là
   * hỏng IM LẶNG TUYỆT ĐỐI — nút nhả ra như cũ, không một ký tự nào xuất hiện.
   *
   * S16-SOCIAL-FEMODERRMSG-1 — `"postGone"` (bài đã mất dưới chân) ⇒ kéo lại các danh sách + chi tiết
   * bài: thẻ đang hiện là dữ liệu CŨ, để nó nằm đó là mời người dùng bấm lại một thao tác chắc chắn
   * 404. Lỗi khác (500, mạng, 403) KHÔNG kéo lại — chưa có gì cho thấy dữ liệu đã cũ.
   */
  const onActionError = (kind: FeedActionKind, err: unknown, postId: string): void => {
    const reason = postActionErrorReason(err);
    setActionError({ kind, forbidden: err instanceof ApiError && err.status === 403, reason });
    if (reason === "postGone") invalidatePostLists(postId);
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
      setActionError(null);
    },
    onError: (err, { postId }) => onActionError("reaction", err, postId),
  });

  const saveMutation = useMutation({
    mutationFn: ({ postId, currentlySaved }: { postId: string; currentlySaved: boolean }) =>
      currentlySaved ? socialApi.unsavePost(postId) : socialApi.savePost(postId),
    onSuccess: (result) => {
      invalidatePostLists(result.postId);
      setActionError(null);
    },
    onError: (err, { postId }) => onActionError("save", err, postId),
  });

  const moderateMutation = useMutation({
    mutationFn: ({ postId, patch }: { postId: string; patch: ModerateFeedPostDto }) =>
      socialApi.moderatePost(postId, patch),
    onSuccess: (post) => {
      invalidatePostLists(post.id);
      setActionError(null);
    },
    onError: (err, { postId }) => onActionError("moderate", err, postId),
  });

  const deleteMutation = useMutation({
    mutationFn: (postId: string) => socialApi.deletePost(postId),
    onSuccess: () => {
      invalidatePostLists();
      setActionError(null);
    },
    onError: (err, postId) => onActionError("delete", err, postId),
  });

  return {
    reactionSummaries,
    setReaction: (postId, emoji) => reactionMutation.mutate({ postId, emoji }),
    toggleSave: (postId, currentlySaved) => saveMutation.mutate({ postId, currentlySaved }),
    moderate: (postId, patch) => moderateMutation.mutate({ postId, patch }),
    // `onDone` đi vào tuỳ chọn của CHÍNH LƯỢT mutate ⇒ React Query chỉ gọi nó sau khi server xác
    // nhận. Đặt nó cạnh `mutate()` là bug đã có thật: điều hướng chạy trước cả khi request rời máy.
    remove: (postId, onDone) => deleteMutation.mutate(postId, { onSuccess: () => onDone?.() }),
    pendingReactionPostId: reactionMutation.isPending
      ? (reactionMutation.variables?.postId ?? null)
      : null,
    pendingSavePostId: saveMutation.isPending ? (saveMutation.variables?.postId ?? null) : null,
    actionError,
    clearActionError: () => setActionError(null),
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
    // `afterDelete` truyền XUỐNG `remove` chứ không gọi cạnh nó — xem docblock của `FeedActions.remove`.
    onDelete: () => deps.actions.remove(post.id, deps.afterDelete),
    onToggleHidden: () => deps.actions.moderate(post.id, { hidden: post.status !== "hidden" }),
    onToggleComments: () =>
      deps.actions.moderate(post.id, { commentsLocked: !post.commentsLocked }),
    onTogglePinned: () => deps.actions.moderate(post.id, { pinned: !post.pinned }),
  };
}
