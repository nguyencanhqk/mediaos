/**
 * AdjustmentRequestForm — form tạo đơn điều chỉnh công (ATT-SCREEN-006, S3-FE-ATT-3, P0).
 * RHF + Zod (adjustment-form-schema.ts). Permission thật: create-own:adjustment — non-sensitive, gate ở
 * CreateAdjustmentRequestPage (useCan an toàn, KHÔNG rơi vào trap sensitive-KHÔNG-allowlisted).
 */
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { FileEdit } from "lucide-react";
import { ApiError } from "@mediaos/web-core";
import { Button, Card, CardContent, Input, Select } from "@mediaos/ui";
import {
  CHECK_IN_REQUEST_TYPES,
  CHECK_OUT_REQUEST_TYPES,
  ADJUSTMENT_REQUEST_TYPE_LABEL_KEYS,
} from "./constants";
import {
  adjustmentFormSchema,
  EMPTY_ADJUSTMENT_FORM,
  toCreateAdjustmentBody,
  type AdjustmentFormValues,
} from "./adjustment-form-schema";
import { useCreateAdjustmentRequest } from "./hooks/useAdjustmentRequests";

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">
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

// ─── Main form component ──────────────────────────────────────────────────────

export interface AdjustmentRequestFormProps {
  onSuccess: (id: string) => void;
  onCancel: () => void;
}

export function AdjustmentRequestForm({ onSuccess, onCancel }: AdjustmentRequestFormProps) {
  const { t } = useTranslation("attendance");

  const form = useForm<AdjustmentFormValues>({
    resolver: zodResolver(adjustmentFormSchema),
    defaultValues: EMPTY_ADJUSTMENT_FORM,
    mode: "onBlur",
  });
  const { control, register, watch, handleSubmit, formState } = form;
  const { errors, isSubmitting } = formState;

  const requestType = watch("requestType");
  const needsCheckIn = CHECK_IN_REQUEST_TYPES.has(requestType);
  const needsCheckOut = CHECK_OUT_REQUEST_TYPES.has(requestType);

  const createMutation = useCreateAdjustmentRequest();

  function fieldError(err: { message?: string } | undefined): string | undefined {
    return err ? t(err.message ?? "", { defaultValue: err.message ?? "" }) : undefined;
  }

  function mapApiError(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.status === 403) return t("form.errors.forbidden");
      if (err.status === 409) return t("form.errors.conflict");
      if (err.status === 422 || err.status === 400) return t("form.errors.validation");
      if (err.status >= 500) return t("form.errors.server");
    }
    return t("form.errors.generic");
  }

  async function onSubmit(values: AdjustmentFormValues) {
    try {
      const result = await createMutation.mutateAsync(toCreateAdjustmentBody(values));
      onSuccess(result.id);
    } catch {
      // Lỗi đã có trong createMutation.error → hiển thị qua globalError bên dưới, KHÔNG throw tiếp.
    }
  }

  const globalError = createMutation.error ? mapApiError(createMutation.error) : null;

  return (
    <form
      onSubmit={handleSubmit((v) => {
        void onSubmit(v);
      })}
      noValidate
    >
      <div className="space-y-6">
        {globalError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {globalError}
          </div>
        )}

        <Card>
          <CardContent className="space-y-4 pt-5">
            <Field
              label={t("adjustment.form.fields.requestType")}
              required
              error={fieldError(errors.requestType)}
            >
              <Controller
                control={control}
                name="requestType"
                render={({ field }) => (
                  <Select {...field} aria-label={t("adjustment.form.fields.requestType")}>
                    {ADJUSTMENT_REQUEST_TYPE_LABEL_KEYS.map((rt) => (
                      <option key={rt} value={rt}>
                        {t(`adjustment.requestType.${rt}`)}
                      </option>
                    ))}
                  </Select>
                )}
              />
            </Field>

            <Field
              label={t("adjustment.form.fields.workDate")}
              required
              error={fieldError(errors.workDate)}
            >
              <Input
                type="date"
                {...register("workDate")}
                aria-label={t("adjustment.form.fields.workDate")}
              />
            </Field>

            {needsCheckIn && (
              <Field
                label={t("adjustment.form.fields.requestedCheckInAt")}
                required
                error={fieldError(errors.requestedCheckInAt)}
              >
                <Input
                  type="datetime-local"
                  {...register("requestedCheckInAt")}
                  aria-label={t("adjustment.form.fields.requestedCheckInAt")}
                />
              </Field>
            )}

            {needsCheckOut && (
              <Field
                label={t("adjustment.form.fields.requestedCheckOutAt")}
                required
                error={fieldError(errors.requestedCheckOutAt)}
              >
                <Input
                  type="datetime-local"
                  {...register("requestedCheckOutAt")}
                  aria-label={t("adjustment.form.fields.requestedCheckOutAt")}
                />
              </Field>
            )}

            <Field
              label={t("adjustment.form.fields.reason")}
              required
              error={fieldError(errors.reason)}
            >
              <textarea
                {...register("reason")}
                rows={3}
                placeholder={t("adjustment.form.fields.reasonPlaceholder")}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label={t("adjustment.form.fields.reason")}
              />
            </Field>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
            {t("form.buttons.cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            <FileEdit className="mr-2 h-4 w-4" />
            {isSubmitting ? t("adjustment.form.submitting") : t("adjustment.form.submit")}
          </Button>
        </div>
      </div>
    </form>
  );
}
