import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  PAYROLL_SYS_REFS,
  pitPayerEnum,
  type PayrollSysRef,
  type PayrollTemplatePreviewRequest,
  type PitPayer,
  type StatutoryRateDto,
} from "@mediaos/contracts";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { PAYROLL_ENGINE_PAIRS } from "../constants";
import { parsePayrollError, payrollErrorText } from "../payroll-errors";
import { formatPayrollSignedMoney, PAYROLL_NUMERIC_CELL_CLASS } from "../payroll-format";
import type { TemplateRow } from "../template-editor";

/** Số thập phân dạng chuỗi mà 054 nhận (mirror `DECIMAL_STRING` của contracts). */
const DECIMAL_RE = /^-?\d{1,16}(\.\d{1,10})?$/;

/**
 * Đầu vào giả MẶC ĐỊNH — một nhân viên đi làm đủ 22 công, lương 10 triệu. `SYS_WORK_DAYS` PHẢI khác 0:
 * 054 coi khoá vắng là 0 ⇒ công thức chia cho ngày công ra 422 020 `division-by-zero` (SPEC-11 §15.1).
 */
export const PREVIEW_DEFAULT_INPUTS: Readonly<Record<PayrollSysRef, string>> = {
  SYS_BASE_SALARY: "10000000",
  SYS_INSURANCE_SALARY: "10000000",
  SYS_PROBATION_SALARY: "0",
  SYS_PAY_RATIO: "100",
  SYS_WORK_DAYS: "22",
  SYS_PRESENT_DAYS: "22",
  SYS_PAID_LEAVE_DAYS: "0",
  SYS_UNPAID_LEAVE_DAYS: "0",
  SYS_LATE_MINUTES: "0",
  SYS_PRORATE: "1",
  SYS_DEPENDENTS: "0",
  SYS_DAILY_RATE: "454545.4545",
  SYS_BONUS_AMOUNT: "0",
  SYS_PENALTY_AMOUNT: "0",
  SYS_ADVANCE_AMOUNT: "0",
};

/** Bản tỉ lệ ⇒ khối `statutory` của 054 (không `baseWage`/`minRegionWage` — `.strict()` ở contracts). */
export function statutoryForPreview(
  rate: StatutoryRateDto,
): PayrollTemplatePreviewRequest["statutory"] {
  return {
    siEmployeePct: rate.siEmployeePct,
    hiEmployeePct: rate.hiEmployeePct,
    uiEmployeePct: rate.uiEmployeePct,
    siEmployerPct: rate.siEmployerPct,
    hiEmployerPct: rate.hiEmployerPct,
    uiEmployerPct: rate.uiEmployerPct,
    unionEmployerPct: rate.unionEmployerPct,
    unionEmployeePct: rate.unionEmployeePct,
    siCap: rate.siCap,
    hiCap: rate.hiCap,
    uiCap: rate.uiCap,
    personalDeduction: rate.personalDeduction,
    dependentDeduction: rate.dependentDeduction,
    pitBrackets: rate.pitBrackets,
  };
}

/**
 * PAY-SCREEN-010 — «Xem trước» mẫu ĐÃ LƯU với dữ liệu GIẢ (054, `manage:payroll-template`). Không đọc dữ liệu
 * thật, không ghi, không audit.
 *
 * `statutory` điền sẵn từ bản tỉ lệ MỚI NHẤT (055, `view:statutory-rate`) — FE KHÔNG tự bịa số luật định
 * (SPEC-11 §3.11). Thiếu cặp đó ⇒ nói ra và khoá nút, không gửi số 0.
 */
export function TemplatePreviewDialog({
  open,
  onClose,
  templateId,
  rows,
}: {
  open: boolean;
  onClose: () => void;
  templateId: string;
  rows: readonly TemplateRow[];
}) {
  const { t } = useTranslation("payroll");
  const canViewRates = useCanExact(
    PAYROLL_ENGINE_PAIRS.statutoryRateList.action,
    PAYROLL_ENGINE_PAIRS.statutoryRateList.resourceType,
  );

  const profileCodes = useMemo(
    () => rows.filter((r) => r.valueType === "profile_item").map((r) => r.code),
    [rows],
  );
  const [inputs, setInputs] = useState<Record<string, string>>({ ...PREVIEW_DEFAULT_INPUTS });
  const [profileItems, setProfileItems] = useState<Record<string, string>>({});
  const [pitPayer, setPitPayer] = useState<PitPayer>("EMPLOYEE");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setProfileItems((prev) =>
      Object.fromEntries(profileCodes.map((code) => [code, prev[code] ?? "0"])),
    );
  }, [open, profileCodes]);

  const rateParams = { page: 1, per_page: 1 };
  const rateQuery = useQuery({
    queryKey: payrollKeys.catalog.statutoryRates(rateParams),
    queryFn: () => payrollApi.listStatutoryRates(rateParams),
    enabled: open && canViewRates,
  });
  const latestRate = rateQuery.data?.data[0];

  const allValid =
    Object.values(inputs).every((v) => DECIMAL_RE.test(v)) &&
    Object.values(profileItems).every((v) => DECIMAL_RE.test(v)) &&
    Number(inputs.SYS_WORK_DAYS) !== 0;

  const mutation = useMutation({
    mutationFn: () => {
      if (!latestRate) throw new Error("statutory-rate-unavailable");
      return payrollApi.previewPayrollTemplate(templateId, {
        inputs: inputs as Record<PayrollSysRef, string>,
        profileItems,
        pitPayer,
        statutory: statutoryForPreview(latestRate),
      });
    },
    onMutate: () => setError(null),
    onError: (e) => setError(payrollErrorText(t, parsePayrollError(e))),
  });
  const result = mutation.data;

  const orderedColumns = useMemo(
    () => [...(result?.columns ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [result],
  );

  const fieldClass = "block text-xs";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("templatePreview.title")}
      description={t("templatePreview.description")}
      className="max-w-4xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("actions.close")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!allValid || !latestRate || mutation.isPending}
          >
            {t("templatePreview.run")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {!canViewRates ? (
          <p className="rounded-md border border-warning/40 bg-warning-muted/40 px-3 py-2 text-sm">
            {t("templatePreview.needRates")}
          </p>
        ) : rateQuery.isSuccess && !latestRate ? (
          <p className="rounded-md border border-warning/40 bg-warning-muted/40 px-3 py-2 text-sm">
            {t("templatePreview.noRates")}
          </p>
        ) : latestRate ? (
          <p className="text-xs text-muted-foreground">
            {t("templatePreview.usingRate", { date: latestRate.effectiveFrom })}
          </p>
        ) : null}

        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t("templatePreview.inputsTitle")}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {PAYROLL_SYS_REFS.map((ref) => (
              <label key={ref} className={fieldClass}>
                <span className="mb-1 block font-mono text-muted-foreground">{ref}</span>
                <Input
                  value={inputs[ref] ?? ""}
                  inputMode="decimal"
                  onChange={(e) => setInputs((prev) => ({ ...prev, [ref]: e.target.value }))}
                  aria-invalid={!DECIMAL_RE.test(inputs[ref] ?? "")}
                  className="h-8 tabular-nums"
                />
              </label>
            ))}
            <label className={fieldClass}>
              <span className="mb-1 block text-muted-foreground">
                {t("templatePreview.pitPayer")}
              </span>
              <Select
                value={pitPayer}
                onChange={(e) => setPitPayer(e.target.value as PitPayer)}
                className="h-8"
              >
                {pitPayerEnum.options.map((p) => (
                  <option key={p} value={p}>
                    {t(`pitPayer.${p}`)}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </section>

        {profileCodes.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("templatePreview.profileItemsTitle")}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {profileCodes.map((code) => (
                <label key={code} className={fieldClass}>
                  <span className="mb-1 block font-mono text-muted-foreground">{code}</span>
                  <Input
                    value={profileItems[code] ?? ""}
                    inputMode="decimal"
                    onChange={(e) =>
                      setProfileItems((prev) => ({ ...prev, [code]: e.target.value }))
                    }
                    className="h-8 tabular-nums"
                  />
                </label>
              ))}
            </div>
          </section>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        {result && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("templatePreview.resultTitle")}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 font-medium">{t("templateEditor.code")}</th>
                    <th className="py-2 font-medium">{t("templateEditor.columnLabel")}</th>
                    <th className="py-2 font-medium">{t("templateEditor.component")}</th>
                    <th className="py-2 text-right font-medium">{t("templatePreview.value")}</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedColumns.map((col) => (
                    <tr
                      key={col.code}
                      className={
                        col.isVisible
                          ? "border-b border-border/60"
                          : "border-b border-border/60 opacity-60"
                      }
                    >
                      <td className="py-1.5 font-mono text-xs">{col.code}</td>
                      <td className="py-1.5">
                        {col.label}
                        {!col.isVisible && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {t("templatePreview.hidden")}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-muted-foreground">
                        {t(`componentKind.${col.kind}`)}
                      </td>
                      <td className={`py-1.5 ${PAYROLL_NUMERIC_CELL_CLASS}`}>
                        {formatPayrollSignedMoney(
                          result.values[col.code] === undefined
                            ? undefined
                            : Number(result.values[col.code]),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
}
