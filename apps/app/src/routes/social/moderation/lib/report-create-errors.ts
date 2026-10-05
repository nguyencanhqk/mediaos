/**
 * S16-SOCIAL-FE-3 (L3) — lỗi của lời gọi GỬI báo cáo (`SOCIAL-API-027`). KHUNG — chưa hiện thực.
 */
import type { AdminErrorReason, AdminErrorTable } from "../../admin/lib/admin-errors";

export const CREATE_REPORT_ERROR_TABLE = {} as const satisfies AdminErrorTable;

export interface CreateReportErrorOutcome {
  reason: AdminErrorReason;
  retryable: boolean;
}

export function describeCreateReportError(_err: unknown): CreateReportErrorOutcome {
  return { reason: "generic", retryable: false };
}
