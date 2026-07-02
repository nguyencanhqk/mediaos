import { useTranslation } from "react-i18next";
import { type FieldValues, type Path, type UseFormReturn, type FieldError } from "react-hook-form";
import { Input, Select } from "@mediaos/ui";

/**
 * Field helpers dùng chung cho form dữ liệu gốc HR — S2-FE-HR-5 (lane HR5-SCREENS).
 * RHF register + hiển thị lỗi inline (message của lỗi là i18n key → resolve qua t).
 */

/** Resolve message lỗi RHF (là i18n key) → chuỗi hiển thị. */
function useFieldError() {
  const { t } = useTranslation("hr");
  return (err: FieldError | undefined): string | undefined =>
    err ? t(err.message ?? "") : undefined;
}

function FieldShell({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField<TValues extends FieldValues>({
  form,
  name,
  label,
  required,
  type = "text",
  disabled,
}: {
  form: UseFormReturn<TValues>;
  name: Path<TValues>;
  label: string;
  required?: boolean;
  type?: "text" | "number";
  /** Vô hiệu hoá field (vd trường immutable sau khi tạo — code của loại nghỉ/chính sách). */
  disabled?: boolean;
}) {
  const resolveErr = useFieldError();
  const err = form.formState.errors[name] as FieldError | undefined;
  return (
    <FieldShell id={name} label={label} required={required} error={resolveErr(err)}>
      <Input
        id={name}
        type={type}
        autoComplete="off"
        disabled={disabled}
        {...form.register(name, type === "number" ? { valueAsNumber: false } : undefined)}
      />
    </FieldShell>
  );
}

export function StatusField<TValues extends FieldValues>({
  form,
  name,
}: {
  form: UseFormReturn<TValues>;
  name: Path<TValues>;
}) {
  const { t } = useTranslation("hr");
  return (
    <FieldShell id={name} label={t("masterData.common.fields.status")}>
      <Select id={name} {...form.register(name)}>
        <option value="active">{t("masterData.common.status.active")}</option>
        <option value="inactive">{t("masterData.common.status.inactive")}</option>
      </Select>
    </FieldShell>
  );
}

export function SelectField<TValues extends FieldValues>({
  form,
  name,
  label,
  options,
  includeNone = true,
}: {
  form: UseFormReturn<TValues>;
  name: Path<TValues>;
  label: string;
  options: readonly { value: string; label: string }[];
  includeNone?: boolean;
}) {
  const { t } = useTranslation("hr");
  return (
    <FieldShell id={name} label={label}>
      <Select id={name} {...form.register(name)}>
        {includeNone && <option value="">{t("masterData.common.placeholders.none")}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </FieldShell>
  );
}

export function CheckboxField<TValues extends FieldValues>({
  form,
  name,
  label,
}: {
  form: UseFormReturn<TValues>;
  name: Path<TValues>;
  label: string;
}) {
  return (
    <label htmlFor={name} className="flex items-center gap-2 text-sm text-foreground">
      <input
        id={name}
        type="checkbox"
        className="h-4 w-4 rounded border-border"
        {...form.register(name)}
      />
      {label}
    </label>
  );
}
