import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  salaryComponentInputKindEnum,
  salaryComponentInputValueTypeEnum,
  type SalaryComponentDto,
  type UpdateSalaryComponentRequest,
} from "@mediaos/contracts";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import { Button, Checkbox, Dialog, Input, Select } from "@mediaos/ui";
import { parsePayrollError, payrollErrorText } from "../payroll-errors";
import { FormulaEditor } from "./FormulaEditor";

type InputKind = (typeof salaryComponentInputKindEnum.options)[number];
type InputValueType = (typeof salaryComponentInputValueTypeEnum.options)[number];

const CODE_RE = /^[A-Z][A-Z0-9_]{0,31}$/;
const MONEY_MAX = 999_999_999_999.99;

interface FormState {
  code: string;
  name: string;
  kind: InputKind;
  valueType: InputValueType;
  formula: string;
  fixedAmount: string;
  pitDeductible: boolean;
  isActive: boolean;
  sortOrder: string;
}

const EMPTY: FormState = {
  code: "",
  name: "",
  kind: "earning",
  valueType: "formula",
  formula: "",
  fixedAmount: "",
  pitDeductible: false,
  isActive: true,
  sortOrder: "0",
};

function fromDto(c: SalaryComponentDto): FormState {
  const kindParsed = salaryComponentInputKindEnum.safeParse(c.kind);
  const vtParsed = salaryComponentInputValueTypeEnum.safeParse(c.valueType);
  return {
    code: c.code,
    name: c.name,
    kind: kindParsed.success ? kindParsed.data : "earning",
    valueType: vtParsed.success ? vtParsed.data : "formula",
    formula: c.formula ?? "",
    fixedAmount: c.fixedAmount === null ? "" : String(c.fixedAmount),
    pitDeductible: c.pitDeductible,
    isActive: c.isActive,
    sortOrder: String(c.sortOrder),
  };
}

/** Làm tròn về xu — contracts ép `multipleOf(0.01)`. */
const toMoney = (raw: string): number | null => {
  const n = Number(raw.replace(/\s/g, ""));
  if (raw.trim() === "" || !Number.isFinite(n) || n < 0 || n > MONEY_MAX) return null;
  return Math.round(n * 100) / 100;
};

/**
 * PAY-SCREEN-009 — tạo (045) / sửa (047) một thành phần lương.
 *
 * - **Hàng hệ thống (D4):** chỉ `name`/`sortOrder` mở — trigger 0570 + BE-2 M1 trả 409
 *   `system-component-immutable` cho trường khác; khoá sẵn thay vì mời người dùng ăn lỗi. `code` BẤT BIẾN
 *   với mọi hàng (đổi mã làm gãy mọi công thức tham chiếu).
 * - **Hộp xác nhận (D5):** thành phần ĐANG được mẫu dùng (`usedByTemplates` của 046) mà đổi cách tính ⇒
 *   nêu số mẫu và phạm vi ảnh hưởng (kỳ chưa chốt dùng cách tính mới ở lần tính kế tiếp) TRƯỚC khi gửi.
 * - PATCH chỉ gửi trường ĐÃ ĐỔI; đổi `valueType` gửi kèm cặp `formula`/`fixedAmount` khớp CHECK
 *   `value_pair` (server kiểm trên hàng SAU MERGE ⇒ 422 `component-value-pair`).
 */
export function SalaryComponentFormDialog({
  open,
  onClose,
  component,
  knownCodes,
  canValidate,
}: {
  open: boolean;
  onClose: () => void;
  /** `null` = tạo mới. */
  component: SalaryComponentDto | null;
  knownCodes: readonly string[];
  canValidate: boolean;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();
  const isEdit = component !== null;
  const isSystem = component?.isSystem ?? false;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(component ? fromDto(component) : EMPTY);
    setConfirming(false);
    setError(null);
  }, [open, component]);

  const detailQuery = useQuery({
    queryKey: payrollKeys.catalog.componentDetail(component?.id ?? ""),
    queryFn: () => payrollApi.getSalaryComponent(component?.id ?? ""),
    enabled: open && component !== null && !component.isSystem,
  });
  const usedBy = detailQuery.data?.usedByTemplates ?? [];

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setConfirming(false);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const sortOrderNum = Number(form.sortOrder);
  const sortOrderValid = Number.isInteger(sortOrderNum) && sortOrderNum >= 0;
  const money = toMoney(form.fixedAmount);
  const codeValid = isEdit || CODE_RE.test(form.code);
  const valueValid =
    isSystem ||
    (form.valueType === "formula" && form.formula.trim() !== "") ||
    (form.valueType === "fixed" && money !== null) ||
    form.valueType === "profile_item";
  // Chưa biết `usedByTemplates` thì chưa quyết được có cần hộp xác nhận (D5) ⇒ khoá nút tới khi 046 về.
  const detailPending = isEdit && !isSystem && detailQuery.isLoading;
  const canSubmit =
    codeValid && form.name.trim() !== "" && sortOrderValid && valueValid && !detailPending;

  const patch = useMemo<UpdateSalaryComponentRequest>(() => {
    if (!component) return {};
    const out: UpdateSalaryComponentRequest = {};
    if (form.name.trim() !== component.name) out.name = form.name.trim();
    if (sortOrderValid && sortOrderNum !== component.sortOrder) out.sortOrder = sortOrderNum;
    if (isSystem) return out;
    if (form.kind !== component.kind) out.kind = form.kind;
    if (form.pitDeductible !== component.pitDeductible) out.pitDeductible = form.pitDeductible;
    if (form.isActive !== component.isActive) out.isActive = form.isActive;
    const nextFormula = form.valueType === "formula" ? form.formula : null;
    const nextFixed = form.valueType === "fixed" ? money : null;
    if (form.valueType !== component.valueType) out.valueType = form.valueType;
    if (nextFormula !== component.formula || out.valueType) out.formula = nextFormula;
    if (nextFixed !== component.fixedAmount || out.valueType) out.fixedAmount = nextFixed;
    return out;
  }, [component, form, isSystem, money, sortOrderNum, sortOrderValid]);

  const changesCalculation =
    "kind" in patch ||
    "valueType" in patch ||
    "formula" in patch ||
    "fixedAmount" in patch ||
    "pitDeductible" in patch;

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: payrollKeys.catalog.allOf() });

  const mutation = useMutation({
    mutationFn: () => {
      if (component) return payrollApi.updateSalaryComponent(component.id, patch);
      return payrollApi.createSalaryComponent({
        code: form.code,
        name: form.name.trim(),
        kind: form.kind,
        valueType: form.valueType,
        ...(form.valueType === "formula" ? { formula: form.formula } : {}),
        ...(form.valueType === "fixed" && money !== null ? { fixedAmount: money } : {}),
        pitDeductible: form.pitDeductible,
        isActive: form.isActive,
        sortOrder: sortOrderNum,
      });
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (e) => {
      setConfirming(false);
      setError(payrollErrorText(t, parsePayrollError(e)));
    },
  });

  const submit = () => {
    setError(null);
    if (isEdit && Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    if (isEdit && changesCalculation && usedBy.length > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    mutation.mutate();
  };

  const lockCalc = isSystem;

  return (
    <Dialog
      open={open}
      onClose={mutation.isPending ? () => {} : onClose}
      title={isEdit ? t("componentForm.editTitle") : t("componentForm.title")}
      className="max-w-2xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit || mutation.isPending}>
            {confirming ? t("componentForm.confirmSave") : t("componentForm.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {isSystem && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            {t("componentForm.systemHint")}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("componentForm.codeLabel")}</span>
            <Input
              value={form.code}
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              disabled={isEdit}
              className="font-mono"
              maxLength={32}
            />
            {!codeValid && form.code !== "" && (
              <span className="mt-1 block text-xs text-danger">
                {t("componentForm.codeInvalid")}
              </span>
            )}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("componentForm.nameLabel")}</span>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              maxLength={200}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("componentForm.kindLabel")}</span>
            <Select
              value={form.kind}
              onChange={(e) => set("kind", e.target.value as InputKind)}
              disabled={lockCalc}
            >
              {salaryComponentInputKindEnum.options.map((k) => (
                <option key={k} value={k}>
                  {t(`componentKind.${k}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("componentForm.valueTypeLabel")}</span>
            <Select
              value={form.valueType}
              onChange={(e) => set("valueType", e.target.value as InputValueType)}
              disabled={lockCalc}
            >
              {salaryComponentInputValueTypeEnum.options.map((v) => (
                <option key={v} value={v}>
                  {t(`componentValueType.${v}`)}
                </option>
              ))}
            </Select>
          </label>
        </div>

        {form.valueType === "formula" && (
          <FormulaEditor
            label={t("componentForm.formulaLabel")}
            value={form.formula}
            onChange={(v) => set("formula", v)}
            knownCodes={knownCodes}
            canValidate={canValidate && !lockCalc}
            disabled={lockCalc}
            context={{
              kind: form.kind,
              pitDeductible: form.pitDeductible,
              ...(CODE_RE.test(form.code) ? { componentCode: form.code } : {}),
            }}
          />
        )}

        {form.valueType === "fixed" && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("componentForm.fixedAmountLabel")}</span>
            <Input
              value={form.fixedAmount}
              inputMode="decimal"
              onChange={(e) => set("fixedAmount", e.target.value)}
              disabled={lockCalc}
              className="tabular-nums"
            />
            {form.fixedAmount !== "" && money === null && (
              <span className="mt-1 block text-xs text-danger">
                {t("componentForm.fixedAmountInvalid")}
              </span>
            )}
          </label>
        )}

        {form.valueType === "profile_item" && (
          <p className="text-xs text-muted-foreground">{t("componentForm.profileItemHint")}</p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.pitDeductible}
              onChange={(e) => set("pitDeductible", e.target.checked)}
              disabled={lockCalc}
            />
            {t("componentForm.pitDeductibleLabel")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.isActive}
              onChange={(e) => set("isActive", e.target.checked)}
              disabled={lockCalc}
            />
            {t("componentForm.isActiveLabel")}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("componentForm.sortOrderLabel")}</span>
            <Input
              type="number"
              min={0}
              value={form.sortOrder}
              onChange={(e) => set("sortOrder", e.target.value)}
            />
          </label>
        </div>

        {isEdit && !isSystem && usedBy.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("componentForm.usedBy", {
              count: usedBy.length,
              names: usedBy.map((u) => u.name).join(", "),
            })}
          </p>
        )}

        {confirming && (
          <div
            role="alert"
            className="rounded-md border border-warning/40 bg-warning-muted/40 px-3 py-2 text-sm"
          >
            {t("componentForm.impactWarning", { count: usedBy.length })}
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
