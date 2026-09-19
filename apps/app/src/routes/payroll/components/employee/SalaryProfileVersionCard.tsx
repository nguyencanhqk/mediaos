import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import type { SalaryProfileDto, SalaryProfileListItemDto } from "@mediaos/contracts";
import { Button, StatusPill } from "@mediaos/ui";
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
 *
 * ── Sửa / xoá (S15-PAYROLL-FE-5, PAYROLL-API-022) ────────────────────────────────────────────────
 * Hai nút nằm **trong thân đã mở**, không ở hàng tiêu đề. Ba lý do (plan §2 D1): hàng tiêu đề CHÍNH LÀ
 * một `<button>` (lồng thẻ là HTML sai) · form sửa cần `items[]`/`payRatioPct`… vốn chỉ có ở 021 nên
 * mở thân xong là dữ liệu prefill **đã có trong tay** · và không phải prefetch 021 cho mọi phiên bản
 * (mỗi lượt 021 là một hàng audit «đã xem lương» — đúng bẫy FE-1 đã ăn ở `payroll-period-tabs`).
 *
 * 🔴 `baseSalary` VẮNG KHOÁ (server mask) ⇒ **không mọc nút Sửa**: prefill sẽ ra ô trống và người dùng
 * hoặc phải gõ lại lương mù, hoặc ghi đè bằng số họ đoán. Xoá vẫn mọc — payload `{delete:true}` không
 * mang giá trị nào nên không có gì để ghi sai.
 */
export function SalaryProfileVersionCard({
  profile,
  isCurrent,
  expanded,
  onToggle,
  canManage,
  onEdit,
  onDelete,
}: {
  profile: SalaryProfileListItemDto;
  isCurrent: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** `manage:salary-profile` (cặp SENSITIVE — đo bằng `useCanExact` ở tab cha). */
  canManage: boolean;
  onEdit: (detail: SalaryProfileDto) => void;
  onDelete: () => void;
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
          {detailQuery.data && (
            <>
              <VersionDetail detail={detailQuery.data} />
              {canManage && (
                <VersionActions detail={detailQuery.data} onEdit={onEdit} onDelete={onDelete} />
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * 🔴 Tiền của phiên bản có hiện đủ hay không — điều kiện để cho sửa (plan §2 D6). Mục đích: ô trống vì
 * bị mask mà người dùng gõ một số đoán vào thì diff coi là ĐỔI ⇒ PATCH đè lên giá trị thật đang giấu.
 *
 * Chỉ đo được bằng trường nào VẮNG KHOÁ **chỉ khi** bị mask. Đúng hai trường như vậy, cả hai nằm thẳng
 * trong `when(canSeeMoney, …)` và KHÔNG có null-guard: `baseSalary` (`payroll.mapper.ts:88`, DB CHECK
 * giữ `> 0` nên không bao giờ NULL) và `items[].amount` (`:68`).
 *
 * ⚠️ **ĐỪNG thêm `insuranceSalary` / `probationSalary` / `payRatioPct` vào đây.** Mapper gộp `null`
 * THÀNH vắng khoá (`:91-96`, `:105`), mà `null` là trạng thái THƯỜNG («dùng lương cơ bản» — DB-13
 * §12.1). Thêm vào ⇒ nút Sửa biến mất ở gần như MỌI hồ sơ, chứ không phải chỉ khi mask. Ba trường đó
 * được che bởi lớp khác: không đụng tới thì diff không sinh khoá, nên không có gì để ghi đè.
 *
 * Hôm nay masking là tất-cả-hoặc-không ở mức route (021 không thuộc `MONEY_FREE_ROUTES`) nên `baseSalary`
 * một mình đã đủ; `items[].amount` giữ sẵn cho trường hợp cờ mask đi theo từng dòng.
 */
function isFullyVisible(detail: SalaryProfileDto): boolean {
  if (detail.baseSalary === undefined) return false;
  return (detail.items ?? []).every((item) => item.amount !== undefined);
}

function VersionActions({
  detail,
  onEdit,
  onDelete,
}: {
  detail: SalaryProfileDto;
  onEdit: (detail: SalaryProfileDto) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("payroll");
  const canEdit = isFullyVisible(detail);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
      {canEdit ? (
        <Button size="sm" variant="outline" onClick={() => onEdit(detail)}>
          <Pencil className="mr-2 size-4" />
          {t("salaryHistory.edit")}
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">{t("salaryHistory.editMasked")}</span>
      )}
      <Button size="sm" variant="ghost" className="text-danger" onClick={onDelete}>
        <Trash2 className="mr-2 size-4" />
        {t("salaryHistory.delete")}
      </Button>
    </div>
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
