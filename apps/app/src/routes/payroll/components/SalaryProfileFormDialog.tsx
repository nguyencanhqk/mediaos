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
 * 🔻 **S15-PAYROLL-BE-1 — ô «phụ cấp» nhập TAY đã GỠ, có chủ đích.** v1 cho gõ tự do
 * `{name, amount}` rồi ghi thẳng vào `salary_profiles.allowances`, và cột đó là **đầu vào tính lương**
 * (`payroll-calc.repository.ts` cộng MỌI phần tử vào `gross`). v2 đóng đường đó: phụ cấp/khấu trừ phải
 * tham chiếu **mã trong catalog `salary_components`** và server kiểm `value_type='profile_item'` trước
 * khi ghi (422 `PAYROLL-ERR-018`) — một cái tên gõ tay không kiểm được là đúng lỗ tiền mà v2 sinh ra để
 * bịt. Vì `PAYROLL-API-044` (catalog thành phần lương) thuộc `S15-PAYROLL-BE-2`, form này **CHƯA có
 * picker mã** ⇒ tạm gửi `items: []`.
 *
 * ⚠️ **KHÔNG để lại ô nhập rồi lặng lẽ bỏ payload** — đó là `ui-promises-backend-never-reads`: người
 * dùng gõ số, bấm Lưu, hệ thống báo thành công và **không lưu gì**. Thà không có ô còn hơn có ô dối.
 * `S15-PAYROLL-FE-1` dựng lại form v2 đầy đủ (GROSS/NET · đối tượng TNCN · lương BH · thử việc · tỉ lệ
 * hưởng · bảng phụ cấp/khấu trừ CÓ ĐỊNH MỨC chọn từ catalog).
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
  const [note, setNote] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setUserId("");
      setEffectiveDate("");
      setBaseSalary("");
      setNote("");
      setErrorKey(null);
    }
  }, [open]);

  const parsedBase = Number(baseSalary);
  // `baseSalary > 0` mirror CHECK `salary_profile_base_positive_check` — gửi 0 là 23514 = 500.
  const baseValid = baseSalary.trim() !== "" && Number.isFinite(parsedBase) && parsedBase > 0;
  const canSubmit = userId !== "" && DATE_RE.test(effectiveDate) && baseValid;

  const mutation = useMutation({
    mutationFn: () =>
      payrollApi.createSalaryProfile(
        {
          userId,
          effectiveDate,
          baseSalary: parsedBase,
          // Rỗng cho tới khi FE-1 có picker catalog — xem docblock đầu file.
          items: [],
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
