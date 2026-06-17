import type { TFunction } from "i18next";
import type { EmployeeListItemDto } from "@mediaos/contracts";
import type { BadgeProps } from "@/components/ui/badge";

export type EmployeeStatus = EmployeeListItemDto["status"];

/** Map trạng thái nhân sự → variant Badge (dùng chung list + detail). */
export const EMPLOYEE_STATUS_VARIANT: Record<EmployeeStatus, NonNullable<BadgeProps["variant"]>> = {
  active: "success",
  inactive: "warning",
  resigned: "muted",
  terminated: "danger",
};

/**
 * Định dạng lương theo quyền (mask phía SERVER — FE chỉ render gì nhận được).
 * `null` = không có quyền xem → chuỗi i18n; number = có quyền → "x ₫".
 */
export function formatSalary(baseSalary: number | null, t: TFunction<"org">): string {
  if (baseSalary == null) return t("employees.salaryHidden");
  return `${baseSalary.toLocaleString("vi-VN")} ₫`;
}
