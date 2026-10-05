/**
 * S16-SOCIAL-FE-3 (L2) — lỗi của màn Kiểm duyệt: bảng mã theo lời gọi + «hành vi» (KHUNG — hiện thực ở
 * commit kế tiếp).
 */
import type { AdminErrorReason, AdminErrorTable } from "../../admin/lib/admin-errors";

export const RESOLVE_REPORT_ERROR_TABLE: AdminErrorTable = {};
export const UNHIDE_POST_ERROR_TABLE: AdminErrorTable = {};
export const MODERATION_READ_ERROR_TABLE: AdminErrorTable = {};

export interface ResolveReportErrorOutcome {
  reason: AdminErrorReason;
  dialog: "close" | "keep";
  resetAction: boolean;
  invalidate: boolean;
  retryable: boolean;
}

export interface UnhidePostErrorOutcome {
  reason: AdminErrorReason;
  invalidate: boolean;
  retryable: boolean;
}

export interface ModerationReadErrorOutcome {
  reason: AdminErrorReason;
  retryable: boolean;
}

export function describeResolveReportError(_err: unknown): ResolveReportErrorOutcome {
  return {
    reason: "busy",
    dialog: "keep",
    resetAction: false,
    invalidate: false,
    retryable: false,
  };
}

export function describeUnhidePostError(_err: unknown): UnhidePostErrorOutcome {
  return { reason: "busy", invalidate: false, retryable: false };
}

export function describeModerationReadError(_err: unknown): ModerationReadErrorOutcome {
  return { reason: "busy", retryable: false };
}
