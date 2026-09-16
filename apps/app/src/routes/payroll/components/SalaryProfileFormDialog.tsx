import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { payrollApi, payrollIdempotencyKey, payrollKeys } from "@mediaos/web-core";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { parsePayrollError, payrollErrorI18nKey } from "../payroll-errors";
import type { PayrollPeopleLookup } from "../use-payroll-people";
import { useSalaryComponentsCatalog } from "../use-salary-components-catalog";
import {
  buildSalaryProfilePayload,
  EMPTY_SALARY_PROFILE_FORM,
  validateSalaryProfileForm,
  type SalaryProfileFormState,
} from "../salary-profile-form";
import { SalaryProfileItemsEditor } from "./SalaryProfileItemsEditor";

/**
 * PAY-SCREEN-004 / tab «Lịch sử lương» của PAY-SCREEN-007 — tạo **phiên bản mới** hồ sơ lương **v2**
 * (PAYROLL-API-020, `manage:salary-profile`).
 *
 * ⚠️ **Đây là "tạo phiên bản", KHÔNG phải "sửa lương".** Hồ sơ lương versioned theo `effective_date`
 * (PAY-DEC-003) — muốn đổi lương thì thêm bản mới hiệu lực từ ngày X. Trùng `(nhân sự, ngày)` ⇒ 409
 * `PAYROLL-ERR-014` — người dùng phải thấy câu giải thích.
 *
 * ── v2 (S15-PAYROLL-FE-1) ────────────────────────────────────────────────────────────────────────
 * Trường mới: `salaryType` GROSS/NET · `pitPayer` · `insuranceSalary` (trống = dùng lương cơ bản) ·
 * `probationSalary` · `payRatioPct` · **bảng `items[]`** chọn từ catalog 044 (`SalaryProfileItemsEditor`).
 * Toàn bộ luật parse/validate/build ở `salary-profile-form.ts` (thuần, có spec) — component này chỉ
 * giữ state và vẽ.
 *
 * ⚠️ Thiếu `view:salary-component` ⇒ KHÔNG hiện bảng phụ cấp và payload VẮNG `items` (không gửi `[]`
 * giả vờ). Vẫn tạo được phiên bản với lương cơ bản — hai cặp khác resource.
 *
 * `fixedUserId`: mở từ chi tiết nhân sự ⇒ người đã biết, ẩn ô chọn (không cần picker 034).
 */
export function SalaryProfileFormDialog({
  open,
  onClose,
  people,
  fixedUserId,
  fixedUserLabel,
}: {
  open: boolean;
  onClose: () => void;
  people: PayrollPeopleLookup;
  fixedUserId?: string;
  fixedUserLabel?: string;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();
  const catalog = useSalaryComponentsCatalog(open);

  const [form, setForm] = useState<SalaryProfileFormState>(EMPTY_SALARY_PROFILE_FORM);
  const [submitted, setSubmitted] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_SALARY_PROFILE_FORM);
      setSubmitted(false);
      setErrorKey(null);
      return;
    }
    if (fixedUserId) setForm((prev) => ({ ...prev, userId: fixedUserId }));
  }, [open, fixedUserId]);

  const patch = (p: Partial<SalaryProfileFormState>) => setForm((prev) => ({ ...prev, ...p }));

  const validation = validateSalaryProfileForm(form, { catalogAvailable: catalog.canResolve });
  const canSubmit = validation.errors.length === 0;

  const mutation = useMutation({
    mutationFn: () =>
      payrollApi.createSalaryProfile(
        buildSalaryProfilePayload(form, { catalogAvailable: catalog.canResolve }),
        // Neo theo (người, ngày hiệu lực): đúng cặp UNIQUE của DB ⇒ bấm đúp là một bản ghi. KHÔNG PII.
        payrollIdempotencyKey("create-salary-profile", form.userId, form.effectiveDate),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: payrollKeys.salaryProfiles.allOf() });
      // `hasSalaryProfile` của danh sách/chi tiết nhân sự (036/037) đổi theo.
      void queryClient.invalidateQueries({ queryKey: payrollKeys.employees.allOf() });
      onClose();
    },
    onError: (error) => setErrorKey(payrollErrorI18nKey(parsePayrollError(error))),
  });

  const submit = () => {
    setSubmitted(true);
    setErrorKey(null);
    if (canSubmit) mutation.mutate();
  };

  const peopleOptions = [...people.byUserId.entries()];
  const showErrors = submitted && validation.errors.length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("salaryProfileForm.title")}
      description={t("salaryProfileForm.description")}
      className="max-w-3xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {t("salaryProfileForm.submit")}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* ── Nhân sự + ngày hiệu lực ── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("salaryProfileForm.employeeLabel")}>
            {fixedUserId ? (
              <Input value={fixedUserLabel ?? fixedUserId} readOnly />
            ) : (
              <>
                <Select
                  value={form.userId}
                  onChange={(e) => patch({ userId: e.target.value })}
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
                  <Hint tone="danger">{t("salaryProfileForm.pickerNoPermission")}</Hint>
                )}
              </>
            )}
          </Field>
          <Field
            label={t("salaryProfileForm.effectiveDateLabel")}
            hint={t("salaryProfileForm.effectiveDateHint")}
          >
            <Input
              type="date"
              value={form.effectiveDate}
              onChange={(e) => patch({ effectiveDate: e.target.value })}
            />
          </Field>
        </div>

        {/* ── Mức lương ── */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">{t("salaryProfileForm.sectionBasic")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("salaryProfileForm.baseSalaryLabel")}>
              <Input
                value={form.baseSalary}
                inputMode="numeric"
                className="tabular-nums"
                onChange={(e) => patch({ baseSalary: e.target.value })}
              />
            </Field>
            <Field
              label={t("salaryProfileForm.salaryTypeLabel")}
              hint={t("salaryProfileForm.salaryTypeHint")}
            >
              <Select
                value={form.salaryType}
                onChange={(e) => patch({ salaryType: e.target.value as "GROSS" | "NET" })}
              >
                <option value="GROSS">{t("salaryType.GROSS")}</option>
                <option value="NET">{t("salaryType.NET")}</option>
              </Select>
            </Field>
            <Field
              label={t("salaryProfileForm.probationSalaryLabel")}
              hint={t("salaryProfileForm.probationSalaryHint")}
            >
              <Input
                value={form.probationSalary}
                inputMode="numeric"
                className="tabular-nums"
                onChange={(e) => patch({ probationSalary: e.target.value })}
              />
            </Field>
            <Field
              label={t("salaryProfileForm.payRatioLabel")}
              hint={t("salaryProfileForm.payRatioHint")}
            >
              <Input
                value={form.payRatioPct}
                inputMode="decimal"
                className="tabular-nums"
                onChange={(e) => patch({ payRatioPct: e.target.value })}
              />
            </Field>
          </div>
        </fieldset>

        {/* ── Bảo hiểm · thuế ── */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">
            {t("salaryProfileForm.sectionStatutory")}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("salaryProfileForm.insuranceSalaryLabel")}
              hint={t("salaryProfileForm.insuranceSalaryHint")}
            >
              <Input
                value={form.insuranceSalary}
                inputMode="numeric"
                className="tabular-nums"
                onChange={(e) => patch({ insuranceSalary: e.target.value })}
              />
            </Field>
            <Field label={t("salaryProfileForm.pitPayerLabel")}>
              <Select
                value={form.pitPayer}
                onChange={(e) => patch({ pitPayer: e.target.value as "EMPLOYEE" | "COMPANY" })}
              >
                <option value="EMPLOYEE">{t("pitPayer.EMPLOYEE")}</option>
                <option value="COMPANY">{t("pitPayer.COMPANY")}</option>
              </Select>
            </Field>
          </div>
        </fieldset>

        {/* ── Phụ cấp / khấu trừ có định mức ── */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">{t("salaryProfileForm.sectionItems")}</legend>
          {catalog.canResolve ? (
            <SalaryProfileItemsEditor
              items={form.items}
              onChange={(items) => patch({ items })}
              catalog={catalog}
              badIndexes={submitted ? validation.badItemIndexes : []}
              disabled={mutation.isPending}
            />
          ) : (
            <Hint>{t("salaryProfileForm.itemsCatalogNoPermission")}</Hint>
          )}
        </fieldset>

        <Field label={t("salaryProfileForm.noteLabel")}>
          <textarea
            rows={2}
            value={form.note}
            onChange={(e) => patch({ note: e.target.value })}
            maxLength={500}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </Field>

        {showErrors && (
          <ul className="space-y-1 text-sm text-danger" role="alert">
            {validation.errors.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        )}
        {errorKey && (
          <p className="text-sm text-danger" role="alert">
            {t(errorKey)}
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
      {hint && <Hint>{hint}</Hint>}
    </label>
  );
}

function Hint({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" }) {
  return (
    <span
      className={`mt-1 block text-xs ${tone === "danger" ? "text-danger" : "text-muted-foreground"}`}
    >
      {children}
    </span>
  );
}
