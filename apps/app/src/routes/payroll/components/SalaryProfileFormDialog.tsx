import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { payrollApi, payrollIdempotencyKey, payrollKeys } from "@mediaos/web-core";
import type { SalaryProfileDto } from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { parsePayrollError, payrollErrorText } from "../payroll-errors";
import type { PayrollPeopleLookup } from "../use-payroll-people";
import { useSalaryComponentsCatalog } from "../use-salary-components-catalog";
import {
  buildSalaryProfilePayload,
  buildSalaryProfileUpdatePayload,
  isLegacyAllowanceProfile,
  EMPTY_SALARY_PROFILE_FORM,
  salaryProfileFormFromDto,
  validateSalaryProfileEdit,
  validateSalaryProfileForm,
  type SalaryProfileFormState,
} from "../salary-profile-form";
import { SalaryProfileItemsEditor } from "./SalaryProfileItemsEditor";

/** Khoá đường đóng hộp (Esc / click ra ngoài) khi mutation đang bay — xem chỗ dùng ở `Dialog`. */
const NOOP = () => {};

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
 *
 * ── Chế độ SỬA (S15-PAYROLL-FE-5, PAYROLL-API-022) ───────────────────────────────────────────────
 * `profile ≠ null` ⇒ sửa phiên bản đó thay vì tạo mới. Cùng một hộp, cùng bộ ô — chỉ đổi nguồn state
 * (prefill từ DTO), nhãn, và **đường gửi**:
 *
 * 🔴 **PATCH 022 gửi DIFF, không gửi ảnh chụp form** (`buildSalaryProfileUpdatePayload`). Vắng khoá
 * `items` là hợp đồng của BE: "không chạm `salary_profile_items` và không chạm `allowances`". Gửi
 * nguyên form sẽ xoá sạch phụ cấp của phiên bản «di sản» trong im lặng — xem docblock
 * `salary-profile-form.ts` §S15-PAYROLL-FE-5.
 *
 * `userId` KHÔNG sửa được (schema 022 không có khoá); `effectiveDate` sửa được, trùng ⇒ 409 `014`.
 * Không `Idempotency-Key`: route 022 không `@Idempotent` (khác 020).
 */
export function SalaryProfileFormDialog({
  open,
  onClose,
  people,
  fixedUserId,
  fixedUserLabel,
  profile = null,
}: {
  open: boolean;
  onClose: () => void;
  people: PayrollPeopleLookup;
  fixedUserId?: string;
  fixedUserLabel?: string;
  /** `null` = tạo phiên bản mới; khác `null` = sửa chính phiên bản này (022). */
  profile?: SalaryProfileDto | null;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();
  const catalog = useSalaryComponentsCatalog(open);

  const isEdit = profile !== null;
  // Mốc so sánh của diff — dựng CÙNG hàm với prefill để "không đổi gì" thật sự ra payload rỗng.
  const initialForm = useMemo(
    () => (profile ? salaryProfileFormFromDto(profile) : EMPTY_SALARY_PROFILE_FORM),
    [profile],
  );
  // 🔴 Hồ sơ di sản ⇒ KHOÁ bảng phụ cấp: prefill không thấy `allowances` nên diff không bảo vệ được
  // chúng; gửi `items` ở đây là ghi đè mất tiền không nhìn thấy (xem `isLegacyAllowanceProfile`).
  const legacyAllowanceCount =
    profile && isLegacyAllowanceProfile(profile) ? (profile.allowances?.length ?? 0) : 0;
  const itemsLocked = legacyAllowanceCount > 0;
  const editOpts = { catalogAvailable: catalog.canResolve, itemsLocked };

  const [form, setForm] = useState<SalaryProfileFormState>(EMPTY_SALARY_PROFILE_FORM);
  const [submitted, setSubmitted] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    // Dọn ở CẢ HAI chiều: mở một phiên bản khác phải là phiên làm việc SẠCH, không mang theo lỗi hay
    // cờ `submitted` của lượt trước (không dựa vào việc chiều đóng đã dọn — thứ tự effect không phải
    // hợp đồng).
    setSubmitted(false);
    setErrorText(null);
    if (!open) {
      setForm(EMPTY_SALARY_PROFILE_FORM);
      return;
    }
    if (isEdit) {
      setForm(initialForm);
      return;
    }
    if (fixedUserId) setForm((prev) => ({ ...prev, userId: fixedUserId }));
  }, [open, fixedUserId, isEdit, initialForm]);

  const patch = (p: Partial<SalaryProfileFormState>) => setForm((prev) => ({ ...prev, ...p }));

  const validation = isEdit
    ? validateSalaryProfileEdit(initialForm, form, editOpts)
    : validateSalaryProfileForm(form, { catalogAvailable: catalog.canResolve });
  const canSubmit = validation.errors.length === 0;

  const onWritten = () => {
    void queryClient.invalidateQueries({ queryKey: payrollKeys.salaryProfiles.allOf() });
    // `hasSalaryProfile` của danh sách/chi tiết nhân sự (036/037) đổi theo.
    void queryClient.invalidateQueries({ queryKey: payrollKeys.employees.allOf() });
    onClose();
  };
  // `payrollErrorText` (không phải `t(payrollErrorI18nKey(...))`) — 422 của `items[]` mang `details[]`
  // chỉ MÃ thành phần sai; mất nội suy là người dùng không biết sửa dòng nào.
  const onFailed = (error: unknown) => setErrorText(payrollErrorText(t, parsePayrollError(error)));

  const mutation = useMutation({
    mutationFn: () => {
      if (profile) {
        return payrollApi.updateSalaryProfile(
          profile.id,
          buildSalaryProfileUpdatePayload(initialForm, form, editOpts),
        );
      }
      return payrollApi.createSalaryProfile(
        buildSalaryProfilePayload(form, { catalogAvailable: catalog.canResolve }),
        // Neo theo (người, ngày hiệu lực): đúng cặp UNIQUE của DB ⇒ bấm đúp là một bản ghi. KHÔNG PII.
        payrollIdempotencyKey("create-salary-profile", form.userId, form.effectiveDate),
      );
    },
    onSuccess: onWritten,
    onError: onFailed,
  });

  const submit = () => {
    setSubmitted(true);
    setErrorText(null);
    if (canSubmit) mutation.mutate();
  };

  const peopleOptions = [...people.byUserId.entries()];
  const showErrors = submitted && validation.errors.length > 0;

  return (
    <Dialog
      open={open}
      // 🔴 Esc và click-ra-ngoài của `Dialog` gọi `onClose` VÔ ĐIỀU KIỆN — khoá chúng khi đang gửi,
      // đúng như nút Huỷ (và như `ConfirmDialog` đã làm). Không khoá thì có đường mất dữ liệu câm:
      // Esc lúc PATCH của phiên bản A còn bay → mở sửa phiên bản B → A về đích → `onSuccess` gọi
      // `onClose()` → hộp đang hiện B **đóng sập**, nuốt luôn thứ người dùng vừa gõ cho B mà không
      // một lời báo (cùng một `useMutation` sống chung cho mọi lượt mở vì hộp không unmount).
      onClose={mutation.isPending ? NOOP : onClose}
      title={t(isEdit ? "salaryProfileForm.editTitle" : "salaryProfileForm.title")}
      description={t(
        isEdit ? "salaryProfileForm.editDescription" : "salaryProfileForm.description",
      )}
      className="max-w-3xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {t(isEdit ? "salaryProfileForm.editSubmit" : "salaryProfileForm.submit")}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* ── Nhân sự + ngày hiệu lực ── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("salaryProfileForm.employeeLabel")}
            hint={isEdit ? t("salaryProfileForm.editEmployeeLocked") : undefined}
          >
            {isEdit || fixedUserId ? (
              <Input value={fixedUserLabel ?? fixedUserId ?? form.userId} readOnly />
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
          {/* 🔴 Khoá TRƯỚC cả cổng catalog: hồ sơ di sản thì dù có quyền cũng không được sửa bảng này —
              bảng sẽ hiện RỖNG (prefill đọc `items`), nên mọi thao tác ở đây đều là ghi đè mù. */}
          {itemsLocked ? (
            <Hint>
              {t("salaryProfileForm.editItemsLegacyLocked", { count: legacyAllowanceCount })}
            </Hint>
          ) : catalog.canResolve ? (
            <>
              <SalaryProfileItemsEditor
                items={form.items}
                onChange={(items) => patch({ items })}
                catalog={catalog}
                badIndexes={submitted ? validation.badItemIndexes : []}
                disabled={mutation.isPending}
              />
              {/* Nói thẳng hợp đồng của 022: không đụng bảng này ⇒ khoá `items` vắng ⇒ BE giữ nguyên. */}
              {isEdit && <Hint>{t("salaryProfileForm.editItemsUntouched")}</Hint>}
            </>
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
        {errorText && (
          <p className="text-sm text-danger" role="alert">
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
