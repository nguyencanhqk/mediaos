import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import { Button, Checkbox, EmptyState, Input } from "@mediaos/ui";
import { parsePayrollError, payrollErrorI18nKey } from "../../payroll-errors";
import {
  buildEmployeeSettingsPayload,
  settingsFormFromDto,
  validateEmployeeSettings,
  type EmployeeSettingsFormState,
} from "./employee-forms";

/**
 * Tab «Bảo hiểm – Công đoàn» (PAY-SCREEN-007) — đọc 038 (`view:payroll-employee`), ghi 039
 * (`manage:payroll-employee`, upsert MERGE).
 *
 * ⚠️ **Số TK chỉ hiện `•••• {last4}`** ở mọi màn (SPEC-11 §3.12 · §18.1 A) — DTO không có số đầy đủ nên
 * không render được dù muốn. Ô nhập số TK là WRITE-ONLY: trống = giữ số cũ (VẮNG KHOÁ), «Xoá TK» = 4
 * khoá `null` — luật ở `employee-forms.ts`.
 *
 * 039 trả envelope 0 khoá PII ⇒ sau khi lưu invalidate `employees.settings(userId)` và ĐỌC LẠI 038.
 */
export function EmployeeInsuranceTab({
  userId,
  canManage,
}: {
  userId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EmployeeSettingsFormState | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const settingsQuery = useQuery({
    queryKey: payrollKeys.employees.settings(userId),
    queryFn: () => payrollApi.getEmployeeSettings(userId),
  });
  const dto = settingsQuery.data ?? null;
  const hasExistingBank = dto?.bankAccountLast4 !== null && dto?.bankAccountLast4 !== undefined;

  const mutation = useMutation({
    mutationFn: (state: EmployeeSettingsFormState) =>
      payrollApi.putEmployeeSettings(userId, buildEmployeeSettingsPayload(state)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: payrollKeys.employees.settings(userId) });
      setEditing(false);
      setForm(null);
      setFeedback({ tone: "ok", text: t("insurance.saved") });
    },
    onError: (error) =>
      setFeedback({ tone: "error", text: t(payrollErrorI18nKey(parsePayrollError(error))) }),
  });

  const startEdit = () => {
    setForm(settingsFormFromDto(dto));
    setFeedback(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setForm(null);
  };
  const submit = () => {
    if (!form) return;
    const err = validateEmployeeSettings(form, hasExistingBank);
    if (err) {
      setFeedback({ tone: "error", text: t(err) });
      return;
    }
    setFeedback(null);
    mutation.mutate(form);
  };

  if (settingsQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">{t("states.loading")}</p>;
  }
  if (settingsQuery.isError || dto === null) {
    return (
      <EmptyState
        title={t("states.error")}
        action={
          <Button variant="outline" onClick={() => void settingsQuery.refetch()}>
            {t("states.retry")}
          </Button>
        }
      />
    );
  }

  const yesNo = (v: boolean) => (v ? t("insurance.yes") : t("insurance.no"));
  const masked = dto.bankAccountLast4
    ? t("insurance.bankAccountMasked", { last4: dto.bankAccountLast4 })
    : t("insurance.bankAccountNone");

  return (
    <div className="space-y-4" data-testid="employee-insurance-tab">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("insurance.description")}</p>
        {canManage && !editing && (
          <Button size="sm" variant="outline" onClick={startEdit}>
            <Pencil className="mr-2 size-4" />
            {t("insurance.edit")}
          </Button>
        )}
      </div>

      {feedback && (
        <div
          role="status"
          className={`rounded-md border px-4 py-2 text-sm ${
            feedback.tone === "ok"
              ? "border-success/40 bg-success-muted/40"
              : "border-danger/40 bg-danger-muted/40"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {!editing || form === null ? (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Fact label={t("insurance.joinsSocialInsurance")}>{yesNo(dto.joinsSocialInsurance)}</Fact>
          <Fact label={t("insurance.socialInsuranceNo")}>
            {dto.socialInsuranceNo ?? t("insurance.notSet")}
          </Fact>
          <Fact label={t("insurance.joinsUnion")}>{yesNo(dto.joinsUnion)}</Fact>
          <Fact label={t("insurance.bankAccount")}>
            <span className="tabular-nums" data-testid="bank-account-masked">
              {masked}
            </span>
          </Fact>
          <Fact label={t("insurance.bankName")}>{dto.bankName ?? t("insurance.notSet")}</Fact>
          <Fact label={t("insurance.bankBranch")}>{dto.bankBranch ?? t("insurance.notSet")}</Fact>
          <Fact label={t("insurance.accountHolder")}>
            {dto.accountHolder ?? t("insurance.notSet")}
          </Fact>
        </dl>
      ) : (
        <SettingsForm
          form={form}
          onChange={setForm}
          masked={masked}
          pending={mutation.isPending}
          onCancel={cancelEdit}
          onSubmit={submit}
        />
      )}
    </div>
  );
}

function SettingsForm({
  form,
  onChange,
  masked,
  pending,
  onCancel,
  onSubmit,
}: {
  form: EmployeeSettingsFormState;
  onChange: (next: EmployeeSettingsFormState) => void;
  masked: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation("payroll");
  const patch = (p: Partial<EmployeeSettingsFormState>) => onChange({ ...form, ...p });

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      data-testid="employee-settings-form"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={form.joinsSocialInsurance}
            onChange={(e) => patch({ joinsSocialInsurance: e.target.checked })}
          />
          {t("insurance.joinsSocialInsurance")}
        </label>
        <Field label={t("insurance.socialInsuranceNo")}>
          <Input
            value={form.socialInsuranceNo}
            maxLength={50}
            onChange={(e) => patch({ socialInsuranceNo: e.target.value })}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={form.joinsUnion}
            onChange={(e) => patch({ joinsUnion: e.target.checked })}
          />
          {t("insurance.joinsUnion")}
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{t("insurance.bankSection")}</legend>
        <p className="text-xs text-muted-foreground">
          {t("insurance.bankAccount")}: <span className="tabular-nums">{masked}</span>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("insurance.bankAccountNumberNew")}
            hint={t("insurance.bankAccountNumberHint")}
          >
            <Input
              value={form.bankAccountNumber}
              inputMode="numeric"
              maxLength={50}
              autoComplete="off"
              disabled={form.clearBank}
              onChange={(e) => patch({ bankAccountNumber: e.target.value })}
            />
          </Field>
          <Field label={t("insurance.bankName")}>
            <Input
              value={form.bankName}
              maxLength={200}
              disabled={form.clearBank}
              onChange={(e) => patch({ bankName: e.target.value })}
            />
          </Field>
          <Field label={t("insurance.bankBranch")}>
            <Input
              value={form.bankBranch}
              maxLength={200}
              disabled={form.clearBank}
              onChange={(e) => patch({ bankBranch: e.target.value })}
            />
          </Field>
          <Field label={t("insurance.accountHolder")}>
            <Input
              value={form.accountHolder}
              maxLength={200}
              disabled={form.clearBank}
              onChange={(e) => patch({ accountHolder: e.target.value })}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-danger">
          <Checkbox
            checked={form.clearBank}
            onChange={(e) => patch({ clearBank: e.target.checked })}
          />
          {t("insurance.clearBank")}
        </label>
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          {t("actions.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {t("insurance.save")}
        </Button>
      </div>
    </form>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
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
