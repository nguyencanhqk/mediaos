import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { orgApi } from "@mediaos/web-core";
import { Select } from "@mediaos/ui";
import { flattenDepartments, indentLabel } from "../../hr/org-chart/org-chart-lookups";

/**
 * S15-PAYROLL-FE-1 — `UnitSelector` (UI-07 §10.4 mục 11): bộ lọc theo `org_unit` cho toolbar chuẩn.
 *
 * ── VÌ SAO Ở `routes/payroll/components` CHỨ KHÔNG `packages/ui` ─────────────────────────────────
 * UI-07 §26 v1.1a ghi: component «buộc vào route/registry/i18n/API của một app ⇒ app-local». Cái này gọi
 * `orgApi.getTree()` (dữ liệu runtime) nên không lên `packages/ui` được; và `packages/ui` ngoài `paths`
 * của WO. Nó là consumer ĐẦU TIÊN — có consumer thứ hai (báo cáo/ngân sách ở FE-3/FE-4) thì kéo lên
 * `apps/app/src/components/` chứ đừng copy.
 *
 * ── QUYỀN ────────────────────────────────────────────────────────────────────────────────────────
 * `GET /org/units/tree` MỞ cho mọi user tenant (`TENANT_READ`, KHÔNG PermissionGuard — `org.controller.ts`
 * §"cơ cấu ≠ người"): cây đơn vị không phải dữ liệu nhân viên. FE không gate thêm — vai tới được màn
 * PAYROLL dùng nó đã ở scope Company (SPEC-11 §11.3). «Tập đơn vị bám data scope» của UI-07 là việc server
 * lọc khi có scope hẹp hơn; FE không tự suy scope (`dash-widget-gate-needs-scope-floor`).
 *
 * ⚠️ Lọc KHỚP CHÍNH XÁC một đơn vị, KHÔNG đệ quy cây con — 036 quyết định vậy (plan BE-1 §9.3); mở rộng
 * ngầm ở FE là đổi phạm vi mà không ai đo được.
 */
export function UnitSelector({
  value,
  onChange,
  className,
  disabled,
}: {
  value: string;
  onChange: (orgUnitId: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation("payroll");
  const treeQuery = useQuery({
    queryKey: ["org", "units", "tree"],
    queryFn: () => orgApi.getTree(),
    staleTime: 5 * 60 * 1000,
  });

  const options = useMemo(() => flattenDepartments(treeQuery.data ?? []), [treeQuery.data]);

  return (
    <Select
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t("unitSelector.label")}
      disabled={disabled || treeQuery.isLoading}
      data-testid="unit-selector"
    >
      <option value="">{t("unitSelector.all")}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {indentLabel(o.name, o.depth)}
        </option>
      ))}
    </Select>
  );
}
