/**
 * S16-SOCIAL-FEBLOCKSEED-1 — pill trạng thái sáng kiến, DÙNG CHUNG cho màn 008 (`045`) và thẻ bài
 * `type='idea'` (khối `post.idea` của BE-2D). Tách từ `IdeasPage` để hai nơi không trôi tông/nhãn.
 *
 * Trình bày THUẦN — không `useQuery`, không gate: `status` KHÔNG bị mask dưới `view:feed` (BE-2D D6).
 * KHÔNG vẽ `reviewNote`/người duyệt ở đây — mặt nạ D19 theo người xem chỉ sống ở `045`.
 *
 * `Record<FeedIdeaStatusDto, …>` đóng ⇒ thêm trạng thái vào `feedIdeaStatusSchema` mà quên tông ⇒ `tsc`
 * đỏ. `text-xs` nằm trong pill (không dựa vào khối cha) vì thẻ bài không đặt cỡ chữ cho hàng chứa nó.
 */
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@mediaos/ui";
import type { FeedIdeaStatusDto } from "@mediaos/contracts";

const PILL_CLASS: Record<FeedIdeaStatusDto, string> = {
  submitted: "bg-muted text-muted-foreground",
  under_review: "bg-accent text-accent-foreground",
  accepted: "bg-primary/15 text-primary",
  rejected: "bg-destructive/10 text-destructive",
};

interface IdeaStatusPillProps {
  status: FeedIdeaStatusDto;
  className?: string;
}

export function IdeaStatusPill({ status, className }: IdeaStatusPillProps): React.ReactElement {
  const { t } = useTranslation("social");
  return (
    <span
      data-testid="idea-status-pill"
      className={cn("rounded-full px-2 py-0.5 text-xs font-medium", PILL_CLASS[status], className)}
    >
      {t(`idea.status.${status}`)}
    </span>
  );
}
