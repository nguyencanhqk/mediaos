/**
 * S16-SOCIAL-FE-2 — phân trang OFFSET cho màn 007/008 (`{data,page,limit,total}` của `040`/`045`).
 *
 * Khác dòng cuộn keyset của Bảng tin: danh sách bình chọn/sáng kiến ngắn, ổn định, và người duyệt
 * cần nhảy trang — đúng lý do BE chọn OFFSET cho cụm này (khuôn `listFeedGroupsQuerySchema`).
 * Chỉ một trang ⇒ không render gì.
 */
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";

interface OffsetPagerProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

export function OffsetPager({
  page,
  limit,
  total,
  onPageChange,
  disabled = false,
}: OffsetPagerProps): React.ReactElement | null {
  const { t } = useTranslation("social");
  const pages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  if (pages <= 1) return null;

  return (
    <nav className="flex items-center justify-between gap-2" data-testid="offset-pager">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        {t("pagination.prev")}
      </Button>
      <span className="text-sm text-muted-foreground">
        {t("pagination.pageOf", { page, pages })}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="offset-pager-next"
        disabled={disabled || page >= pages}
        onClick={() => onPageChange(page + 1)}
      >
        {t("pagination.next")}
      </Button>
    </nav>
  );
}
