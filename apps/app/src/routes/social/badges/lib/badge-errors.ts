/**
 * S16-SOCIAL-FE-3B (L4) — KHUNG (lượt RED): lỗi của màn Thiết lập huy hiệu. Thân thật ở commit GREEN.
 */
import type { AdminErrorReason, AdminErrorTable } from "../../admin/lib/admin-errors";

export const CREATE_BADGE_ERROR_TABLE: AdminErrorTable = {};
export const UPDATE_BADGE_ERROR_TABLE: AdminErrorTable = {};
export const TOGGLE_BADGE_ERROR_TABLE: AdminErrorTable = {};
export const BADGE_READ_ERROR_TABLE: AdminErrorTable = {};

export interface BadgeFormErrorOutcome {
  reason: AdminErrorReason;
  dialog: "close" | "keep";
  field: "code" | null;
  invalidate: boolean;
  retryable: boolean;
}

export interface BadgeToggleErrorOutcome {
  reason: AdminErrorReason;
  invalidate: boolean;
  retryable: boolean;
}

export interface BadgeReadErrorOutcome {
  reason: AdminErrorReason;
  retryable: boolean;
}

const EMPTY_FORM_OUTCOME: BadgeFormErrorOutcome = {
  reason: "generic",
  dialog: "keep",
  field: null,
  invalidate: false,
  retryable: false,
};

export function describeCreateBadgeError(_err: unknown): BadgeFormErrorOutcome {
  return EMPTY_FORM_OUTCOME;
}

export function describeUpdateBadgeError(_err: unknown): BadgeFormErrorOutcome {
  return EMPTY_FORM_OUTCOME;
}

export function describeToggleBadgeError(_err: unknown): BadgeToggleErrorOutcome {
  return { reason: "generic", invalidate: false, retryable: false };
}

export function describeBadgeReadError(_err: unknown): BadgeReadErrorOutcome {
  return { reason: "generic", retryable: false };
}
