/**
 * S16-SOCIAL-FE-3 (L2) — KHUNG của hàng đợi báo cáo: export đúng tên + hợp đồng props, chưa vẽ gì (lượt RED).
 */
import type * as React from "react";
import type { FeedReportDto, FeedReportPageDto } from "@mediaos/contracts";
import type { ModerationStatusFilter } from "../lib/moderation-route-search";

export interface ReportQueueProps {
  /** Trang 028 đang có (kể cả trang giữ lại bởi `keepPreviousData`); chưa có ⇒ `undefined`. */
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

export function ReportQueue(_props: ReportQueueProps): React.ReactElement | null {
  return null;
}
