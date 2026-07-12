/**
 * DashboardConfigFormDialog — sửa is_enabled/sort_order/layout size (width/height) của 1 dòng
 * dashboard_widget_configs (S4-FE-DASH-3, nối PATCH /dashboard/configs/:id — S4-DASH-BE-3).
 *
 * Gate NÚT ở DashboardConfigPage (useCanExact('update','dashboard-config') — cặp sensitive); BE là cổng
 * thật. layout_width/layout_height rỗng → gửi `null` (xoá override, widget quay lại kích thước mặc định) —
 * PHẢI phân biệt với "giữ nguyên" (dashboardConfigPatchSchema `.nullable().optional()`, KHÔNG gửi field
 * mới giữ nguyên — form này LUÔN gửi đủ 4 field nên không cần phân biệt "vắng mặt").
 */
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import type { DashboardConfigItemDto, DashboardConfigPatchDto } from "@mediaos/contracts";
import { Button, Dialog, Input } from "@mediaos/ui";
import { useUpdateDashboardConfig } from "./hooks/useDashboardConfigAdmin";

const digitsOrEmpty = (v: string) => v.trim() === "" || /^\d+$/.test(v.trim());

const configFormSchema = z.object({
  is_enabled: z.boolean(),
  sort_order: z.coerce.number().int().min(0, "sortOrderInvalid"),
  layout_width: z.string().refine(digitsOrEmpty, "sizeInvalid"),
  layout_height: z.string().refine(digitsOrEmpty, "sizeInvalid"),
});
type ConfigFormValues = z.infer<typeof configFormSchema>;

function fromDto(dto: DashboardConfigItemDto): ConfigFormValues {
  return {
    is_enabled: dto.is_enabled,
    sort_order: dto.sort_order,
    layout_width: dto.layout.width != null ? String(dto.layout.width) : "",
    layout_height: dto.layout.height != null ? String(dto.layout.height) : "",
  };
}

function toIntOrNull(v: string): number | null {
  return v.trim() === "" ? null : Number(v.trim());
}

/** Map ApiError status → thông điệp người-đọc (namespace dashboard, key config.form.errors.*). */
function mapApiError(err: unknown, t: (k: string) => string): string {
  const status = (err as { status?: number } | null)?.status;
  if (status === 403) return t("config.form.errors.forbidden");
  if (status === 409) return t("config.form.errors.conflict");
  if (status === 422 || status === 400) return t("config.form.errors.validation");
  if (typeof status === "number" && status >= 500) return t("config.form.errors.server");
  return t("config.form.errors.generic");
}

export interface DashboardConfigFormDialogProps {
  config: DashboardConfigItemDto;
  onClose: () => void;
}

export function DashboardConfigFormDialog({ config, onClose }: DashboardConfigFormDialogProps) {
  const { t } = useTranslation("dashboard");
  const updateMut = useUpdateDashboardConfig();

  const { register, handleSubmit, formState } = useForm<ConfigFormValues>({
    resolver: zodResolver(configFormSchema),
    defaultValues: fromDto(config),
    mode: "onBlur",
  });
  const { errors, isSubmitting } = formState;

  async function onSubmit(values: ConfigFormValues) {
    const body: DashboardConfigPatchDto = {
      is_enabled: values.is_enabled,
      sort_order: values.sort_order,
      layout_width: toIntOrNull(values.layout_width),
      layout_height: toIntOrNull(values.layout_height),
    };
    await updateMut.mutateAsync({ id: config.id, body });
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("config.form.title")}
      description={config.widget_name}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t("config.form.cancel")}
          </Button>
          <Button
            type="submit"
            form="dashboard-config-form"
            disabled={isSubmitting}
            data-testid="config-form-submit"
          >
            {isSubmitting ? t("config.form.saving") : t("config.form.save")}
          </Button>
        </>
      }
    >
      <form
        id="dashboard-config-form"
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

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("is_enabled")} data-testid="config-form-enabled" />
          {t("config.form.enabled")}
        </label>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="config-sort-order">
            {t("config.form.sortOrder")}
          </label>
          <Input
            id="config-sort-order"
            type="number"
            {...register("sort_order")}
            aria-label={t("config.form.sortOrder")}
          />
          {errors.sort_order?.message && (
            <p role="alert" className="text-sm text-destructive">
              {t(`config.form.${errors.sort_order.message}`)}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="config-layout-width">
              {t("config.form.width")}
            </label>
            <Input
              id="config-layout-width"
              type="number"
              min={1}
              {...register("layout_width")}
              aria-label={t("config.form.width")}
            />
            {errors.layout_width?.message && (
              <p role="alert" className="text-sm text-destructive">
                {t(`config.form.${errors.layout_width.message}`)}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="config-layout-height">
              {t("config.form.height")}
            </label>
            <Input
              id="config-layout-height"
              type="number"
              min={1}
              {...register("layout_height")}
              aria-label={t("config.form.height")}
            />
            {errors.layout_height?.message && (
              <p role="alert" className="text-sm text-destructive">
                {t(`config.form.${errors.layout_height.message}`)}
              </p>
            )}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
