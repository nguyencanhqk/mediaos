/**
 * S16-SOCIAL-FE-3 (L2) — hàng đợi báo cáo của `SOC-SCREEN-010`: danh sách THẺ + phân trang OFFSET (plan D9).
 *
 * THUẦN TRÌNH BÀY — không `useQuery`, không gọi API: màn (`ModerationPage`) giữ query 028 và truyền xuống
 * trang dữ liệu + trạng thái tải/lỗi + bộ lọc đang áp. Nhờ vậy mọi trạng thái dựng được bằng props.
 *
 * Thứ tự xét trạng thái (cái trước thắng):
 *   1. `error`            ⇒ dải lỗi, KHÔNG vẽ trang cũ — hàng đợi kiểm duyệt cũ mà trông như mới là mời
 *                           người ta xử lý một báo cáo đã đổi trạng thái. 403 ⇒ chữ của FE, không nút
 *                           «Thử lại» (`describeModerationReadError`); `message` của server không được vẽ.
 *   2. chưa có `page`     ⇒ skeleton.
 *   3. trang rỗng, `total > 0` ⇒ `page` trên URL đã quá trang cuối (hàng vừa được xử lý, hoặc URL gõ
 *                           tay) ⇒ nút «Về trang 1». KHÔNG dùng câu rỗng: hàng đợi KHÔNG rỗng.
 *   4. trang rỗng, `total = 0` ⇒ câu rỗng THEO BỘ LỌC (4 câu khác nhau).
 *   5. còn lại            ⇒ `ul` có tên trợ năng + `OffsetPager` (tự ẩn khi chỉ một trang).
 */
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";
import type { FeedReportDto, FeedReportPageDto } from "@mediaos/contracts";
import { AdminErrorNotice } from "../../admin/components/AdminErrorNotice";
import { OffsetPager } from "../../feed/components/OffsetPager";
import { describeModerationReadError } from "../lib/moderation-errors";
import type { ModerationStatusFilter } from "../lib/moderation-route-search";
import { PLACEHOLDER_CLASS, SKELETON_ROWS } from "./list-states";
import { ReportRow } from "./ReportRow";

export interface ReportQueueProps {
  /**
   * Trang 028 đang có (kể cả trang giữ lại bởi `keepPreviousData`); chưa có ⇒ `undefined`.
   *
   * ⚠️ NƠI GỌI: câu rỗng đọc `statusFilter` chứ không đọc bộ lọc đã sinh ra `page`. Khi vừa đổi bộ lọc mà
   * trang giữ lại RỖNG (`isPlaceholderData` && `total === 0`) thì phải truyền `undefined` + `isLoading`
   * (skeleton) — nếu không, câu rỗng của bộ lọc MỚI hiện ra trước khi dữ liệu của nó về.
   */
  page: FeedReportPageDto | undefined;
  /** Lượt tải ĐẦU (chưa có dữ liệu nào). */
  isLoading: boolean;
  /** Đang tải nền (đổi trang/bộ lọc) ⇒ khoá bộ chuyển trang. */
  isFetching?: boolean;
  /** Lỗi của lượt đọc gần nhất; không lỗi ⇒ `null`. */
  error: unknown;
  /** Bộ lọc trạng thái đang áp — quyết định câu rỗng. */
  statusFilter: ModerationStatusFilter;
  onRetry: () => void;
  onPageChange: (page: number) => void;
  onResolve: (report: FeedReportDto) => void;
}

const FIRST_PAGE = 1;

export function ReportQueue({
  page,
  isLoading,
  isFetching = false,
  error,
  statusFilter,
  onRetry,
  onPageChange,
  onResolve,
}: ReportQueueProps): React.ReactElement {
  const { t } = useTranslation("social");

  if (error !== null && error !== undefined) {
    const { reason, retryable } = describeModerationReadError(error);
    return <AdminErrorNotice reason={reason} onRetry={retryable ? onRetry : undefined} />;
  }

  if (isLoading || page === undefined) {
    return (
      <div
        role="status"
        aria-label={t("admin.moderation.queue.loadingAria")}
        className="flex flex-col gap-2"
      >
        {SKELETON_ROWS.map((row) => (
          <div key={row} className="h-28 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (page.data.length === 0 && page.total > 0) {
    return (
      <div data-testid="report-queue-out-of-range" className={PLACEHOLDER_CLASS}>
        <p>{t("admin.moderation.queue.pageOutOfRange")}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => onPageChange(FIRST_PAGE)}
        >
          {t("admin.moderation.queue.backToFirstPage")}
        </Button>
      </div>
    );
  }

  if (page.data.length === 0) {
    return (
      <p data-testid="report-queue-empty" className={PLACEHOLDER_CLASS}>
        {t(`admin.moderation.queue.empty.${statusFilter}`)}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={t("admin.moderation.queue.listAria")} className="flex flex-col gap-2">
        {page.data.map((report) => (
          <li key={report.id}>
            <ReportRow report={report} onResolve={onResolve} />
          </li>
        ))}
      </ul>
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
