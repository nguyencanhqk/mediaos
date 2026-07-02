import { useTranslation } from "react-i18next";
import { type FieldValues, type Path, type UseFormReturn, type FieldError } from "react-hook-form";
import { Input } from "@mediaos/ui";

/**
 * Field helpers riêng cho form Hợp đồng nhân viên (date/textarea không có sẵn ở
 * ../departments/master-data-fields — TextField ở đó chỉ hỗ trợ text|number). S2-FE-HR-7.
 */
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

export function DateField<TValues extends FieldValues>({
  form,
  name,
  label,
  required,
}: {
  form: UseFormReturn<TValues>;
  name: Path<TValues>;
  label: string;
  required?: boolean;
}) {
  const resolveErr = useFieldError();
  const err = form.formState.errors[name] as FieldError | undefined;
  return (
    <FieldShell id={name} label={label} required={required} error={resolveErr(err)}>
      <Input id={name} type="date" {...form.register(name)} />
    </FieldShell>
  );
}

export function TextAreaField<TValues extends FieldValues>({
  form,
  name,
  label,
}: {
  form: UseFormReturn<TValues>;
  name: Path<TValues>;
  label: string;
}) {
  return (
    <FieldShell id={name} label={label}>
      <textarea
        id={name}
        rows={3}
        {...form.register(name)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </FieldShell>
  );
}
