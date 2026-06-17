import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { createLeaveRequestSchema } from "@mediaos/contracts";
import { leaveApi } from "@/lib/leave-api";
import { Button } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
import { Dialog } from "@mediaos/ui";

interface FormState {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason: string;
}

const emptyForm: FormState = {
  leaveTypeId: "",
  startDate: "",
  endDate: "",
  reason: "",
};

export function CreateLeaveDialog() {
  const { t } = useTranslation("hr");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [validationError, setValidationError] = useState<string | null>(null);

  const patch = (p: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...p }));

  const { data: leaveTypes = [] } = useQuery({
    queryKey: ["leave", "types"],
    queryFn: () => leaveApi.listTypes(),
  });

  const activeTypes = leaveTypes.filter((lt) => lt.status === "active");

  const create = useMutation({
    mutationFn: () => {
      const payload = {
        leaveTypeId: form.leaveTypeId,
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason || undefined,
      };
      const result = createLeaveRequestSchema.safeParse(payload);
      if (!result.success) {
        throw new Error(result.error.errors[0]?.message ?? t("leaveCreate.invalidData"));
      }
      return leaveApi.createRequest(result.data);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leave", "requests"] });
      void qc.invalidateQueries({ queryKey: ["leave", "balances"] });
      setForm(emptyForm);
      setValidationError(null);
      setOpen(false);
    },
    onError: (e: unknown) => {
      setValidationError(e instanceof Error ? e.message : t("leaveCreate.createError"));
    },
  });

  const canSubmit =
    form.leaveTypeId !== "" &&
    form.startDate !== "" &&
    form.endDate !== "";

  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("leaveCreate.triggerButton")}</Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setValidationError(null);
        }}
        title={t("leaveCreate.dialogTitle")}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setValidationError(null);
              }}
            >
              {t("leaveCreate.cancel")}
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={!canSubmit || create.isPending}
            >
              {create.isPending ? t("leaveCreate.submitting") : t("leaveCreate.submit")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("leaveCreate.labelType")}</label>
            <Select
              value={form.leaveTypeId}
              onChange={(e) => patch({ leaveTypeId: e.target.value })}
            >
              <option value="">{t("leaveCreate.typePlaceholder")}</option>
              {activeTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>
                  {lt.name}
                  {lt.annualQuota != null ? ` ${t("leaveCreate.quotaSuffix", { quota: lt.annualQuota })}` : ""}
                  {lt.paid ? "" : t("leaveCreate.unpaidSuffix")}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("leaveCreate.labelStartDate")}</label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => patch({ startDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("leaveCreate.labelEndDate")}</label>
              <Input
                type="date"
                value={form.endDate}
                min={form.startDate || undefined}
                onChange={(e) => patch({ endDate: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("leaveCreate.labelReason")}</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[80px] resize-none"
              placeholder={t("leaveCreate.reasonPlaceholder")}
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
