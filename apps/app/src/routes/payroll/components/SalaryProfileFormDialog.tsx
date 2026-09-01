import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { payrollApi, payrollIdempotencyKey, payrollKeys } from "@mediaos/web-core";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { parsePayrollError, payrollErrorI18nKey } from "../payroll-errors";
import type { PayrollPeopleLookup } from "../use-payroll-people";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * PAY-SCREEN-004 — tạo **phiên bản mới** hồ sơ lương (PAYROLL-API-020, `manage:salary-profile`).
 *
 * ⚠️ **Đây là "tạo phiên bản", KHÔNG phải "sửa lương".** Hồ sơ lương versioned theo `effective_date`
 * (PAY-DEC-003) — muốn đổi lương thì thêm bản mới hiệu lực từ ngày X, không sửa bản cũ. Bản cũ mà kỳ đã
 * tính tham chiếu vẫn an toàn vì snapshot đã ĐÓNG BĂNG lúc `calculate`. Vì thế form này chỉ có đường
 * TẠO; sửa/xoá mềm nằm ở hàng trong bảng (PAYROLL-API-022, `delete: true`).
 *
 * ⚠️ Trùng `(nhân sự, ngày hiệu lực)` ⇒ 409 `PAYROLL-ERR-014` — người dùng phải thấy câu giải thích chứ
 * không phải "Đã có lỗi xảy ra".
 *
 * ⚠️ Chọn người qua **picker 034** (`view:salary-profile`), KHÔNG qua API HR: `payroll-officer` giữ 0
 * cặp ngoài PAYROLL. Picker và form này gác bằng hai cặp cùng resource `salary-profile` nên luôn
 * mở/đóng cùng nhau.
 *
 * `allowances` là mảng `{name, amount}` — v1 nhập tối giản một dòng phụ cấp; mảng rỗng là hợp lệ
 * (contracts `.default([])`).
 */
export function SalaryProfileFormDialog({
  open,
  onClose,
  people,
}: {
  open: boolean;
  onClose: () => void;
  people: PayrollPeopleLookup;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();

  const [userId, setUserId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [baseSalary, setBaseSalary] = useState("");
  const [allowanceName, setAllowanceName] = useState("");
  const [allowanceAmount, setAllowanceAmount] = useState("");
  const [note, setNote] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setUserId("");
      setEffectiveDate("");
      setBaseSalary("");
      setAllowanceName("");
      setAllowanceAmount("");
      setNote("");
      setErrorKey(null);
    }
  }, [open]);

  const parsedBase = Number(baseSalary);
  const parsedAllowance = Number(allowanceAmount);
  // `baseSalary > 0` mirror CHECK `salary_profile_base_positive_check` — gửi 0 là 23514 = 500.
  const baseValid = baseSalary.trim() !== "" && Number.isFinite(parsedBase) && parsedBase > 0;
  const allowanceValid =
    allowanceName.trim() === ""
      ? allowanceAmount.trim() === ""
      : Number.isFinite(parsedAllowance) && parsedAllowance >= 0;
  const canSubmit = userId !== "" && DATE_RE.test(effectiveDate) && baseValid && allowanceValid;

  const mutation = useMutation({
    mutationFn: () =>
      payrollApi.createSalaryProfile(
        {
          userId,
          effectiveDate,
          baseSalary: parsedBase,
          allowances: allowanceName.trim()
            ? [{ name: allowanceName.trim(), amount: parsedAllowance }]
            : [],
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        // Neo theo (người, ngày hiệu lực): đúng cặp mà UNIQUE của DB ràng buộc ⇒ bấm đúp là một bản ghi.
        payrollIdempotencyKey("create-salary-profile", userId, effectiveDate),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: payrollKeys.salaryProfiles.allOf() });
      onClose();
    },
    onError: (error) => setErrorKey(payrollErrorI18nKey(parsePayrollError(error))),
  });

  const peopleOptions = [...people.byUserId.entries()];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("salaryProfileForm.title")}
      description={t("salaryProfileForm.description")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
            {t("salaryProfileForm.submit")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("salaryProfileForm.employeeLabel")}</span>
          <Select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={people.isLoading}
          >
            <option value="">{t("salaryProfileForm.employeePlaceholder")}</option>
            {peopleOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
          {!people.canResolve && (
            <span className="mt-1 block text-xs text-danger">
              {t("salaryProfileForm.pickerNoPermission")}
            </span>
          )}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">
            {t("salaryProfileForm.effectiveDateLabel")}
          </span>
          <Input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("salaryProfileForm.effectiveDateHint")}
          </span>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("salaryProfileForm.baseSalaryLabel")}</span>
          <Input
            value={baseSalary}
            inputMode="numeric"
            onChange={(e) => setBaseSalary(e.target.value)}
            className="tabular-nums"
          />
          {baseSalary !== "" && !baseValid && (
            <span className="mt-1 block text-xs text-danger">
              {t("salaryProfileForm.baseSalaryInvalid")}
            </span>
          )}
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("salaryProfileForm.allowanceLegend")}</legend>
          <div className="flex gap-2">
            <Input
              placeholder={t("salaryProfileForm.allowanceName")}
              value={allowanceName}
              onChange={(e) => setAllowanceName(e.target.value)}
            />
            <Input
              placeholder={t("salaryProfileForm.allowanceAmount")}
              value={allowanceAmount}
              inputMode="numeric"
              onChange={(e) => setAllowanceAmount(e.target.value)}
              className="tabular-nums"
            />
          </div>
          {!allowanceValid && (
            <span className="block text-xs text-danger">
              {t("salaryProfileForm.allowanceInvalid")}
            </span>
          )}
        </fieldset>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("salaryProfileForm.noteLabel")}</span>
          <textarea
            rows={2}
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
