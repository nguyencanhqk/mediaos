/**
 * S16-SOCIAL-FE-3 (L3) — hộp thoại soạn báo cáo vi phạm (`SOCIAL-API-027`). KHUNG — chưa hiện thực.
 */
import type * as React from "react";
import type { FeedTargetTypeDto } from "@mediaos/contracts";

export interface ReportDialogProps {
  targetType: FeedTargetTypeDto;
  targetId: string;
  onClose: () => void;
}

export function ReportDialog(_props: ReportDialogProps): React.ReactElement | null {
  return null;
}
