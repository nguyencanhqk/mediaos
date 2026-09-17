import { useTranslation } from "react-i18next";
import { paymentBatchStatusEnum, type PayrollReportParam } from "@mediaos/contracts";
import { Input, Select } from "@mediaos/ui";
import { UnitSelector } from "../UnitSelector";
import type { PayrollPeopleLookup } from "../../use-payroll-people";
import type { ReportFilters } from "../../report-view";

const FISCAL_YEARS_BACK = 4;

/**
 * Thanh lọc của màn xem báo cáo — CHỈ vẽ ô của tham số áp cho báo cáo (`params`, suy từ mục 080). Ô bắt buộc
 * có dấu `*` trong nhãn. `userId` chỉ vẽ khi người dùng tra được danh bạ PAYROLL (`people.canResolve`) —
 * không thì bỏ ô, báo cáo vẫn chạy cho mọi người.
 */
export function ReportFiltersBar({
  params,
  required,
  filters,
  people,
  onChange,
}: {
  params: readonly PayrollReportParam[];
  required: readonly PayrollReportParam[];
  filters: ReportFilters;
  people: PayrollPeopleLookup;
  onChange: (next: ReportFilters) => void;
}) {
  const { t } = useTranslation("payroll");
  const set = (key: PayrollReportParam, value: string) => onChange({ ...filters, [key]: value });
  const label = (p: PayrollReportParam) =>
    `${t(`reports.params.${p}`)}${required.includes(p) ? " *" : ""}`;
  const currentYear = new Date().getFullYear();

  return (
    <>
      {params.map((p) => {
        switch (p) {
          case "fromMonth":
          case "toMonth":
            return (
              <label key={p} className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{label(p)}</span>
                <Input
                  type="month"
                  aria-label={label(p)}
                  value={filters[p]}
                  onChange={(e) => set(p, e.target.value)}
                  className="w-40"
                />
              </label>
            );
          case "fiscalYear":
            return (
              <label key={p} className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{label(p)}</span>
                <Select
                  aria-label={label(p)}
                  value={filters.fiscalYear}
                  onChange={(e) => set(p, e.target.value)}
                  className="w-28"
                >
                  {Array.from({ length: FISCAL_YEARS_BACK + 2 }, (_, i) => currentYear + 1 - i).map(
                    (y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ),
                  )}
                </Select>
              </label>
            );
          case "orgUnitId":
            return (
              <UnitSelector
                key={p}
                value={filters.orgUnitId}
                onChange={(v) => set(p, v)}
                className="w-56"
              />
            );
          case "userId":
            if (!people.canResolve) return null;
            return (
              <Select
                key={p}
                aria-label={label(p)}
                value={filters.userId}
                onChange={(e) => set(p, e.target.value)}
                className="w-56"
              >
                <option value="">{t("reports.allPeople")}</option>
                {[...people.byUserId.entries()]
                  .sort((a, b) => a[1].localeCompare(b[1], "vi"))
                  .map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
              </Select>
            );
          case "batchStatus":
            return (
              <Select
                key={p}
                aria-label={label(p)}
                value={filters.batchStatus}
                onChange={(e) => set(p, e.target.value)}
                className="w-48"
              >
                <option value="">{t("reports.allBatchStatuses")}</option>
                {paymentBatchStatusEnum.options.map((s) => (
                  <option key={s} value={s}>
                    {t(`paymentBatchStatus.${s}`)}
                  </option>
                ))}
              </Select>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
