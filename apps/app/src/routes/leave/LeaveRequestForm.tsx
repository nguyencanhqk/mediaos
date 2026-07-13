import { useEffect, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Info, AlertTriangle } from "lucide-react";
import type { LeaveCalculateResponse, LeaveTypeView } from "@mediaos/contracts";
import { leaveApi, leaveKeys, ApiError } from "@mediaos/web-core";
import { Button, Card, CardContent, Input, Select } from "@mediaos/ui";
import { useDirtyFormGuard } from "@/hooks/use-dirty-form-guard";
import {
  EMPTY_LEAVE_FORM,
  isCalculateReady,
  leaveFormSchema,
  toCalculateBody,
  toCreateDraftBody,
  toUpdateDraftBody,
  type LeaveFormValues,
} from "./leave-form-schema";
import { LEAVE_DURATION_TYPE, LEAVE_HALF_DAY_SESSION } from "./constants";

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

// ─── Preview box ──────────────────────────────────────────────────────────────

function PreviewBox({
  preview,
  isLoading,
  t,
}: {
  preview: LeaveCalculateResponse | undefined;
  isLoading: boolean;
  t: ReturnType<typeof useTranslation<"leave">>["t"];
}) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        <Info className="mb-1 inline h-4 w-4 align-middle" /> {t("form.preview.loading")}
      </div>
    );
  }
  if (!preview) return null;

  const { calculated_days, calculated_hours, is_balance_required, balance, warnings } = preview;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <p className="text-sm font-semibold">{t("form.preview.title")}</p>

      {/* Days/Hours */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-muted-foreground">{t("form.preview.calculatedDays")}: </span>
          <span className="font-medium">{calculated_days}</span>
        </div>
        <div>
          <span className="text-muted-foreground">{t("form.preview.calculatedHours")}: </span>
          <span className="font-medium">{calculated_hours}</span>
        </div>
      </div>

      {/* Balance */}
      {is_balance_required && balance && (
        <div className="rounded border border-border bg-background p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("form.preview.balanceBefore")}</span>
            <span>{balance.remaining_days}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("form.preview.requested")}</span>
            <span className="text-warning">−{balance.requested_days}</span>
          </div>
          <div className="flex justify-between border-t pt-1 font-medium">
            <span>{t("form.preview.balanceAfter")}</span>
            <span className={balance.after_remaining_days < 0 ? "text-destructive" : ""}>
              {balance.after_remaining_days}
            </span>
          </div>
          {!balance.is_enough && (
            <p role="alert" className="flex items-center gap-1 text-destructive text-xs">
              <AlertTriangle className="h-3 w-3" />
              {t("form.preview.insufficient")}
            </p>
          )}
        </div>
      )}
      {is_balance_required && !balance && (
        <p className="text-xs text-muted-foreground">{t("form.preview.noBalance")}</p>
      )}
      {!is_balance_required && (
        <p className="text-xs text-muted-foreground">{t("form.preview.noBalance")}</p>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-warning">{t("form.preview.warnings")}</p>
          {warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main form component ──────────────────────────────────────────────────────

export interface LeaveRequestFormProps {
  onSuccess: (id: string, status: string) => void;
  onCancel: () => void;
  /**
   * "create" (mặc định) → POST /leave/requests. "edit" → PATCH /leave/requests/:id (chỉ Draft,
   * S3-LEAVE-BE-2 update-draft:leave, luôn OWN — server 404 nếu request.userId khác actor).
   * `requestId` BẮT BUỘC khi mode="edit".
   */
  mode?: "create" | "edit";
  requestId?: string;
  /** Giá trị khởi tạo form khi edit (map từ LeaveRequestDetailView qua fromDraftDetailToFormValues). */
  initialValues?: LeaveFormValues;
}

export function LeaveRequestForm({
  onSuccess,
  onCancel,
  mode = "create",
  requestId,
  initialValues,
}: LeaveRequestFormProps) {
  const { t } = useTranslation("leave");
  const queryClient = useQueryClient();
  const isEdit = mode === "edit";

  // Leave types (for select)
  const { data: leaveTypes, isLoading: typesLoading } = useQuery({
    queryKey: leaveKeys.types.list(),
    queryFn: () => leaveApi.listTypes(),
    staleTime: 5 * 60_000,
  });

  // Form
  const form = useForm<LeaveFormValues>({
    resolver: zodResolver(leaveFormSchema),
    defaultValues: initialValues ?? EMPTY_LEAVE_FORM,
    mode: "onBlur",
  });

  const { control, register, watch, handleSubmit, formState, setValue, setError } = form;
  const { errors, isSubmitting, isDirty } = formState;

  useDirtyFormGuard({ isDirty, message: t("form.dirty") });

  // Watch fields relevant for preview
  const watchedForCalc = watch([
    "leaveTypeId",
    "durationType",
    "startDate",
    "endDate",
    "halfDaySession",
    "startTime",
    "endTime",
  ]);

  const durationType = watch("durationType");
  const isHalfDay = durationType === LEAVE_DURATION_TYPE.HALF_DAY;
  const isHourly = durationType === LEAVE_DURATION_TYPE.HOURLY;

  // Preview (calculate) query — runs whenever relevant fields change
  const calcValues: LeaveFormValues = {
    leaveTypeId: watchedForCalc[0] as string,
    durationType: watchedForCalc[1] as LeaveFormValues["durationType"],
    startDate: watchedForCalc[2] as string,
    endDate: watchedForCalc[3] as string,
    halfDaySession: watchedForCalc[4] as LeaveFormValues["halfDaySession"],
    startTime: watchedForCalc[5] as string | undefined,
    endTime: watchedForCalc[6] as string | undefined,
    submitNow: false,
  };
  const calcReady = isCalculateReady(calcValues);

  const { data: preview, isFetching: previewLoading } = useQuery({
    queryKey: [...leaveKeys.all, "calculate", calcValues],
    queryFn: () => leaveApi.calculate(toCalculateBody(calcValues)),
    enabled: calcReady,
    staleTime: 10_000,
    retry: false,
  });

  // When durationType changes, clear fields that no longer apply
  useEffect(() => {
    if (!isHalfDay) setValue("halfDaySession", undefined);
    if (!isHourly) {
      setValue("startTime", undefined);
      setValue("endTime", undefined);
    }
    if (isHalfDay || isHourly) {
      // Force same day: copy startDate to endDate
      const sd = watch("startDate");
      if (sd) setValue("endDate", sd);
    }
  }, [durationType, isHalfDay, isHourly, setValue, watch]);

  // Submit handler — create (POST) hoặc edit (PATCH update-draft), tuỳ `mode`.
  const createMutation = useMutation({
    mutationFn: (values: LeaveFormValues) =>
      isEdit
        ? leaveApi.updateDraft(
            requestId as string,
            toUpdateDraftBody(values) as Parameters<typeof leaveApi.updateDraft>[1],
          )
        : leaveApi.createDraft(
            toCreateDraftBody(values) as Parameters<typeof leaveApi.createDraft>[0],
          ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: leaveKeys.requests.my() });
      void queryClient.invalidateQueries({ queryKey: leaveKeys.balances.my() });
      if (isEdit && requestId) {
        void queryClient.invalidateQueries({ queryKey: leaveKeys.requests.detail(requestId) });
      }
      onSuccess(result.id, result.status);
    },
  });

  const fieldError = useCallback(
    (err: { message?: string } | undefined): string | undefined =>
      err ? t(err.message ?? "", { defaultValue: err.message ?? "" }) : undefined,
    [t],
  );

  function mapApiError(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.status === 403) return t("form.errors.forbidden");
      if (err.status === 409) {
        // Could be overlap / balance / (edit-only) đơn không còn ở trạng thái Draft (LEAVE-ERR-INVALID-STATE)
        const msg = err.message?.toLowerCase() ?? "";
        if (msg.includes("overlap") || msg.includes("trùng")) return t("form.errors.overlap");
        if (msg.includes("balance") || msg.includes("số dư") || msg.includes("phép"))
          return t("form.errors.insufficientBalance");
        if (isEdit && (msg.includes("nháp") || msg.includes("trạng thái")))
          return t("form.errors.notDraft");
        return t("form.errors.conflict");
      }
      if (err.status === 422 || err.status === 400) return t("form.errors.validation");
      if (err.status >= 500) return t("form.errors.server");
    }
    return t("form.errors.generic");
  }

  async function onSubmit(values: LeaveFormValues) {
    try {
      await createMutation.mutateAsync(values);
    } catch (err) {
      // Map server overlap / balance errors onto form fields
      if (err instanceof ApiError && err.status === 409) {
        const msg = err.message?.toLowerCase() ?? "";
        if (msg.includes("overlap") || msg.includes("trùng")) {
          setError("startDate", { message: t("form.errors.overlap") });
        } else if (msg.includes("balance") || msg.includes("phép")) {
          setError("leaveTypeId", { message: t("form.errors.insufficientBalance") });
        }
      }
      // Global error is shown via mutation.error → mapApiError below
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
        {/* Global error */}
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
            <h3 className="text-sm font-semibold">{t("form.sections.basic")}</h3>

            {/* Leave type */}
            <Field
              label={t("form.fields.leaveType")}
              required
              error={fieldError(errors.leaveTypeId)}
            >
              <Controller
                control={control}
                name="leaveTypeId"
                render={({ field }) => (
                  <Select
                    {...field}
                    aria-label={t("form.fields.leaveType")}
                    disabled={typesLoading}
                  >
                    <option value="">{t("form.fields.leaveTypePlaceholder")}</option>
                    {(leaveTypes ?? []).map((lt: LeaveTypeView) => (
                      <option key={lt.id} value={lt.id}>
                        {lt.name}
                      </option>
                    ))}
                  </Select>
                )}
              />
            </Field>

            {/* Duration type */}
            <Field
              label={t("form.fields.durationType")}
              required
              error={fieldError(errors.durationType)}
            >
              <Controller
                control={control}
                name="durationType"
                render={({ field }) => (
                  <Select {...field} aria-label={t("form.fields.durationType")}>
                    {Object.values(LEAVE_DURATION_TYPE).map((dt) => (
                      <option key={dt} value={dt}>
                        {t(`durationType.${dt}`)}
                      </option>
                    ))}
                  </Select>
                )}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-5">
            <h3 className="text-sm font-semibold">{t("form.sections.timing")}</h3>

            {/* Date range */}
            <div className="grid grid-cols-2 gap-4">
              <Field
                label={t("form.fields.startDate")}
                required
                error={fieldError(errors.startDate)}
              >
                <Input
                  type="date"
                  {...register("startDate")}
                  aria-label={t("form.fields.startDate")}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    register("startDate").onChange(e);
                    // HalfDay / Hourly: keep endDate in sync
                    if (isHalfDay || isHourly) {
                      setValue("endDate", e.target.value, { shouldValidate: true });
                    }
                  }}
                />
              </Field>
              <Field label={t("form.fields.endDate")} required error={fieldError(errors.endDate)}>
                <Input
                  type="date"
                  {...register("endDate")}
                  disabled={isHalfDay || isHourly}
                  aria-label={t("form.fields.endDate")}
                />
              </Field>
            </div>

            {/* Half-day session */}
            {isHalfDay && (
              <Field
                label={t("form.fields.halfDaySession")}
                required
                error={fieldError(errors.halfDaySession)}
              >
                <Controller
                  control={control}
                  name="halfDaySession"
                  render={({ field }) => (
                    <Select
                      {...field}
                      value={field.value ?? ""}
                      aria-label={t("form.fields.halfDaySession")}
                    >
                      <option value="">—</option>
                      {Object.values(LEAVE_HALF_DAY_SESSION).map((s) => (
                        <option key={s} value={s}>
                          {t(`halfDaySession.${s}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                />
              </Field>
            )}

            {/* Hourly time range */}
            {isHourly && (
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label={t("form.fields.startTime")}
                  required
                  error={fieldError(errors.startTime)}
                >
                  <Input
                    type="time"
                    {...register("startTime")}
                    aria-label={t("form.fields.startTime")}
                  />
                </Field>
                <Field label={t("form.fields.endTime")} required error={fieldError(errors.endTime)}>
                  <Input
                    type="time"
                    {...register("endTime")}
                    aria-label={t("form.fields.endTime")}
                  />
                </Field>
              </div>
            )}

            {/* Preview box */}
            <PreviewBox preview={preview} isLoading={previewLoading && calcReady} t={t} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-5">
            <h3 className="text-sm font-semibold">{t("form.sections.detail")}</h3>

            {/* Reason */}
            <Field label={t("form.fields.reason")} error={fieldError(errors.reason)}>
              <textarea
                {...register("reason")}
                rows={3}
                placeholder={t("form.fields.reasonPlaceholder")}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label={t("form.fields.reason")}
              />
            </Field>

            {/* Handover note */}
            <Field label={t("form.fields.handoverNote")} error={fieldError(errors.handoverNote)}>
              <textarea
                {...register("handoverNote")}
                rows={2}
                placeholder={t("form.fields.handoverNotePlaceholder")}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label={t("form.fields.handoverNote")}
              />
            </Field>

            {/* Contact during leave */}
            <Field
              label={t("form.fields.contactDuringLeave")}
              error={fieldError(errors.contactDuringLeave)}
            >
              <Input
                {...register("contactDuringLeave")}
                placeholder={t("form.fields.contactPlaceholder")}
                aria-label={t("form.fields.contactDuringLeave")}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
            {t("form.buttons.cancel")}
          </Button>
          {isEdit ? (
            // Edit mode: PATCH update-draft KHÔNG có submitNow (S3-LEAVE-BE-2 contract) — 1 nút lưu duy nhất.
            <Button
              type="submit"
              disabled={isSubmitting}
              onClick={() => setValue("submitNow", false)}
            >
              {isSubmitting ? t("form.buttons.saving") : t("form.buttons.saveChanges")}
            </Button>
          ) : (
            <>
              <Button
                type="submit"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => setValue("submitNow", false)}
              >
                {isSubmitting ? t("form.buttons.saving") : t("form.buttons.saveDraft")}
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                onClick={() => setValue("submitNow", true)}
              >
                <CalendarDays className="mr-2 h-4 w-4" />
                {isSubmitting ? t("form.buttons.submitting") : t("form.buttons.submit")}
              </Button>
            </>
          )}
        </div>
      </div>
    </form>
  );
}
