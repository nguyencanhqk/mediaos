/**
 * S2-FE-HR-4 — Form "Gửi yêu cầu sửa hồ sơ" (HR-SCREEN-017). Tách riêng khỏi MyChangeRequestPage để
 * giữ file <400 dòng và dễ test độc lập.
 */
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { Button, Select } from "@mediaos/ui";
import { PROFILE_CHANGE_FIELD_LIST } from "./field-labels";
import {
  changeRequestFormSchema,
  EMPTY_CHANGE_REQUEST_FORM,
  toCreateChangeRequestDto,
  type ChangeRequestFormValues,
} from "./change-request-form-schema";
import type { CreateProfileChangeRequest } from "@mediaos/contracts";

interface ChangeRequestFormProps {
  onSubmit: (dto: CreateProfileChangeRequest) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  submitError?: string;
}

export function ChangeRequestForm({
  onSubmit,
  onCancel,
  isSubmitting,
  submitError,
}: ChangeRequestFormProps) {
  const { t } = useTranslation("hr");

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ChangeRequestFormValues>({
    resolver: zodResolver(changeRequestFormSchema),
    mode: "onSubmit",
    defaultValues: EMPTY_CHANGE_REQUEST_FORM,
  });

  const selectedFields = useWatch({ control, name: "changedFields" }) ?? [];
  const fieldsError = errors.changedFields?.message;

  return (
    <form
      onSubmit={handleSubmit((values) => onSubmit(toCreateChangeRequestDto(values)))}
      noValidate
      className="space-y-5"
    >
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          {t("changeRequest.form.selectFieldsLabel")}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PROFILE_CHANGE_FIELD_LIST.map((meta) => (
            <label key={meta.field} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                value={meta.field}
                {...register("changedFields")}
                className="h-4 w-4 rounded border-input"
              />
              <span>
                {t(meta.labelKey)}
                {meta.sensitive && (
                  <span
                    className="ml-1 text-xs text-muted-foreground"
                    title={t("changeRequest.form.sensitiveHint")}
                  >
                    *
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
        {fieldsError && (
          <p role="alert" className="text-sm text-destructive">
            {t(fieldsError)}
          </p>
        )}
      </div>

      {selectedFields.length > 0 && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <p className="text-sm font-medium text-foreground">
            {t("changeRequest.form.newValuesLabel")}
          </p>
          {PROFILE_CHANGE_FIELD_LIST.filter((meta) => selectedFields.includes(meta.field)).map(
            (meta) => {
              const fieldErr = errors.newValues?.[meta.field]?.message;
              return (
                <div key={meta.field} className="space-y-1">
                  <label htmlFor={`nv-${meta.field}`} className="text-sm text-muted-foreground">
                    {t(meta.labelKey)}
                  </label>
                  {meta.inputType === "select" ? (
                    <Select id={`nv-${meta.field}`} {...register(`newValues.${meta.field}`)}>
                      <option value="">{t("form.placeholders.select", { ns: "hr" })}</option>
                      {meta.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {t(opt.labelKey)}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <input
                      id={`nv-${meta.field}`}
                      type={meta.inputType === "date" ? "date" : "text"}
                      {...register(`newValues.${meta.field}`)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  )}
                  {fieldErr && (
                    <p role="alert" className="text-xs text-destructive">
                      {t(fieldErr)}
                    </p>
                  )}
                </div>
              );
            },
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="reason" className="text-sm font-medium text-foreground">
          {t("changeRequest.form.reasonLabel")}
        </label>
        <textarea
          id="reason"
          rows={3}
          {...register("reason")}
          placeholder={t("changeRequest.form.reasonPlaceholder")}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {errors.reason?.message && (
          <p role="alert" className="text-sm text-destructive">
            {t(errors.reason.message)}
          </p>
        )}
      </div>

      {submitError && (
        <p role="alert" aria-live="assertive" className="text-sm text-destructive">
          {submitError}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {t("changeRequest.form.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("changeRequest.form.submitting") : t("changeRequest.form.submit")}
        </Button>
      </div>
    </form>
  );
}
