/**
 * S16-SOCIAL-FE-2B — dải lỗi đăng bài + dải THÔNG TIN «đã bỏ N lượt nhắc» của `useCreatePost`, dùng
 * chung cho bảng tin và trang nhóm. Tách nguyên văn khỏi `FeedPage` (cùng `data-testid`) để hai màn
 * không lệch nhau. S16-SOCIAL-MENTIONLINK-1: dải thông tin dời sang `DroppedMentionsNotice` (bình luận
 * dùng chung), giữ `data-testid="dropped-mentions-notice"` cho bài.
 */
import { ActionErrorBanner } from "./ActionErrorBanner";
import { DroppedMentionsNotice } from "./DroppedMentionsNotice";
import type { UseCreatePostResult } from "../lib/use-create-post";

type CreatePostNoticesProps = Pick<
  UseCreatePostResult,
  "postError" | "clearPostError" | "droppedMentionCount" | "clearDroppedMentions"
>;

export function CreatePostNotices({
  postError,
  clearPostError,
  droppedMentionCount,
  clearDroppedMentions,
}: CreatePostNoticesProps): React.ReactElement {
  return (
    <>
      {postError && (
        <ActionErrorBanner
          kind="post"
          forbidden={postError.forbidden}
          reason={postError.reason}
          onDismiss={clearPostError}
        />
      )}

      <DroppedMentionsNotice
        count={droppedMentionCount}
        onDismiss={clearDroppedMentions}
        testId="dropped-mentions-notice"
      />
    </>
  );
}
