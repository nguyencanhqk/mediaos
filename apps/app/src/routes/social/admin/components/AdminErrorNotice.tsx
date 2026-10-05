/**
 * S16-SOCIAL-FE-3 (L1) — KHUNG dải báo lỗi của cụm quản trị bảng tin. Thân ở commit GREEN kế tiếp
 * (plan §4 — quy tắc stub-trước).
 */
import type * as React from "react";
import type { AdminErrorReason } from "../lib/admin-errors";

export interface AdminErrorNoticeProps {
  reason: AdminErrorReason;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function AdminErrorNotice(_props: AdminErrorNoticeProps): React.ReactElement | null {
  return null;
}
