/**
 * SequenceEditDialog — form sửa cấu hình 1 sequence counter + ConfirmDialog trước khi PATCH
 * (S2-FE-FND-5 · lane FE batch C — "confirm khi đổi config").
 *
 * API: PATCH /foundation/sequences/:id (update:foundation-sequence) — gate ở màn cha (PermissionGate).
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SequenceCounterView } from "@mediaos/contracts";
import { foundationOpsApi, foundationInvalidation, ApiError } from "@mediaos/web-core";
import { Dialog, Button, Input, Select } from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  sequenceFormSchema,
  sequenceToFormValues,
  toPatchSequenceDto,
  type SequenceFormValues,
} from "./sequence-form-schema";

const RESET_POLICIES = ["Never", "Yearly", "Monthly", "Daily"] as const;
const STATUSES = ["Active", "Inactive"] as const;

type TF = ReturnType<typeof useTranslation<"system">>["t"];

function submitErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return t("sequences.form.errors.forbidden");
    if (err.status === 409) return t("sequences.form.errors.conflict");
    if (err.status === 422 || err.status === 400) return t("sequences.form.errors.validation");
    if (err.status >= 500) return t("sequences.form.errors.server");
  }
  return t("sequences.form.errors.generic");
}

interface SequenceEditDialogProps {
  sequence: SequenceCounterView;
  onClose: () => void;
}

export function SequenceEditDialog({ sequence, onClose }: SequenceEditDialogProps) {
  const { t } = useTranslation("system");
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { isSubmitting },
  } = useForm<SequenceFormValues>({
    resolver: zodResolver(sequenceFormSchema),
    mode: "onSubmit",
    defaultValues: sequenceToFormValues(sequence),
  });

  const mutation = useMutation({
    mutationFn: (values: SequenceFormValues) =>
      foundationOpsApi.updateSequence(sequence.id, toPatchSequenceDto(values)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: foundationInvalidation.updateSequence()[0] });
      setConfirmOpen(false);
      onClose();
    },
  });

  const busy = isSubmitting || mutation.isPending;
  const noop = () => {};

  return (
    <>
      <Dialog
        open
        onClose={busy ? noop : onClose}
        title={t("sequences.form.title")}
        description={`${sequence.moduleCode} / ${sequence.sequenceKey}`}
        footer={
          <>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t("sequences.form.cancel")}
            </Button>
            <Button type="submit" form="sequence-edit-form" disabled={busy}>
              {busy ? t("sequences.form.saving") : t("sequences.form.save")}
            </Button>
          </>
        }
      >
        {mutation.isError && (
          <p role="alert" aria-live="assertive" className="text-sm text-destructive">
            {submitErrorMessage(mutation.error, t)}
          </p>
        )}
        <form
          id="sequence-edit-form"
          noValidate
          className="space-y-4"
          onSubmit={handleSubmit(() => setConfirmOpen(true))}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="prefix" className="text-sm font-medium text-foreground">
                {t("sequences.form.fields.prefix")}
              </label>
              <Input id="prefix" {...register("prefix")} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="suffix" className="text-sm font-medium text-foreground">
                {t("sequences.form.fields.suffix")}
              </label>
              <Input id="suffix" {...register("suffix")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="datePattern" className="text-sm font-medium text-foreground">
                {t("sequences.form.fields.datePattern")}
              </label>
              <Input id="datePattern" placeholder="yyyyMM" {...register("datePattern")} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="paddingLength" className="text-sm font-medium text-foreground">
                {t("sequences.form.fields.paddingLength")}
              </label>
              <Input id="paddingLength" type="number" min={0} {...register("paddingLength")} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="incrementBy" className="text-sm font-medium text-foreground">
                {t("sequences.form.fields.incrementBy")}
              </label>
              <Input id="incrementBy" type="number" min={1} {...register("incrementBy")} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="resetPolicy" className="text-sm font-medium text-foreground">
                {t("sequences.form.fields.resetPolicy")}
              </label>
              <Select id="resetPolicy" {...register("resetPolicy")}>
                {RESET_POLICIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="status" className="text-sm font-medium text-foreground">
                {t("sequences.form.fields.status")}
              </label>
              <Select id="status" {...register("status")}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sequences.status.${s}`)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title={t("sequences.form.confirm.title")}
        description={t("sequences.form.confirm.description")}
        confirmLabel={t("sequences.form.confirm.confirmLabel")}
        cancelLabel={t("sequences.form.confirm.cancelLabel")}
        busy={mutation.isPending}
        busyLabel={t("sequences.form.saving")}
        onConfirm={() => mutation.mutate(getValues())}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
