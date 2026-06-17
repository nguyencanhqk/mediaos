import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { updateBrandingRequestSchema, type UpdateBrandingRequest } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCan } from "@/hooks/use-can";
import { uiConfigApi } from "@/lib/ui-config-api";

type FormState = {
  companyName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
};

const EMPTY_FORM: FormState = {
  companyName: "",
  logoUrl: "",
  faviconUrl: "",
  primaryColor: "",
  secondaryColor: "",
};

/** Chuỗi rỗng → null (xoá giá trị); ngược lại giữ nguyên (gửi để cập nhật). */
function toNullable(v: string): string | null {
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * AC-4 Branding — self-service company-admin. Gate `manage:branding` ở BE; UI chỉ ẩn/hiện affordance.
 * companyId lấy từ token (BE) — path `/tenant/:companyId/branding` chỉ self-scope điều hướng.
 */
export function BrandingPage() {
  const { t } = useTranslation("ui-config");
  const queryClient = useQueryClient();
  const canManage = useCan("manage", "branding");
  const canView = useCan("view", "branding");
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [flash, setFlash] = React.useState<string | null>(null);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  const brandingQuery = useQuery({
    queryKey: ["ui-config", "branding"],
    queryFn: uiConfigApi.getBranding,
    enabled: canView,
  });

  // Đồng bộ form khi data tải xong (1 chiều — server → form).
  React.useEffect(() => {
    const d = brandingQuery.data;
    if (!d) return;
    setForm({
      companyName: d.companyName ?? "",
      logoUrl: d.logoUrl ?? "",
      faviconUrl: d.faviconUrl ?? "",
      primaryColor: d.primaryColor ?? "",
      secondaryColor: d.secondaryColor ?? "",
    });
  }, [brandingQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (body: UpdateBrandingRequest) => uiConfigApi.updateBranding(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ui-config", "branding"] });
      setFlash(t("branding.saved"));
    },
  });

  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState
          icon={Palette}
          title={t("noPermission.title")}
          description={t("noPermission.description")}
        />
      </div>
    );
  }

  function update(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);
    setFlash(null);
    const candidate = {
      companyName: toNullable(form.companyName),
      logoUrl: toNullable(form.logoUrl),
      faviconUrl: toNullable(form.faviconUrl),
      primaryColor: toNullable(form.primaryColor),
      secondaryColor: toNullable(form.secondaryColor),
    };
    const parsed = updateBrandingRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      setValidationError(t("branding.invalidColor"));
      return;
    }
    saveMutation.mutate(parsed.data);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("branding.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("branding.subtitle")}</p>
      </header>

      {flash && (
        <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          {flash}
        </p>
      )}
      {brandingQuery.isError && (
        <p
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t("branding.loadFailed")}
          <Button variant="outline" size="sm" onClick={() => void brandingQuery.refetch()}>
            {t("common:actions.retry")}
          </Button>
        </p>
      )}
      {(validationError || saveMutation.isError) && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {validationError ?? t("branding.saveFailed")}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("branding.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {brandingQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : (
            <form className="space-y-4" onSubmit={onSubmit}>
              <Field
                id="companyName"
                label={t("branding.fields.companyName")}
                value={form.companyName}
                onChange={(v) => update("companyName", v)}
                disabled={!canManage}
              />
              <Field
                id="logoUrl"
                label={t("branding.fields.logoUrl")}
                value={form.logoUrl}
                onChange={(v) => update("logoUrl", v)}
                placeholder={t("branding.placeholder.url")}
                disabled={!canManage}
              />
              <Field
                id="faviconUrl"
                label={t("branding.fields.faviconUrl")}
                value={form.faviconUrl}
                onChange={(v) => update("faviconUrl", v)}
                placeholder={t("branding.placeholder.url")}
                disabled={!canManage}
              />
              <Field
                id="primaryColor"
                label={t("branding.fields.primaryColor")}
                value={form.primaryColor}
                onChange={(v) => update("primaryColor", v)}
                placeholder={t("branding.placeholder.color")}
                disabled={!canManage}
              />
              <Field
                id="secondaryColor"
                label={t("branding.fields.secondaryColor")}
                value={form.secondaryColor}
                onChange={(v) => update("secondaryColor", v)}
                placeholder={t("branding.placeholder.color")}
                disabled={!canManage}
              />
              {canManage && (
                <Button type="submit" disabled={saveMutation.isPending}>
                  {t("branding.save")}
                </Button>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

function Field({ id, label, value, onChange, placeholder, disabled }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
