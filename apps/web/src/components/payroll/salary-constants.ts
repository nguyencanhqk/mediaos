import type { PayCycle, SalaryType, SalaryProfileStatus } from "@mediaos/contracts";

/** Placeholder shown when the server masked salary (caller lacks view-salary-profile). */
export const MASKED_SALARY_PLACEHOLDER = "•••";

/** Sub-label under the mask placeholder. */
export const MASKED_SALARY_HINT = "Không có quyền";

export const SALARY_TYPE_LABELS: Record<SalaryType, string> = {
  monthly: "Theo tháng",
  hourly: "Theo giờ",
  project: "Theo dự án",
};

export const PAY_CYCLE_LABELS: Record<PayCycle, string> = {
  monthly: "Hàng tháng",
  biweekly: "2 tuần/lần",
  weekly: "Hàng tuần",
};

export const SALARY_STATUS_LABELS: Record<SalaryProfileStatus, string> = {
  active: "Đang áp dụng",
  inactive: "Ngừng",
};

/**
 * Render base salary for display. The server is the source of truth for masking:
 * when `baseSalary === null` the caller has NO view-salary-profile permission, so we
 * render the placeholder — the real number was never sent to this client.
 */
export function formatBaseSalary(
  baseSalary: number | null,
  currency: string | null | undefined = "VND",
): string {
  if (baseSalary == null) return MASKED_SALARY_PLACEHOLDER;
  return `${baseSalary.toLocaleString("vi-VN")} ${currency ?? "VND"}`;
}

/** True when the server revealed salary (caller can view) — drives edit affordances client-side. */
export function isSalaryRevealed(baseSalary: number | null): boolean {
  return baseSalary != null;
}
