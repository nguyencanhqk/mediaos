import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import type { SalaryProfileDto, SalaryProfileListItemDto } from "@mediaos/contracts";
import { StatusPill } from "@mediaos/ui";
import { formatPayrollMoney, PAYROLL_NUMERIC_CELL_CLASS } from "../../payroll-format";

/**
 * Một phiên bản hồ sơ lương trên timeline «Lịch sử lương» — **gập được**, tải chi tiết 021 **khi mở**.
 *
 * ⚠️ KHÔNG prefetch chi tiết mọi phiên bản «cho nhanh»: 021 ghi audit lượt xem (SPEC-11 §18.1) — một
 * timeline 20 phiên bản mở trang là 20 hàng audit giả (UI-07 §21.8 lưu ý 6). Chỉ đọc khi người dùng bấm.
 *
 * ⚠️ Trường tiền có thể VẮNG KHOÁ (server mask theo cặp) — `formatPayrollMoney` ra `—`, không `0 ₫`.
 * `items[]` vs `allowances[]`: đường đọc trả NGUYÊN cả hai, không hoà giải (expand-contract, BE-1);
 * hồ sơ v1 chưa qua đường ghi v2 có `allowances` mà 0 `items` ⇒ băng «di sản» để người dùng biết cần
 * tạo phiên bản mới qua catalog.
 */
export function SalaryProfileVersionCard({
  profile,
  isCurrent,
  expanded,
  onToggle,
}: {
  profile: SalaryProfileListItemDto;
  isCurrent: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation("payroll");
  const detailQuery = useQuery({
    queryKey: payrollKeys.salaryProfiles.detail(profile.id),
    queryFn: () => payrollApi.getSalaryProfile(profile.id),
    enabled: expanded,
  });

  return (
    <li className="rounded-md border border-border" data-testid="salary-version-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        title={expanded ? t("salaryHistory.collapse") : t("salaryHistory.expand")}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-sm hover:bg-accent/40"
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium">
          {t("salaryHistory.effectiveFrom", { date: profile.effectiveDate })}
        </span>
        {isCurrent && <StatusPill tone="success" label={t("salaryHistory.current")} />}
        <span className={`${PAYROLL_NUMERIC_CELL_CLASS} ml-auto`}>
          {formatPayrollMoney(profile.baseSalary)}
        </span>
        {profile.salaryType && (
          <span className="text-xs text-muted-foreground">
            {t(`salaryType.${profile.salaryType}`)}
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3 text-sm">
          {detailQuery.isLoading && (
            <p className="text-muted-foreground">{t("salaryHistory.loadingDetail")}</p>
          )}
          {detailQuery.isError && <p className="text-danger">{t("salaryHistory.detailError")}</p>}
          {detailQuery.data && <VersionDetail detail={detailQuery.data} />}
        </div>
      )}
    </li>
  );
}

function VersionDetail({ detail }: { detail: SalaryProfileDto }) {
  const { t } = useTranslation("payroll");
  const items = detail.items ?? [];
  const legacyCount = detail.allowances?.length ?? 0;

  const facts: Array<[string, string]> = [
    [t("salaryHistory.baseSalary"), formatPayrollMoney(detail.baseSalary)],
    [t("salaryHistory.salaryType"), detail.salaryType ? t(`salaryType.${detail.salaryType}`) : "—"],
    [t("salaryHistory.pitPayer"), detail.pitPayer ? t(`pitPayer.${detail.pitPayer}`) : "—"],
    [
      t("salaryHistory.insuranceSalary"),
      detail.insuranceSalary === null
        ? t("salaryHistory.insuranceUseBase")
        : formatPayrollMoney(detail.insuranceSalary),
    ],
    [
      t("salaryHistory.probationSalary"),
      // `null` = KHÔNG áp dụng (D8) ≠ `undefined` = server mask ⇒ `—`; gộp hai vế là người có quyền
      // không phân biệt được «không có lương thử việc» với «bị ẩn».
      detail.probationSalary === null
        ? t("salaryHistory.probationNone")
        : formatPayrollMoney(detail.probationSalary),
    ],
    [
      t("salaryHistory.payRatio"),
      detail.payRatioPct === undefined ? "—" : `${detail.payRatioPct}%`,
    ],
  ];

  return (
    <div className="space-y-4">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
        {detail.note && (
          <div className="sm:col-span-3">
            <dt className="text-xs text-muted-foreground">{t("salaryHistory.note")}</dt>
            <dd>{detail.note}</dd>
          </div>
        )}
      </dl>

      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
          {t("salaryHistory.items")}
        </h4>
        {items.length === 0 ? (
          <p className="text-muted-foreground">{t("salaryHistory.itemsEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-1 pr-3 font-medium">
                    {t("salaryHistory.itemColumns.component")}
                  </th>
                  <th className="pb-1 pr-3 text-right font-medium">
                    {t("salaryHistory.itemColumns.amount")}
                  </th>
                  <th className="pb-1 pr-3 font-medium">{t("salaryHistory.itemColumns.source")}</th>
                  <th className="pb-1 font-medium">{t("salaryHistory.itemColumns.status")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-border/60">
                    <td className="py-1 pr-3">
                      <span className="font-mono text-xs">{item.componentCode}</span>
                      {item.componentName && <span className="ml-2">{item.componentName}</span>}
                      {item.note && !item.componentName && (
                        <span className="ml-2 text-muted-foreground">{item.note}</span>
                      )}
                    </td>
                    <td className={`py-1 pr-3 ${PAYROLL_NUMERIC_CELL_CLASS}`}>
                      {formatPayrollMoney(item.amount)}
                    </td>
                    <td className="py-1 pr-3">
                      {item.componentName === null
                        ? t("salaryHistory.itemSource.legacy")
                        : t("salaryHistory.itemSource.catalog")}
                    </td>
                    <td className="py-1">
                      <StatusPill
                        hideDot
                        tone={item.isActive ? "success" : "muted"}
                        label={
                          item.isActive
                            ? t("salaryHistory.itemStatus.active")
                            : t("salaryHistory.itemStatus.inactive")
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {legacyCount > 0 && items.length === 0 && (
          <p className="mt-2 text-xs text-warning">
            {t("salaryHistory.legacyAllowances", { count: legacyCount })}
          </p>
        )}
      </div>
    </div>
  );
}
