/**
 * S16-SOCIAL-FE-2B — dải lỗi đăng bài + dải THÔNG TIN «đã bỏ N lượt nhắc» của `useCreatePost`, dùng
 * chung cho bảng tin và trang nhóm. Tách nguyên văn khỏi `FeedPage` (cùng `data-testid`) để hai màn
 * không lệch nhau.
 */
import { useTranslation } from "react-i18next";
import { Info, X } from "lucide-react";
import { ActionErrorBanner } from "./ActionErrorBanner";
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
  const { t } = useTranslation("social");
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

      {droppedMentionCount > 0 && (
        <div
          role="status"
          data-testid="dropped-mentions-notice"
          className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted px-3 py-2"
        >
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t("composer.droppedMentions", { count: droppedMentionCount })}
          </p>
          <button
            type="button"
            onClick={clearDroppedMentions}
            aria-label={t("actionError.dismiss")}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}
