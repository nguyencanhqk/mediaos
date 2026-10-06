/**
 * S16-SOCIAL-FE-3B (L5) — KHUNG của dải lỗi lượt đọc 052 (lượt RED: chưa vẽ gì).
 */
import type * as React from "react";
import type { StatsErrorOutcome } from "../lib/stats-errors";

export interface StatsLoadErrorProps {
  outcome: StatsErrorOutcome;
  isRetrying: boolean;
  onRetry: () => void;
  onClearOrgUnit: () => void;
  onResetRange: () => void;
}

export function StatsLoadError(_props: StatsLoadErrorProps): React.ReactElement | null {
  return null;
}
