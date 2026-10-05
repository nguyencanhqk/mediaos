/**
 * S16-SOCIAL-FE-3 (L2) — hộp thoại kết thúc một báo cáo (`SOCIAL-API-029`). KHUNG cho lượt RED: export
 * đúng tên, chưa vẽ gì.
 */
import type * as React from "react";
import type { FeedReportActionDto, FeedReportDto } from "@mediaos/contracts";
import type { AdminErrorReason } from "../../admin/lib/admin-errors";

export type ResolveReportOutcome =
  | { kind: "done"; report: FeedReportDto; updated: FeedReportDto; action: FeedReportActionDto }
  | { kind: "failed"; report: FeedReportDto; reason: AdminErrorReason; invalidate: boolean };

export interface ResolveReportDialogProps {
  report: FeedReportDto;
  onClose: () => void;
  onOutcome: (outcome: ResolveReportOutcome) => void;
}

export function ResolveReportDialog(_props: ResolveReportDialogProps): React.ReactElement | null {
  return null;
}
