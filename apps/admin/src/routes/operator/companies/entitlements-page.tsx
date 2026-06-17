import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useParams } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  setFeatureFlagSchema,
  setUsageLimitSchema,
  type FeatureFlagDto,
  type UsageLimitDto,
} from "@mediaos/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PermissionGate } from "@/components/permission-gate";
import { platformEntitlementsApi } from "@/lib/platform-entitlements-api";
import { tenantEntitlementsQueryKey } from "./entitlements-query";

/**
 * Trang Operator — Entitlements (feature-flag + usage-limit) cho 1 tenant
 * (`/tenant/:companyId/entitlements`, AC-2).
 *
 * Viewer entitlement HIỆU LỰC (gói + override) đọc từ SubscriptionService.getEffectiveEntitlements (server)
 * + form đặt override feature-flag/usage-limit (cross-tenant, atomic + audit server). Đây là metadata
 * bật/tắt + số nguyên, KHÔNG secret.
 *
 * Permission (server ép; FE chỉ ẩn UI): read + set → `manage:platform-subscription` (is_sensitive,
 * step-up bắt buộc cho PUT qua OperatorReauthGuard).
 */
export function EntitlementsPage() {
  const { t } = useTranslation("entitlements");
  const { companyId } = useParams({ strict: false });

  const query = useQuery({
    queryKey: tenantEntitlementsQueryKey(companyId ?? ""),
    queryFn: () => platformEntitlementsApi.getEntitlements(companyId as string),
    enabled: Boolean(companyId),
  });

  const featureColumns: ColumnDef<FeatureFlagDto>[] = useMemo(
    () => [
      { accessorKey: "featureKey", header: t("features.key") },
      {
        accessorKey: "enabled",
        header: t("features.status"),
        cell: ({ row }) => (
          <Badge variant={row.original.enabled ? "default" : "secondary"}>
            {row.original.enabled ? t("status.on") : t("status.off")}
          </Badge>
        ),
      },
      {
        accessorKey: "source",
        header: t("features.source"),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.source === "override" ? t("source.override") : t("source.plan")}
          </span>
        ),
      },
    ],
    [t],
  );

  const limitColumns: ColumnDef<UsageLimitDto>[] = useMemo(
    () => [
      { accessorKey: "metricKey", header: t("limits.key") },
      { accessorKey: "limit", header: t("limits.limit") },
      { accessorKey: "used", header: t("limits.used") },
      {
        accessorKey: "source",
        header: t("limits.source"),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.source === "override" ? t("source.override") : t("source.plan")}
          </span>
        ),
      },
    ],
    [t],
  );

  const features = query.data?.features ?? [];
  const limits = query.data?.limits ?? [];
  const isEmpty =
    !query.isLoading && !query.isError && features.length === 0 && limits.length === 0;

  if (!companyId) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <p role="alert" className="text-sm text-destructive">
          {t("error.noTenant")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {query.isError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center"
        >
          <p className="text-sm text-destructive">{t("error.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t("common:actions.retry")}
          </Button>
        </div>
      ) : isEmpty ? (
        <EmptyState
          icon={SlidersHorizontal}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-lg font-medium">{t("features.title")}</h2>
            <DataTable
              columns={featureColumns}
              data={features}
              loading={query.isLoading}
              pagination={false}
              emptyMessage={t("features.empty")}
            />
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-medium">{t("limits.title")}</h2>
            <DataTable
              columns={limitColumns}
              data={limits}
              loading={query.isLoading}
              pagination={false}
              emptyMessage={t("limits.empty")}
            />
          </section>
        </div>
      )}

      <PermissionGate action="manage" resourceType="platform-subscription">
        <EntitlementSetForms companyId={companyId} />
      </PermissionGate>
    </div>
  );
}

interface EntitlementSetFormsProps {
  companyId: string;
}

/** Form đặt override feature-flag + usage-limit (chỉ render khi có manage:platform-subscription). */
function EntitlementSetForms({ companyId }: EntitlementSetFormsProps) {
  const { t } = useTranslation("entitlements");
  const queryClient = useQueryClient();

  const [featureKey, setFeatureKey] = useState("");
  const [featureEnabled, setFeatureEnabled] = useState("true");
  const [featureError, setFeatureError] = useState<string | null>(null);

  const [metricKey, setMetricKey] = useState("");
  const [limitValue, setLimitValue] = useState("");
  const [limitError, setLimitError] = useState<string | null>(null);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: tenantEntitlementsQueryKey(companyId) });

  const featureMutation = useMutation({
    mutationFn: (body: { featureKey: string; enabled: boolean }) =>
      platformEntitlementsApi.setFeatureFlag(companyId, body),
    onSuccess: () => {
      setFeatureKey("");
      invalidate();
    },
    onError: () => setFeatureError(t("error.setFailed")),
  });

  const limitMutation = useMutation({
    mutationFn: (body: { metricKey: string; limitValue: number }) =>
      platformEntitlementsApi.setUsageLimit(companyId, body),
    onSuccess: () => {
      setMetricKey("");
      setLimitValue("");
      invalidate();
    },
    onError: () => setLimitError(t("error.setFailed")),
  });

  const onSubmitFeature = (e: React.FormEvent) => {
    e.preventDefault();
    setFeatureError(null);
    const parsed = setFeatureFlagSchema.safeParse({
      featureKey: featureKey.trim(),
      enabled: featureEnabled === "true",
    });
    if (!parsed.success) {
      setFeatureError(parsed.error.errors[0]?.message ?? t("error.setFailed"));
      return;
    }
    featureMutation.mutate(parsed.data);
  };

  const onSubmitLimit = (e: React.FormEvent) => {
    e.preventDefault();
    setLimitError(null);
    const parsed = setUsageLimitSchema.safeParse({
      metricKey: metricKey.trim(),
      limitValue: Number(limitValue),
    });
    if (!parsed.success) {
      setLimitError(parsed.error.errors[0]?.message ?? t("error.setFailed"));
      return;
    }
    limitMutation.mutate(parsed.data);
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form
        onSubmit={onSubmitFeature}
        className="space-y-3 rounded-lg border p-4"
        aria-label={t("setFeature.title")}
      >
        <h3 className="text-sm font-semibold">{t("setFeature.title")}</h3>
        {featureError && (
          <p role="alert" aria-live="assertive" className="text-sm text-destructive">
            {featureError}
          </p>
        )}
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="feature-key">
            {t("setFeature.keyLabel")}
          </label>
          <Input
            id="feature-key"
            value={featureKey}
            onChange={(e) => setFeatureKey(e.target.value)}
            placeholder={t("setFeature.keyPlaceholder")}
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="feature-enabled">
            {t("setFeature.enabledLabel")}
          </label>
          <Select
            id="feature-enabled"
            value={featureEnabled}
            onChange={(e) => setFeatureEnabled(e.target.value)}
          >
            <option value="true">{t("status.on")}</option>
            <option value="false">{t("status.off")}</option>
          </Select>
        </div>
        <Button type="submit" disabled={featureMutation.isPending || !featureKey.trim()}>
          {t("setFeature.submit")}
        </Button>
      </form>

      <form
        onSubmit={onSubmitLimit}
        className="space-y-3 rounded-lg border p-4"
        aria-label={t("setLimit.title")}
      >
        <h3 className="text-sm font-semibold">{t("setLimit.title")}</h3>
        {limitError && (
          <p role="alert" aria-live="assertive" className="text-sm text-destructive">
            {limitError}
          </p>
        )}
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="metric-key">
            {t("setLimit.keyLabel")}
          </label>
          <Input
            id="metric-key"
            value={metricKey}
            onChange={(e) => setMetricKey(e.target.value)}
            placeholder={t("setLimit.keyPlaceholder")}
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="limit-value">
            {t("setLimit.valueLabel")}
          </label>
          <Input
            id="limit-value"
            type="number"
            min={0}
            value={limitValue}
            onChange={(e) => setLimitValue(e.target.value)}
            placeholder={t("setLimit.valuePlaceholder")}
            required
          />
        </div>
        <Button type="submit" disabled={limitMutation.isPending || limitValue.trim() === ""}>
          {t("setLimit.submit")}
        </Button>
      </form>
    </div>
  );
}
