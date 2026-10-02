/**
 * S16-SOCIAL-MENTIONLINK-1 (plan FE-2D §4 B3) — dải THÔNG TIN «đã bỏ N lượt nhắc».
 *
 * `droppedMentions` của `002`/`015` là thông tin, KHÔNG phải lỗi (SPEC-16 §12 `ERR-009`): mention người
 * ngoài audience (của bài, hoặc của BÀI CHA với bình luận) bị bỏ im lặng mà request vẫn 201. Tách
 * nguyên văn khỏi `CreatePostNotices` để bài (FE-1 M7) và bình luận nói CÙNG một câu, cùng một hình
 * dạng (`role="status"` + nút đóng) — `testId` là thứ duy nhất khác nhau giữa hai chỗ.
 */
import { useTranslation } from "react-i18next";
import { Info, X } from "lucide-react";
import { cn } from "@mediaos/ui";

interface DroppedMentionsNoticeProps {
  /** Số lượt nhắc bị bỏ; `0` ⇒ không vẽ gì (rỗng là trường hợp thường). */
  count: number;
  onDismiss: () => void;
  testId: string;
  className?: string;
}

export function DroppedMentionsNotice({
  count,
  onDismiss,
  testId,
  className,
}: DroppedMentionsNoticeProps): React.ReactElement | null {
  const { t } = useTranslation("social");
  if (count <= 0) return null;

  return (
    <div
      role="status"
      data-testid={testId}
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border border-border bg-muted px-3 py-2",
        className,
      )}
    >
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {t("composer.droppedMentions", { count })}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("actionError.dismiss")}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
