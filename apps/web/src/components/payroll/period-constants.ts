import type { PayrollPeriodStatus } from "@mediaos/contracts";

/** Human-readable labels for payroll period FSM states. */
export const PERIOD_STATUS_LABELS: Record<PayrollPeriodStatus, string> = {
  draft: "Nháp",
  approved: "Đã duyệt",
  published: "Đã phát hành",
};

/** Badge colour class per FSM state (Tailwind). */
export const PERIOD_STATUS_BADGE: Record<PayrollPeriodStatus, string> = {
  draft: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-800",
  published: "bg-green-100 text-green-800",
};

/** Placeholder when a monetary value is masked (before re-auth). */
export const MASKED_AMOUNT_PLACEHOLDER = "•••";
