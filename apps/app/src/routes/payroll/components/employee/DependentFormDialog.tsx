import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import type { DependentRelationship, PayrollDependentDto } from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { parsePayrollError, payrollErrorI18nKey } from "../../payroll-errors";
import {
  buildCreateDependentPayload,
  buildUpdateDependentPayload,
  DEPENDENT_DELETE_PAYLOAD,
  dependentFormFromDto,
  EMPTY_DEPENDENT_FORM,
  validateDependentForm,
  type DependentFormState,
} from "./employee-forms";

const RELATIONSHIPS: readonly DependentRelationship[] = ["Child", "Spouse", "Parent", "Other"];

/**
 * Thêm / sửa / xoá mềm người phụ thuộc (PAYROLL-API-041/042, `manage:payroll-employee`).
 *
 * ⚠️ Chồng lấp khoảng hiệu lực cùng NPT ⇒ **409 `dependent-overlap`** (chốt cuối `EXCLUDE USING gist`) —
 * thông điệp phải nói sửa ngày nào, không «Đã có lỗi». Route GHI trả 0 khoá PII ⇒ đóng dialog rồi
 * invalidate `employees.dependents(userId)` để tab đọc lại 040.
 *
 * Xoá = hai lần bấm (nút đổi nhãn «Bấm lần nữa để xác nhận»), không `window.confirm` (không test được,
 * không i18n).
 */
export function DependentFormDialog({
  open,
  onClose,
  userId,
  dependent,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** `null` = tạo mới. */
  dependent: PayrollDependentDto | null;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();
  const [form, setForm] = useState<DependentFormState>(EMPTY_DEPENDENT_FORM);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) {
      setErrorText(null);
      setConfirmDelete(false);
      return;
    }
    setForm(dependent ? dependentFormFromDto(dependent) : EMPTY_DEPENDENT_FORM);
  }, [open, dependent]);

  const patch = (p: Partial<DependentFormState>) => setForm((prev) => ({ ...prev, ...p }));

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: payrollKeys.employees.dependents(userId) });
    onClose();
  };
  const fail = (error: unknown) => setErrorText(t(payrollErrorI18nKey(parsePayrollError(error))));

  const saveMutation = useMutation({
    mutationFn: () =>
      dependent
        ? payrollApi.updateDependent(dependent.id, buildUpdateDependentPayload(form))
        : payrollApi.createDependent(userId, buildCreateDependentPayload(form)),
    onSuccess: done,
    onError: fail,
  });
  const deleteMutation = useMutation({
    mutationFn: () => payrollApi.updateDependent(dependent?.id ?? "", DEPENDENT_DELETE_PAYLOAD),
    onSuccess: done,
    onError: fail,
  });

  const submit = () => {
    const err = validateDependentForm(form);
    if (err) {
      setErrorText(t(err));
      return;
    }
    setErrorText(null);
    saveMutation.mutate();
  };
  const onDeleteClick = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteMutation.mutate();
  };

  const pending = saveMutation.isPending || deleteMutation.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={dependent ? t("dependentForm.titleEdit") : t("dependentForm.titleCreate")}
      description={t("dependentForm.description")}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div>
            {dependent && (
              <Button
                variant="ghost"
                className="text-danger"
                onClick={onDeleteClick}
                disabled={pending}
                data-testid="dependent-delete"
              >
                {confirmDelete ? t("dependentForm.deleteConfirm") : t("dependentForm.delete")}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              {t("actions.cancel")}
            </Button>
            <Button onClick={submit} disabled={pending}>
              {dependent ? t("dependentForm.submitEdit") : t("dependentForm.submitCreate")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("dependentForm.fullName")}>
          <Input
            value={form.fullName}
            maxLength={200}
            onChange={(e) => patch({ fullName: e.target.value })}
          />
        </Field>
        <Field label={t("dependentForm.relationship")}>
          <Select
            value={form.relationship}
            onChange={(e) => patch({ relationship: e.target.value as DependentRelationship })}
          >
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {t(`relationship.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dependentForm.taxCode")}>
          <Input
            value={form.dependentTaxCode}
            maxLength={20}
            onChange={(e) => patch({ dependentTaxCode: e.target.value })}
          />
        </Field>
        <Field label={t("dependentForm.dateOfBirth")}>
          <Input
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => patch({ dateOfBirth: e.target.value })}
          />
        </Field>
        <Field label={t("dependentForm.effectiveFrom")}>
          <Input
            type="date"
            value={form.effectiveFrom}
            onChange={(e) => patch({ effectiveFrom: e.target.value })}
          />
        </Field>
        <Field label={t("dependentForm.effectiveTo")} hint={t("dependentForm.effectiveToHint")}>
          <Input
            type="date"
            value={form.effectiveTo}
            onChange={(e) => patch({ effectiveTo: e.target.value })}
          />
        </Field>
        {errorText && (
          <p className="text-sm text-danger sm:col-span-2" role="alert">
            {errorText}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
