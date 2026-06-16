import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { createAdjustmentRequestSchema } from "@mediaos/contracts";
import { attendanceApi } from "@/lib/attendance-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";

interface FormState {
  workDate: string;
  requestedCheckInAt: string;
  requestedCheckOutAt: string;
  reason: string;
}

const emptyForm: FormState = {
  workDate: "",
  requestedCheckInAt: "",
  requestedCheckOutAt: "",
  reason: "",
};

/** Build ISO datetime from date + local time string (HH:mm). */
function toIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  return new Date(`${date}T${time}:00`).toISOString();
}

export function CreateAdjustmentDialog() {
  const { t } = useTranslation("hr");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [validationError, setValidationError] = useState<string | null>(null);

  const patch = (p: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...p }));

  const create = useMutation({
    mutationFn: () => {
      const payload = {
        workDate: form.workDate,
        requestedCheckInAt: toIso(form.workDate, form.requestedCheckInAt),
        requestedCheckOutAt: toIso(form.workDate, form.requestedCheckOutAt),
        reason: form.reason,
      };
      const result = createAdjustmentRequestSchema.safeParse(payload);
      if (!result.success) {
        throw new Error(result.error.errors[0]?.message ?? t("adjustmentCreate.invalidData"));
      }
      return attendanceApi.createAdjustment(result.data);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["attendance", "adjustments"] });
      setForm(emptyForm);
      setValidationError(null);
      setOpen(false);
    },
    onError: (e: unknown) => {
      setValidationError(e instanceof Error ? e.message : t("adjustmentCreate.createError"));
    },
  });

  const canSubmit =
    form.workDate.trim() !== "" &&
    form.reason.trim().length >= 3 &&
    (form.requestedCheckInAt !== "" || form.requestedCheckOutAt !== "");

  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("adjustmentCreate.triggerButton")}</Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setValidationError(null);
        }}
        title={t("adjustmentCreate.dialogTitle")}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setValidationError(null);
              }}
            >
              {t("adjustmentCreate.cancel")}
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={!canSubmit || create.isPending}
            >
              {create.isPending ? t("adjustmentCreate.submitting") : t("adjustmentCreate.submit")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("adjustmentCreate.labelDate")}</label>
            <Input
              type="date"
              value={form.workDate}
              onChange={(e) => patch({ workDate: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("adjustmentCreate.labelCheckIn")}</label>
              <Input
                type="time"
                value={form.requestedCheckInAt}
                onChange={(e) => patch({ requestedCheckInAt: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("adjustmentCreate.labelCheckOut")}</label>
              <Input
                type="time"
                value={form.requestedCheckOutAt}
                onChange={(e) => patch({ requestedCheckOutAt: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("adjustmentCreate.hintOneRequired")}
          </p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("adjustmentCreate.labelReason")}</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[80px] resize-none"
              placeholder={t("adjustmentCreate.reasonPlaceholder")}
              value={form.reason}
              onChange={(e) => patch({ reason: e.target.value })}
              maxLength={1000}
            />
          </div>
          {validationError && (
            <p className="text-sm text-destructive">{validationError}</p>
          )}
        </div>
      </Dialog>
    </>
  );
}
