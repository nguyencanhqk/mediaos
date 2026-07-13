/**
 * NotificationTemplateEditDialog — sửa nội dung 1 dòng notification_templates (S4-FE-NOTI-4, nối PATCH
 * /notifications/templates/:id — S4-NOTI-BE-4). Sửa title_template/body_template/short_body_template/
 * action_label_template/target_url_template/status; luôn ghi vào COMPANY-OVERRIDE (server tự xử lý —
 * KHÔNG bao giờ UPDATE hàng global), client chỉ gửi { title_template, body_template, ... }.
 *
 * Gate NÚT ở NotificationTemplatesPage (useCanExact('update','notification-template') — cặp sensitive);
 * BE là cổng thật. short_body_template/action_label_template/target_url_template rỗng → gửi `null` (xoá
 * override) — form LUÔN gửi đủ field nên không cần phân biệt "vắng mặt" (mirror DashboardConfigFormDialog).
 *
 * 422 biến-nhạy-cảm (assertTemplateVariablesSafe, BE) hiển thị NGUYÊN VĂN qua ApiError.message — BE đã
 * soạn message người-đọc (chỉ echo tên biến, an toàn) — client KHÔNG tự suy diễn thêm thông điệp.
 */
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import type {
  NotificationTemplateAdminItem,
  NotificationTemplateAdminPatch,
} from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { useUpdateNotificationTemplate } from "./hooks/useNotificationTemplates";
import { NOTI_TEMPLATE_STATUSES } from "./constants";

const templateFormSchema = z.object({
  title_template: z.string().trim().min(1, "titleRequired").max(255, "titleTooLong"),
  body_template: z.string().trim().min(1, "bodyRequired"),
  short_body_template: z.string().max(500, "shortBodyTooLong"),
  action_label_template: z.string().max(100, "actionLabelTooLong"),
  target_url_template: z.string().max(500, "targetUrlTooLong"),
  status: z.enum(NOTI_TEMPLATE_STATUSES),
});
type TemplateFormValues = z.infer<typeof templateFormSchema>;

function fromDto(dto: NotificationTemplateAdminItem): TemplateFormValues {
  return {
    title_template: dto.title_template,
    body_template: dto.body_template,
    short_body_template: dto.short_body_template ?? "",
    action_label_template: dto.action_label_template ?? "",
    target_url_template: dto.target_url_template ?? "",
    status: (NOTI_TEMPLATE_STATUSES as readonly string[]).includes(dto.status)
      ? (dto.status as TemplateFormValues["status"])
      : "Draft",
  };
}

function toNullable(v: string): string | null {
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

/** Map ApiError → thông điệp người-đọc. 422 (biến nhạy cảm) hiển thị NGUYÊN VĂN message BE — các mã khác
 * dùng bản dịch chung (mirror DashboardConfigFormDialog.mapApiError). */
function mapApiError(err: unknown, t: (k: string) => string): string {
  const status = (err as { status?: number } | null)?.status;
  const message = (err as { message?: string } | null)?.message;
  if (status === 422 && message) return message;
  if (status === 403) return t("templates.form.errors.forbidden");
  if (status === 409) return t("templates.form.errors.conflict");
  if (status === 422 || status === 400) return t("templates.form.errors.validation");
  if (typeof status === "number" && status >= 500) return t("templates.form.errors.server");
  return t("templates.form.errors.generic");
}

export interface NotificationTemplateEditDialogProps {
  template: NotificationTemplateAdminItem;
  onClose: () => void;
}

export function NotificationTemplateEditDialog({
  template,
  onClose,
}: NotificationTemplateEditDialogProps) {
  const { t } = useTranslation("notifications");
  const updateMut = useUpdateNotificationTemplate();

  const { register, handleSubmit, formState } = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: fromDto(template),
    mode: "onBlur",
  });
  const { errors, isSubmitting } = formState;

  async function onSubmit(values: TemplateFormValues) {
    const body: NotificationTemplateAdminPatch = {
      title_template: values.title_template.trim(),
      body_template: values.body_template.trim(),
      short_body_template: toNullable(values.short_body_template),
      action_label_template: toNullable(values.action_label_template),
      target_url_template: toNullable(values.target_url_template),
      status: values.status,
    };
    await updateMut.mutateAsync({ id: template.id, body });
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("templates.form.title")}
      description={template.template_code}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t("templates.form.cancel")}
          </Button>
          <Button
            type="submit"
            form="notification-template-form"
            disabled={isSubmitting}
            data-testid="template-form-submit"
          >
            {isSubmitting ? t("templates.form.saving") : t("templates.form.save")}
          </Button>
        </>
      }
    >
      <form
        id="notification-template-form"
        noValidate
        onSubmit={handleSubmit((v) => {
          void onSubmit(v);
        })}
        className="space-y-4"
      >
        {updateMut.error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {mapApiError(updateMut.error, t)}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="template-title">
            {t("templates.form.fields.title")}
          </label>
          <Input
            id="template-title"
            {...register("title_template")}
            aria-label={t("templates.form.fields.title")}
          />
          {errors.title_template?.message && (
            <p role="alert" className="text-sm text-destructive">
              {t(`templates.form.errors.${errors.title_template.message}`)}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="template-body">
            {t("templates.form.fields.body")}
          </label>
          <textarea
            id="template-body"
            rows={4}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...register("body_template")}
            aria-label={t("templates.form.fields.body")}
          />
          {errors.body_template?.message && (
            <p role="alert" className="text-sm text-destructive">
              {t(`templates.form.errors.${errors.body_template.message}`)}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="template-short-body">
            {t("templates.form.fields.shortBody")}
          </label>
          <textarea
            id="template-short-body"
            rows={2}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...register("short_body_template")}
            aria-label={t("templates.form.fields.shortBody")}
          />
          {errors.short_body_template?.message && (
            <p role="alert" className="text-sm text-destructive">
              {t(`templates.form.errors.${errors.short_body_template.message}`)}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="template-action-label">
              {t("templates.form.fields.actionLabel")}
            </label>
            <Input
              id="template-action-label"
              {...register("action_label_template")}
              aria-label={t("templates.form.fields.actionLabel")}
            />
            {errors.action_label_template?.message && (
              <p role="alert" className="text-sm text-destructive">
                {t(`templates.form.errors.${errors.action_label_template.message}`)}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="template-status">
              {t("templates.form.fields.status")}
            </label>
            <Select
              id="template-status"
              {...register("status")}
              aria-label={t("templates.form.fields.status")}
            >
              {NOTI_TEMPLATE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`templates.status.${s}`, { defaultValue: s })}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="template-target-url">
            {t("templates.form.fields.targetUrl")}
          </label>
          <Input
            id="template-target-url"
            {...register("target_url_template")}
            aria-label={t("templates.form.fields.targetUrl")}
          />
          {errors.target_url_template?.message && (
            <p role="alert" className="text-sm text-destructive">
              {t(`templates.form.errors.${errors.target_url_template.message}`)}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  );
}
