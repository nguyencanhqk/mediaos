/**
 * system-jobs-format — helper hiển thị THUẦN (không phụ thuộc React/i18n) dùng chung giữa SystemJobsPage
 * và SystemJobRunsDialog (S5-FND-JOBS-OBS-1).
 */
import type { SystemJobRunStatusDto } from "@mediaos/web-core";

/** Badge variant (@mediaos/ui) theo trạng thái run — khớp SYSTEM_JOB_RUN_STATUSES (CHECK mig 0475). */
export const JOB_STATUS_BADGE_VARIANT: Record<
  SystemJobRunStatusDto,
  "success" | "danger" | "warning" | "muted" | "brand"
> = {
  Running: "brand",
  Success: "success",
  Failed: "danger",
  Partial: "warning",
  Skipped: "muted",
};

/** durationMs → chuỗi ngắn gọn ("1.2s" / "850ms" / "—" nếu null, vd run đang Running). */
export function formatJobDurationMs(durationMs: number | null): string {
  if (durationMs === null) return "—";
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}
