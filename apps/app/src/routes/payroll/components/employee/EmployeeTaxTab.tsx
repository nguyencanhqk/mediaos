import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import type { PayrollEmployeeDetailDto } from "@mediaos/contracts";
import { isDependentEffectiveOn, todayIsoDate } from "./employee-forms";

/**
 * Tab «Thuế TNCN» (PAY-SCREEN-007) — đòi **CẢ HAI** cặp (SPEC-11 §9.1): `view:salary-profile` cho
 * `taxCode` (chiếu HR qua 037, §18.1 A hàng 2) **và** `view:payroll-employee` cho người phụ thuộc (040).
 * Page chỉ render tab này khi có cả hai; ở đây vẫn xử lý `taxCode` VẮNG KHOÁ (server quyết theo scope
 * Company — FE không suy scope) bằng câu «không có quyền xem», không phải ô trống câm.
 *
 * NPT «đang giảm trừ» = khoảng `[effectiveFrom, effectiveTo]` phủ hôm nay. Quản lý (thêm/sửa/xoá) ở tab
 * «Gia đình» — tab này chỉ tóm tắt để người tính thuế nhìn một chỗ.
 */
export function EmployeeTaxTab({ employee }: { employee: PayrollEmployeeDetailDto }) {
  const { t } = useTranslation("payroll");
  const dependentsQuery = useQuery({
    queryKey: payrollKeys.employees.dependents(employee.userId),
    queryFn: () => payrollApi.listDependents(employee.userId),
  });
  const today = todayIsoDate();
  const effective = (dependentsQuery.data ?? []).filter((d) => isDependentEffectiveOn(d, today));

  const taxCodeNode =
    employee.taxCode === undefined ? (
      <span className="text-muted-foreground">{t("tax.taxCodeHidden")}</span>
    ) : employee.taxCode === null ? (
      <span className="text-muted-foreground">{t("tax.taxCodeEmpty")}</span>
    ) : (
      <span className="font-mono" data-testid="tax-code">
        {employee.taxCode}
      </span>
    );

  return (
    <div className="space-y-5" data-testid="employee-tax-tab">
      <dl>
        <dt className="text-xs text-muted-foreground">{t("tax.taxCode")}</dt>
        <dd className="text-sm">{taxCodeNode}</dd>
      </dl>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{t("tax.dependentsEffective")}</h3>
        {dependentsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("states.loading")}</p>
        ) : dependentsQuery.isError ? (
          <p className="text-sm text-danger">{t("states.error")}</p>
        ) : effective.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("tax.dependentsNone")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {effective.map((d) => (
              <li key={d.id} className="flex flex-wrap gap-x-3">
                <span className="font-medium">{d.fullName}</span>
                <span className="text-muted-foreground">{t(`relationship.${d.relationship}`)}</span>
                <span className="text-muted-foreground tabular-nums">
                  {d.effectiveFrom} → {d.effectiveTo ?? t("dependents.ongoing")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{t("tax.dependentsHint")}</p>
      </div>
    </div>
  );
}
