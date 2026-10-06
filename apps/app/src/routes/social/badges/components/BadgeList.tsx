/**
 * S16-SOCIAL-FE-3B (L4) — thân của màn Thiết lập huy hiệu (`SOC-SCREEN-012`): chọn MỘT trạng thái của lượt đọc
 * 056 rồi vẽ. THUẦN TRÌNH BÀY — không `useQuery`, không gọi API: trang (`BadgeSettingsPage`) giữ query và hai
 * lượt ghi của hàng, truyền xuống dữ liệu + cờ.
 *
 * Thứ tự xét (cái trước thắng) — cùng khuôn với `moderation/components/ReportQueue.tsx`:
 *   1. `error`                 ⇒ dải lỗi, KHÔNG vẽ bảng cũ: bảng cũ trông như mới là mời «Ngừng dùng» một huy
 *                                hiệu đã bị người khác đổi. 403 / 400 ⇒ không nút «Thử lại»; `message` của
 *                                server không được vẽ. Lỗi CÒN đó suốt lượt đọc lại ⇒ «Thử lại» khoá theo
 *                                `isFetching`.
 *   2. chưa có `page`          ⇒ khung chờ có tên trợ năng.
 *   3. trang rỗng, `total > 0` ⇒ `page` trên URL đã quá trang cuối ⇒ nút «Về trang 1» (KHÔNG dùng câu rỗng).
 *   4. trang rỗng, `total = 0` ⇒ «Chưa có huy hiệu nào.»
 *   5. còn lại                 ⇒ `BadgeTable` + `OffsetPager` (tự ẩn khi `total ≤ limit`).
 */
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";
import type { KudosBadgeAdminPageDto } from "@mediaos/contracts";
import { AdminErrorNotice } from "../../admin/components/AdminErrorNotice";
import { OffsetPager } from "../../feed/components/OffsetPager";
import { PLACEHOLDER_CLASS, SKELETON_ROWS } from "../../moderation/components/list-states";
import { describeBadgeReadError } from "../lib/badge-errors";
import { BadgeTable, type BadgeTableProps } from "./BadgeTable";

export interface BadgeListProps extends Omit<BadgeTableProps, "badges"> {
  /** Trang 056 đang có (kể cả trang giữ lại trong lúc lật trang); chưa có ⇒ `undefined`. */
  page: KudosBadgeAdminPageDto | undefined;
  /** Đang tải nền (lật trang · đọc lại sau lượt ghi / sau lỗi) ⇒ khoá bộ chuyển trang và nút «Thử lại». */
  isFetching: boolean;
  /** Lỗi của lượt đọc gần nhất; không lỗi ⇒ `null`. */
  error: unknown;
  onRetry: () => void;
  onPageChange: (page: number) => void;
}

const FIRST_PAGE = 1;

export function BadgeList({
  page,
  isFetching,
  error,
  onRetry,
  onPageChange,
  ...tableProps
}: BadgeListProps): React.ReactElement {
  const { t } = useTranslation("social");

  if (error !== null && error !== undefined) {
    const { reason, retryable } = describeBadgeReadError(error);
    return (
      <AdminErrorNotice
        reason={reason}
        onRetry={retryable ? onRetry : undefined}
        isRetrying={isFetching}
      />
    );
  }

  if (page === undefined) {
    return (
      <div
        role="status"
        aria-label={t("admin.badges.page.loadingAria")}
        className="flex flex-col gap-2"
      >
        {SKELETON_ROWS.map((row) => (
          <div key={row} className="h-12 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (page.data.length === 0 && page.total > 0) {
    return (
      <div data-testid="badge-list-out-of-range" className={PLACEHOLDER_CLASS}>
        <p>{t("admin.badges.page.pageOutOfRange")}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={isFetching}
          onClick={() => onPageChange(FIRST_PAGE)}
        >
          {t("admin.badges.page.backToFirstPage")}
        </Button>
      </div>
    );
  }

  if (page.data.length === 0) {
    return (
      <p data-testid="badge-list-empty" className={PLACEHOLDER_CLASS}>
        {t("admin.badges.page.empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <BadgeTable badges={page.data} {...tableProps} />
      <OffsetPager
        page={page.page}
        limit={page.limit}
        total={page.total}
        onPageChange={onPageChange}
        disabled={isFetching}
      />
    </div>
  );
}
