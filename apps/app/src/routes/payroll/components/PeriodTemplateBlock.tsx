import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { PayrollPeriodDto } from "@mediaos/contracts";
import { payrollApi, payrollKeys, useCan, useCanExact } from "@mediaos/web-core";
import { Button, Select } from "@mediaos/ui";
import { BINDABLE_TEMPLATE_QUERY, PAYROLL_ENGINE_PAIRS } from "../constants";
import { canChangePeriodTemplate, TEMPLATE_EDITABLE_STATUSES } from "../payroll-actions";
import { isPayrollStateConflict, parsePayrollError, payrollErrorText } from "../payroll-errors";

/**
 * PAY-SCREEN-002 v2 — khối «Mẫu bảng lương» của chi tiết kỳ (S15-PAYROLL-FE-2, D10).
 *
 * - Tên mẫu lấy qua 051 (cùng khoá cache với `useTemplateDrift`) — chỉ khi có `view:payroll-template`; thiếu
 *   cặp thì nói «đã gắn», KHÔNG đoán tên.
 * - Nút «Gắn/Đổi mẫu» ẨN khi `canChangePeriodTemplate` sai (FSM ∩ quyền) — không hiện rồi 409.
 * - Kỳ chưa gắn mẫu ở trạng thái còn gắn được ⇒ băng nhắc: `calculate` sẽ 409 `template-missing`.
 */
export function PeriodTemplateBlock({
  period,
  onChanged,
}: {
  period: PayrollPeriodDto;
  onChanged: () => void;
}) {
  const { t } = useTranslation("payroll");
  const canViewTemplates = useCanExact(
    PAYROLL_ENGINE_PAIRS.templateList.action,
    PAYROLL_ENGINE_PAIRS.templateList.resourceType,
  );
  const canManagePeriod = useCan(
    PAYROLL_ENGINE_PAIRS.periodUpdate.action,
    PAYROLL_ENGINE_PAIRS.periodUpdate.resourceType,
  );
  const canChange = canChangePeriodTemplate(period, canManagePeriod, canViewTemplates);

  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);

  const templateId = period.templateId;
  const currentQuery = useQuery({
    queryKey: payrollKeys.catalog.templateDetail(templateId ?? ""),
    queryFn: () => payrollApi.getPayrollTemplate(templateId ?? ""),
    enabled: canViewTemplates && templateId !== null,
  });
  const optionsQuery = useQuery({
    queryKey: payrollKeys.catalog.templates(BINDABLE_TEMPLATE_QUERY),
    queryFn: () => payrollApi.listPayrollTemplates(BINDABLE_TEMPLATE_QUERY),
    enabled: editing && canChange,
  });
  const options = optionsQuery.data?.data ?? [];

  const mutation = useMutation({
    mutationFn: (id: string) => payrollApi.updatePeriod(period.id, { templateId: id }),
    onMutate: () => setError(null),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: (e) => {
      const info = parsePayrollError(e);
      setError(payrollErrorText(t, info));
      if (isPayrollStateConflict(info)) onChanged();
    },
  });

  const currentLabel =
    templateId === null
      ? t("periodTemplate.none")
      : !canViewTemplates
        ? t("periodTemplate.boundHidden")
        : currentQuery.data
          ? `${currentQuery.data.name} (${currentQuery.data.code})`
          : currentQuery.isError
            ? t("periodTemplate.boundHidden")
            : t("states.loading");

  const missing = templateId === null && TEMPLATE_EDITABLE_STATUSES.has(period.status);

  return (
    <section
      className="space-y-2 rounded-md border border-border px-4 py-3"
      data-testid="period-template-block"
    >
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">{t("periodTemplate.label")}</span>
        {!editing && <span className="font-medium">{currentLabel}</span>}
        {!editing && canChange && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSelected(templateId ?? "");
              setEditing(true);
            }}
          >
            {templateId === null ? t("periodTemplate.bind") : t("periodTemplate.change")}
          </Button>
        )}
        {editing && (
          <>
            <Select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-72"
              disabled={optionsQuery.isLoading}
              aria-label={t("periodTemplate.label")}
            >
              <option value="">{t("periodTemplate.choose")}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.code})
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              onClick={() => mutation.mutate(selected)}
              disabled={selected === "" || selected === templateId || mutation.isPending}
            >
              {t("periodTemplate.save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t("actions.cancel")}
            </Button>
          </>
        )}
      </div>
      {editing && !optionsQuery.isLoading && options.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("periodTemplate.noOptions")}</p>
      )}
      {missing && (
        <p className="text-xs text-warning" role="note">
          {t("periodTemplate.missingWarning")}
        </p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  );
}
