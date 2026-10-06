/** S16-SOCIAL-FE-3B (L5a) — KHUNG cho lượt RED: mọi hàm trả giá trị rỗng đúng kiểu, chưa có luật nào. */
import type { FeedEngagementParams } from "@mediaos/web-core";
import type { AdminErrorReason, AdminErrorTable } from "../../admin/lib/admin-errors";

export const STATS_ERROR_TABLE = {} as const satisfies AdminErrorTable;

export type StatsErrorRecovery = "clearOrgUnit" | "resetRange" | "retry" | "none";

export interface StatsErrorOutcome {
  reason: AdminErrorReason;
  recovery: StatsErrorRecovery;
}

export class StatsExportFileError extends Error {}

export function describeStatsError(
  _err: unknown,
  _params: FeedEngagementParams,
): StatsErrorOutcome {
  return { reason: "generic", recovery: "none" };
}
