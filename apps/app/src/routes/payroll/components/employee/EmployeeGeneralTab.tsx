import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PayrollEmployeeDetailDto } from "@mediaos/contracts";
import { StatusPill } from "@mediaos/ui";
import { EMPLOYEE_STATUS_BADGE_VARIANT } from "../../constants";

/**
 * Tab «Thông tin chung» (PAY-SCREEN-007, cặp `view:payroll-employee`) — chiếu HR **bó hẹp** đúng 6 trường
 * của 037 (PAY-DEC-016). KHÔNG email, KHÔNG số điện thoại, KHÔNG lương — muốn thêm trường HR là mở bề mặt
 * PII, phải đi qua gate (contracts `payrollEmployeeDetailSchema`), không «tiện thì lấy».
 *
 * `taxCode` CỐ Ý không hiện ở đây dù 037 có thể trả — nó thuộc tab «Thuế TNCN» (SPEC-11 §9.1).
 */
export function EmployeeGeneralTab({ employee }: { employee: PayrollEmployeeDetailDto }) {
  const { t } = useTranslation("payroll");
  const statusLabel = employee.employeeStatus
    ? t(`employeeStatus.${employee.employeeStatus}`, { defaultValue: employee.employeeStatus })
    : "—";

  const rows: Array<[string, ReactNode]> = [
    [t("employeeDetail.general.employeeCode"), employee.employeeCode ?? "—"],
    [t("employeeDetail.general.fullName"), employee.fullName ?? "—"],
    [t("employeeDetail.general.orgUnit"), employee.orgUnitName ?? "—"],
    [t("employeeDetail.general.position"), employee.positionName ?? "—"],
    [
      t("employeeDetail.general.status"),
      employee.employeeStatus ? (
        <StatusPill
          tone={EMPLOYEE_STATUS_BADGE_VARIANT[employee.employeeStatus] ?? "muted"}
          label={statusLabel}
        />
      ) : (
        "—"
      ),
    ],
    [t("employeeDetail.general.startDate"), employee.startDate ?? "—"],
    [
      t("employeeDetail.general.hasSalaryProfile"),
      employee.hasSalaryProfile ? t("employees.hasProfile") : t("employees.noProfile"),
    ],
  ];

  return (
    <div className="space-y-4" data-testid="employee-general-tab">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">{t("employeeDetail.general.note")}</p>
    </div>
  );
}
