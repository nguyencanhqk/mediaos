/**
 * HR-SCREEN-EMPLOYEE-CODE-CONFIG (S2-FE-HR-8 — UI-08 §26 / UI-HR-SCREEN-017) — /hr/settings/employee-code.
 *
 * Đọc:  GET  /hr/employee-code-config   gate view:employee-code-config   (HR-API-901)
 * Sửa:  PATCH /hr/employee-code-config  gate update:employee-code-config (HR-API-902)
 * Xem trước: POST /hr/employee-code/preview gate preview:employee-code  (HR-API-903, KHÔNG mutate).
 *
 * `employee_code_configs` chỉ giữ FORMAT mã (prefix/pattern/numberLength/allowManualOverride/status).
 * Bộ đếm chạy (padding/reset_policy/current_value — draft FRONTEND-08 §26.2 cũ) sống ở
 * `sequence_counters` (S1-FND-SEQ-1) và KHÔNG lộ/sửa qua màn này — spec BE THẬT (S2-HR-BE-7) thắng
 * bản nháp UI cũ (RECONCILE-FIRST). Nút Lưu ẨN khi thiếu quyền update (anti dead-button).
 *
 * States: forbidden · loading · error · form (luôn có config — server trả default, KHÔNG 404).
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, RefreshCw, Sparkles } from "lucide-react";
import {
  employeeCodeConfigApi,
  hrInvalidation,
  hrKeys,
  useCan,
  type EmployeeCodeConfigDto,
} from "@mediaos/web-core";
import {
  PageHeader,
  EmptyState,
  Button,
  Input,
  Select,
  Card,
  CardContent,
  Badge,
} from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AdminField } from "@/routes/attendance/admin/AdminField";
import { HR_ENGINE_PAIRS } from "@/routes/hr/constants";
import {
  employeeCodeConfigFormSchema,
  fromConfigDto,
  toUpdateBody,
  EMPLOYEE_CODE_CONFIG_STATUSES,
  type EmployeeCodeConfigFormValues,
} from "./employee-code-config-form";

type TF = ReturnType<typeof useTranslation<"hr">>["t"];

function mapEmployeeCodeConfigError(err: unknown, t: TF): string {
  const status = (err as { status?: number } | null)?.status;
  if (status === 403) return t("employeeCodeConfig.form.errors.forbidden");
  if (status === 422 || status === 400) return t("employeeCodeConfig.form.errors.validation");
  if (typeof status === "number" && status >= 500)
    return t("employeeCodeConfig.form.errors.server");
  return t("employeeCodeConfig.form.errors.generic");
}

/** Panel "xem trước mã tiếp theo" — POST preview, KHÔNG mutate counter. Ẩn hoàn toàn nếu thiếu quyền. */
function PreviewPanel({ canPreview, t }: { canPreview: boolean; t: TF }) {
  const preview = useQuery({
    queryKey: hrKeys.employeeCodeConfig.preview(),
    queryFn: () => employeeCodeConfigApi.previewNextCode(),
    enabled: canPreview,
    retry: false,
  });

  if (!canPreview) return null;

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">
              {t("employeeCodeConfig.preview.title")}
            </h3>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void preview.refetch()}
            disabled={preview.isFetching}
            data-testid="employee-code-preview-refresh"
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            {t("employeeCodeConfig.preview.refresh")}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("employeeCodeConfig.preview.description")}
        </p>

        {preview.isLoading && (
          <p className="text-sm text-muted-foreground">{t("employeeCodeConfig.preview.loading")}</p>
        )}
        {preview.isError && (
          <p className="text-sm text-muted-foreground" data-testid="employee-code-preview-error">
            {t("employeeCodeConfig.preview.unavailable")}
          </p>
        )}
        {preview.data && (
          <p
            className="font-mono text-lg font-semibold text-foreground"
            data-testid="employee-code-preview-value"
          >
            {preview.data.code}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function EmployeeCodeConfigPage() {
  const { t } = useTranslation("hr");
  const queryClient = useQueryClient();

  const canView = useCan(
    HR_ENGINE_PAIRS.VIEW_EMPLOYEE_CODE_CONFIG.action,
    HR_ENGINE_PAIRS.VIEW_EMPLOYEE_CODE_CONFIG.resourceType,
  );
  const canUpdate = useCan(
    HR_ENGINE_PAIRS.UPDATE_EMPLOYEE_CODE_CONFIG.action,
    HR_ENGINE_PAIRS.UPDATE_EMPLOYEE_CODE_CONFIG.resourceType,
  );
  const canPreview = useCan(
    HR_ENGINE_PAIRS.PREVIEW_EMPLOYEE_CODE.action,
    HR_ENGINE_PAIRS.PREVIEW_EMPLOYEE_CODE.resourceType,
  );

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<EmployeeCodeConfigFormValues | null>(null);

  const query = useQuery({
    queryKey: hrKeys.employeeCodeConfig.config(),
    queryFn: () => employeeCodeConfigApi.getConfig(),
    enabled: canView,
    staleTime: 30_000,
  });

  const form = useForm<EmployeeCodeConfigFormValues>({
    resolver: zodResolver(employeeCodeConfigFormSchema),
    values: query.data ? fromConfigDto(query.data) : undefined,
    mode: "onBlur",
  });
  const { register, handleSubmit, formState } = form;
  const { errors } = formState;

  const mutation = useMutation({
    mutationFn: (values: EmployeeCodeConfigFormValues) =>
      employeeCodeConfigApi.updateConfig(toUpdateBody(values)),
    onSuccess: async (dto: EmployeeCodeConfigDto) => {
      queryClient.setQueryData(hrKeys.employeeCodeConfig.config(), dto);
      const keys = hrInvalidation.updateEmployeeCodeConfig();
      await Promise.all(keys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
      setConfirmOpen(false);
      setPendingValues(null);
    },
  });

  const busy = mutation.isPending;

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("employeeCodeConfig.forbidden.title")}
          description={t("employeeCodeConfig.forbidden.description")}
          data-testid="employee-code-config-forbidden"
        />
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (query.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader
          title={t("employeeCodeConfig.title")}
          description={t("employeeCodeConfig.description")}
          icon={Hash}
        />
        <div
          className="h-64 animate-pulse rounded-xl bg-muted"
          data-testid="employee-code-config-loading"
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (query.isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("employeeCodeConfig.error.title")}
          description={t("employeeCodeConfig.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("employeeCodeConfig.preview.refresh")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("employeeCodeConfig.title")}
        description={t("employeeCodeConfig.description")}
        icon={Hash}
      />

      <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        {t("employeeCodeConfig.notice")}
      </p>

      <Card>
        <CardContent className="pt-5">
          <form
            id="employee-code-config-form"
            noValidate
            onSubmit={handleSubmit((values) => {
              setPendingValues(values);
              setConfirmOpen(true);
            })}
            className="space-y-4"
          >
            {mutation.isError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {mapEmployeeCodeConfigError(mutation.error, t)}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <AdminField
                label={t("employeeCodeConfig.form.prefix")}
                error={errors.prefix?.message}
              >
                <Input
                  {...register("prefix")}
                  placeholder={t("employeeCodeConfig.form.prefixPlaceholder")}
                  disabled={!canUpdate || busy}
                  aria-label={t("employeeCodeConfig.form.prefix")}
                />
              </AdminField>

              <AdminField
                label={t("employeeCodeConfig.form.numberLength")}
                required
                error={errors.numberLength?.message}
              >
                <Input
                  type="number"
                  min={1}
                  max={12}
                  {...register("numberLength")}
                  disabled={!canUpdate || busy}
                  aria-label={t("employeeCodeConfig.form.numberLength")}
                />
              </AdminField>
            </div>

            <AdminField
              label={t("employeeCodeConfig.form.pattern")}
              error={errors.pattern?.message}
            >
              <Input
                {...register("pattern")}
                placeholder={t("employeeCodeConfig.form.patternPlaceholder")}
                disabled={!canUpdate || busy}
                aria-label={t("employeeCodeConfig.form.pattern")}
              />
            </AdminField>

            <AdminField label={t("employeeCodeConfig.form.status")} error={errors.status?.message}>
              <Select
                {...register("status")}
                disabled={!canUpdate || busy}
                aria-label={t("employeeCodeConfig.form.status")}
              >
                {EMPLOYEE_CODE_CONFIG_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(
                      s === "active"
                        ? "employeeCodeConfig.form.statusActive"
                        : "employeeCodeConfig.form.statusInactive",
                    )}
                  </option>
                ))}
              </Select>
            </AdminField>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                {...register("allowManualOverride")}
                disabled={!canUpdate || busy}
              />
              {t("employeeCodeConfig.form.allowManualOverride")}
              {query.data && (
                <Badge variant={query.data.status === "active" ? "success" : "muted"}>
                  {t(
                    query.data.status === "active"
                      ? "employeeCodeConfig.form.statusActive"
                      : "employeeCodeConfig.form.statusInactive",
                  )}
                </Badge>
              )}
            </label>

            {/* Nút Lưu ẨN khi thiếu update:employee-code-config (anti dead-button). */}
            {canUpdate && (
              <div className="flex items-center justify-end gap-3">
                <Button
                  type="submit"
                  form="employee-code-config-form"
                  disabled={busy}
                  data-testid="employee-code-config-submit"
                >
                  {busy ? t("employeeCodeConfig.form.saving") : t("employeeCodeConfig.form.save")}
                </Button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <PreviewPanel canPreview={canPreview} t={t} />

      <ConfirmDialog
        open={confirmOpen}
        title={t("employeeCodeConfig.confirm.title")}
        description={t("employeeCodeConfig.confirm.description")}
        confirmLabel={t("employeeCodeConfig.confirm.confirmLabel")}
        cancelLabel={t("employeeCodeConfig.confirm.cancelLabel")}
        busy={busy}
        busyLabel={t("employeeCodeConfig.form.saving")}
        onConfirm={() => pendingValues && mutation.mutate(pendingValues)}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
