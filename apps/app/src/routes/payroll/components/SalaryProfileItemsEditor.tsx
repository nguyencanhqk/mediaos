import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button, Checkbox, Input, Select } from "@mediaos/ui";
import type { SalaryComponentsCatalog } from "../use-salary-components-catalog";
import { EMPTY_SALARY_PROFILE_ITEM, type SalaryProfileItemDraft } from "../salary-profile-form";

/**
 * S15-PAYROLL-FE-1 — bảng `items[]` (phụ cấp / khấu trừ CÓ ĐỊNH MỨC) của form hồ sơ lương v2.
 *
 * ⚠️ **Không có ô gõ mã tự do.** Mã chỉ chọn từ catalog 044 đã lọc `profile_item` — server 422 018/019 với
 * mã ngoài catalog (nợ BE-1: ô «phụ cấp» nhập tay đã GỠ vì là lỗ tiền B1). Không có catalog (thiếu quyền)
 * ⇒ component này KHÔNG render; caller hiện câu giải thích và KHÔNG gửi `items` (luật 3 của
 * `salary-profile-form.ts`).
 *
 * Hàng lỗi (thiếu mã / định mức âm / trùng mã) tô viền đỏ theo `badIndexes` — thông điệp tổng ở form.
 */
export function SalaryProfileItemsEditor({
  items,
  onChange,
  catalog,
  badIndexes,
  disabled,
}: {
  items: readonly SalaryProfileItemDraft[];
  onChange: (next: SalaryProfileItemDraft[]) => void;
  catalog: SalaryComponentsCatalog;
  badIndexes: readonly number[];
  disabled?: boolean;
}) {
  const { t } = useTranslation("payroll");
  const bad = new Set(badIndexes);

  const update = (index: number, patch: Partial<SalaryProfileItemDraft>) =>
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));
  const add = () => onChange([...items, { ...EMPTY_SALARY_PROFILE_ITEM }]);

  return (
    <div className="space-y-2" data-testid="salary-profile-items-editor">
      {catalog.isTruncated && (
        <p className="text-xs text-warning">{t("salaryProfileForm.itemsCatalogTruncated")}</p>
      )}
      {catalog.isError && (
        <p className="text-xs text-danger">{t("salaryProfileForm.itemsCatalogError")}</p>
      )}
      {!catalog.isLoading && !catalog.isError && catalog.options.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("salaryProfileForm.itemsCatalogEmpty")}</p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("salaryProfileForm.itemsEmpty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1 pr-2 font-medium">{t("salaryProfileForm.itemComponent")}</th>
                <th className="pb-1 pr-2 font-medium">{t("salaryProfileForm.itemAmount")}</th>
                <th className="pb-1 pr-2 font-medium">{t("salaryProfileForm.itemActive")}</th>
                <th className="pb-1 pr-2 font-medium">{t("salaryProfileForm.itemNote")}</th>
                <th className="pb-1" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr
                  key={i}
                  className={bad.has(i) ? "outline outline-1 outline-danger/60" : undefined}
                  data-testid="salary-profile-item-row"
                >
                  <td className="py-1 pr-2">
                    <Select
                      value={item.componentCode}
                      onChange={(e) => update(i, { componentCode: e.target.value })}
                      disabled={disabled || catalog.isLoading}
                      aria-label={t("salaryProfileForm.itemComponent")}
                    >
                      <option value="">{t("salaryProfileForm.itemComponentPlaceholder")}</option>
                      {catalog.options.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      value={item.amount}
                      inputMode="numeric"
                      className="w-36 tabular-nums"
                      onChange={(e) => update(i, { amount: e.target.value })}
                      disabled={disabled}
                      aria-label={t("salaryProfileForm.itemAmount")}
                    />
                  </td>
                  <td className="py-1 pr-2 text-center">
                    <Checkbox
                      checked={item.isActive}
                      onChange={(e) => update(i, { isActive: e.target.checked })}
                      disabled={disabled}
                      aria-label={t("salaryProfileForm.itemActive")}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      value={item.note}
                      maxLength={500}
                      onChange={(e) => update(i, { note: e.target.value })}
                      disabled={disabled}
                      aria-label={t("salaryProfileForm.itemNote")}
                    />
                  </td>
                  <td className="py-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(i)}
                      disabled={disabled}
                      aria-label={t("salaryProfileForm.itemRemove")}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={disabled || catalog.isLoading || catalog.options.length === 0}
      >
        {t("salaryProfileForm.itemAdd")}
      </Button>
    </div>
  );
}
