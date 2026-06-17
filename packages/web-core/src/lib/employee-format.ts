import type { TFunction } from "i18next";
import type { EmployeeListItemDto } from "@mediaos/contracts";

export type EmployeeStatus = EmployeeListItemDto["status"];

/**
 * Badge variant union dùng cho trạng thái nhân sự. Giữ cục bộ ở web-core (KHÔNG import
 * `BadgeProps` từ @mediaos/ui) để tránh chu trình build web-core → ui (ui đã depends-on
 * web-core). Đối chiếu đúng/sai được ép tại call-site `<Badge variant={...}>`.
 */
type EmployeeStatusBadgeVariant = "success" | "warning" | "muted" | "danger";

/** Map trạng thái nhân sự → variant Badge (dùng chung list + detail). */
export const EMPLOYEE_STATUS_VARIANT: Record<EmployeeStatus, EmployeeStatusBadgeVariant> = {
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
