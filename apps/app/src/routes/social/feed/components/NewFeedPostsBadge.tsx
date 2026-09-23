/**
 * S16-SOCIAL-FE-1 (plan D7) — dải «N bài mới» nổi trên đầu dòng cuộn.
 *
 * Bấm ⇒ caller tải lại danh sách + cuộn lên đầu + reset đếm. Component này **không** tự gọi API và
 * **không** giữ bài nào: nó chỉ là một cái nút. Mọi lý do vì sao không tự chèn bài nằm ở docblock của
 * `useFeedRealtime` — đọc ở đó trước khi "tối ưu".
 */
import { useTranslation } from "react-i18next";
import { ArrowUp } from "lucide-react";
import { cn } from "@mediaos/ui";

interface NewFeedPostsBadgeProps {
  count: number;
  onClick: () => void;
  className?: string;
}

export function NewFeedPostsBadge({
  count,
  onClick,
  className,
}: NewFeedPostsBadgeProps): React.ReactElement | null {
  const { t } = useTranslation("social");

  // `count === 0` ⇒ KHÔNG render (kể cả khung trong suốt): một node dính trên đầu danh sách vẫn ăn
  // vùng bấm của thẻ bài đầu tiên dù nhìn không thấy gì.
  if (count <= 0) return null;

  return (
    <div className={cn("sticky top-2 z-10 flex justify-center", className)}>
      <button
        type="button"
        onClick={onClick}
        aria-label={t("newPosts.aria")}
        data-testid="new-posts-badge"
        className="flex items-center gap-1.5 rounded-full border border-border bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-md hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowUp className="h-4 w-4" aria-hidden="true" />
        {t("newPosts.badge", { count })}
      </button>
    </div>
  );
}
