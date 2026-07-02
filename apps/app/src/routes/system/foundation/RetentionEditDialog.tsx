/**
 * RetentionEditDialog — sửa 1 chính sách lưu trữ (S2-FE-FND-6, nối PATCH
 * /foundation/retention-policies/:id). Gate NÚT ở page (useCan manage:foundation-retention) — dialog
 * chỉ mở khi có quyền; BE vẫn là cổng thật (@RequirePermission, is_sensitive=true).
 *
 * Retention GOVERNS PURGE (FRONTEND-13 §6.6) — luôn xác nhận hậu quả rõ ràng TRƯỚC khi lưu (ConfirmDialog
 * destructive) để tránh đổi tham số xoá/lưu-trữ dữ liệu một cách vô ý. Form KHÔNG gửi id/moduleCode/
 * entityType/companyId (contract PATCH .strict() chặn leo thang — chỉ field mutable).
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { CLEANUP_ACTIONS, type RetentionPolicyView } from "@mediaos/web-core";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AdminField } from "@/routes/attendance/admin/AdminField";
import { useUpdateRetentionPolicy } from "./useRetention";

function mapRetentionApiError(err: unknown, t: (k: string) => string): string {
  const status = (err as { status?: number } | null)?.status;
  if (status === 403) return t("retention.form.errors.forbidden");
  if (status === 404) return t("retention.form.errors.notFound");
  if (status === 422 || status === 400) return t("retention.form.errors.validation");
  if (typeof status === "number" && status >= 500) return t("retention.form.errors.server");
  return t("retention.form.errors.generic");
}

// Optional-number field ("" = KHÔNG set, → null trên wire). z.union([coerce.number(), literal("")]) THỬ
// nhánh coerce.number() TRƯỚC — "" bị Number("") ép về 0 (BUG: rớt vào nhánh number thay vì literal("")).
// preprocess giữ "" nguyên vẹn TRƯỚC khi coerce, chỉ ép sang Number khi input KHÔNG rỗng.
const optionalDaysField = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? "" : Number(v)),
  z.union([z.number().int().min(0), z.literal("")]),
);

const retentionFormSchema = z.object({
  retentionDays: z.coerce.number().int().min(0),
  cleanupAction: z.enum(CLEANUP_ACTIONS),
  archiveAfterDays: optionalDaysField,
  deleteAfterDays: optionalDaysField,
  isEnabled: z.boolean(),
  description: z.string().max(2000).optional(),
});
type RetentionFormValues = z.infer<typeof retentionFormSchema>;

function fromView(p: RetentionPolicyView): RetentionFormValues {
  return {
    retentionDays: p.retentionDays,
    cleanupAction: p.cleanupAction,
    archiveAfterDays: p.archiveAfterDays ?? "",
    deleteAfterDays: p.deleteAfterDays ?? "",
    isEnabled: p.isEnabled,
    description: p.description ?? "",
  };
}

export interface RetentionEditDialogProps {
  open: boolean;
  onClose: () => void;
  policy: RetentionPolicyView;
}

export function RetentionEditDialog({ open, onClose, policy }: RetentionEditDialogProps) {
  const { t } = useTranslation("system");
  const updateMut = useUpdateRetentionPolicy();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const form = useForm<RetentionFormValues>({
    resolver: zodResolver(retentionFormSchema),
    defaultValues: fromView(policy),
    values: fromView(policy),
    mode: "onBlur",
  });
  const { register, handleSubmit, formState } = form;
  const { errors } = formState;

  const busy = updateMut.isPending;
  // Snapshot CÁC GIÁ TRỊ ĐÃ VALIDATE (đi qua zodResolver — retentionDays/archiveAfterDays/deleteAfterDays
  // đã coerce sang number) từ handleSubmit — KHÔNG re-read getValues() raw ở lúc confirm (form field vẫn
  // giữ chuỗi thô của <input type=number>, chưa qua coerce).
  const [pendingValues, setPendingValues] = useState<RetentionFormValues | null>(null);

  function toBody(values: RetentionFormValues) {
    const description = values.description?.trim() === "" ? undefined : values.description;
    return {
      retentionDays: values.retentionDays,
      cleanupAction: values.cleanupAction,
      archiveAfterDays: values.archiveAfterDays === "" ? null : Number(values.archiveAfterDays),
      deleteAfterDays: values.deleteAfterDays === "" ? null : Number(values.deleteAfterDays),
      isEnabled: values.isEnabled,
      description,
    };
  }

  function submit() {
    if (!pendingValues) return;
    updateMut.mutate(
      { id: policy.id, body: toBody(pendingValues) },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          setPendingValues(null);
          onClose();
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title={t("retention.form.editTitle", {
        module: policy.moduleCode,
        entity: policy.entityType,
      })}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t("retention.form.cancel")}
          </Button>
          <Button
            type="submit"
            form="retention-form"
            disabled={busy}
            data-testid="retention-form-submit"
          >
            {t("retention.form.save")}
          </Button>
        </>
      }
    >
      <form
        id="retention-form"
        noValidate
        onSubmit={handleSubmit((values) => {
          setPendingValues(values);
          setConfirmOpen(true);
        })}
        className="space-y-4"
      >
        {updateMut.isError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {mapRetentionApiError(updateMut.error, t)}
          </div>
        )}

        <AdminField
          label={t("retention.form.retentionDays")}
          required
          error={errors.retentionDays?.message}
        >
          <Input
            type="number"
            min={0}
            {...register("retentionDays")}
            aria-label={t("retention.form.retentionDays")}
          />
        </AdminField>

        <AdminField label={t("retention.form.cleanupAction")} error={errors.cleanupAction?.message}>
          <Select {...register("cleanupAction")} aria-label={t("retention.form.cleanupAction")}>
            {CLEANUP_ACTIONS.map((ca) => (
              <option key={ca} value={ca}>
                {t(`retention.cleanupAction.${ca}` as "retention.cleanupAction.None")}
              </option>
            ))}
          </Select>
        </AdminField>

        <AdminField
          label={t("retention.form.archiveAfterDays")}
          error={errors.archiveAfterDays?.message}
        >
          <Input
            type="number"
            min={0}
            {...register("archiveAfterDays")}
            aria-label={t("retention.form.archiveAfterDays")}
          />
        </AdminField>

        <AdminField
          label={t("retention.form.deleteAfterDays")}
          error={errors.deleteAfterDays?.message}
        >
          <Input
            type="number"
            min={0}
            {...register("deleteAfterDays")}
            aria-label={t("retention.form.deleteAfterDays")}
          />
        </AdminField>

        <AdminField label={t("retention.form.description")} error={errors.description?.message}>
          <Input {...register("description")} aria-label={t("retention.form.description")} />
        </AdminField>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("isEnabled")} />
          {t("retention.form.isEnabled")}
        </label>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title={t("retention.confirm.title")}
        description={t("retention.confirm.description")}
        confirmLabel={t("retention.confirm.confirmLabel")}
        cancelLabel={t("retention.confirm.cancelLabel")}
        destructive
        busy={busy}
        busyLabel={t("retention.form.saving")}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </Dialog>
  );
}
