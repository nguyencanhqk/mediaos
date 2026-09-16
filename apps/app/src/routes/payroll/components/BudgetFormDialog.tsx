import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import type { PayrollBudgetDto } from "@mediaos/contracts";
import { Button, Dialog, Input } from "@mediaos/ui";
import { parsePayrollError, payrollErrorI18nKey } from "../payroll-errors";
import { UnitSelector } from "./UnitSelector";

const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

/**
 * PAY-SCREEN-014 — tạo (074) / sửa (075) một dòng ngân sách lương (`manage:payroll-budget`).
 *
 * ⚠️ **`fiscalYear`/`orgUnitId` KHÔNG đổi được khi sửa** (mirror BE — muốn khác thì tạo hàng mới, đây
 * là chìa khoá tự nhiên `(fiscalYear, orgUnitId)`, trùng ⇒ 409 `budget-exists`). Hai ô khoá lại thay vì
 * ẩn để người sửa vẫn thấy đang sửa ngân sách của năm/đơn vị nào.
 */
export function BudgetFormDialog({
  open,
  onClose,
  budget,
  defaultFiscalYear,
  defaultOrgUnitId,
}: {
  open: boolean;
  onClose: () => void;
  /** `null` = tạo mới; khác `null` = sửa. */
  budget: PayrollBudgetDto | null;
  defaultFiscalYear: number;
  defaultOrgUnitId: string | null;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();
  const isEdit = budget !== null;

  const [fiscalYear, setFiscalYear] = useState(defaultFiscalYear);
  const [orgUnitId, setOrgUnitId] = useState(defaultOrgUnitId ?? "");
  const [plannedAmount, setPlannedAmount] = useState("");
  const [note, setNote] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setErrorKey(null);
      return;
    }
    if (budget) {
      setFiscalYear(budget.fiscalYear);
      setOrgUnitId(budget.orgUnitId ?? "");
      setPlannedAmount(budget.plannedAmount !== undefined ? String(budget.plannedAmount) : "");
      setNote(budget.note ?? "");
    } else {
      setFiscalYear(defaultFiscalYear);
      setOrgUnitId(defaultOrgUnitId ?? "");
      setPlannedAmount("");
      setNote("");
    }
  }, [open, budget, defaultFiscalYear, defaultOrgUnitId]);

  const yearValid =
    Number.isInteger(fiscalYear) && fiscalYear >= YEAR_MIN && fiscalYear <= YEAR_MAX;
  const parsedPlanned = Number(plannedAmount);
  const plannedValid =
    plannedAmount.trim() !== "" && Number.isFinite(parsedPlanned) && parsedPlanned >= 0;
  const canSubmit = yearValid && plannedValid;

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit && budget) {
        return payrollApi.updatePayrollBudget(budget.id, {
          plannedAmount: parsedPlanned,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
      }
      return payrollApi.createPayrollBudget({
        fiscalYear,
        orgUnitId: orgUnitId || null,
        plannedAmount: parsedPlanned,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: payrollKeys.budgets.allOf() });
      onClose();
    },
    onError: (error) => setErrorKey(payrollErrorI18nKey(parsePayrollError(error))),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? t("budgetForm.editTitle") : t("budgetForm.title")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
            {isEdit ? t("budgetForm.save") : t("budgetForm.submit")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("budgetForm.yearLabel")}</span>
          <Input
            type="number"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(Number(e.target.value))}
            disabled={isEdit}
          />
          {!yearValid && (
            <span className="mt-1 block text-xs text-danger">{t("budgetForm.yearInvalid")}</span>
          )}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("budgetForm.unitLabel")}</span>
          <UnitSelector value={orgUnitId} onChange={setOrgUnitId} disabled={isEdit} />
          {isEdit && (
            <span className="mt-1 block text-xs text-muted-foreground">
              {t("budgetForm.unitHint")}
            </span>
          )}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("budgetForm.plannedLabel")}</span>
          <Input
            value={plannedAmount}
            inputMode="numeric"
            onChange={(e) => setPlannedAmount(e.target.value)}
            className="tabular-nums"
          />
          {plannedAmount !== "" && !plannedValid && (
            <span className="mt-1 block text-xs text-danger">{t("budgetForm.plannedInvalid")}</span>
          )}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("budgetForm.noteLabel")}</span>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        {errorKey && <p className="text-sm text-danger">{t(errorKey)}</p>}
      </div>
    </Dialog>
  );
}
