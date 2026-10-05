/**
 * S16-SOCIAL-FE-3 (L2) — KHUNG của thẻ báo cáo: export đúng tên + hợp đồng props, chưa vẽ gì (lượt RED).
 */
import type * as React from "react";
import type { FeedReportDto } from "@mediaos/contracts";

export interface ReportRowProps {
  report: FeedReportDto;
  /** Bấm «Xử lý» — hộp thoại là việc của nơi gọi. */
  onResolve: (report: FeedReportDto) => void;
}

export function ReportRow(_props: ReportRowProps): React.ReactElement | null {
  return null;
}
