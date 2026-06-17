import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { putI18nOverridesRequestSchema, type I18nOverrideDto } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCan } from "@/hooks/use-can";
import { uiConfigApi } from "@/lib/ui-config-api";

type Row = { locale: string; namespace: string; key: string; value: string };

function toRow(o: I18nOverrideDto): Row {
  return { locale: o.locale, namespace: o.namespace, key: o.key, value: o.value };
}

/**
 * AC-4 i18n overrides editor — self-service company-admin. Gate `manage:i18n-override` ở BE.
 * Đè chuỗi dịch theo từng công ty (locale / namespace / key → value).
 */
export function I18nPage() {
  const { t } = useTranslation("ui-config");
  const queryClient = useQueryClient();
  const canManage = useCan("manage", "i18n-override");
  const [rows, setRows] = React.useState<Row[]>([]);
  const [flash, setFlash] = React.useState<string | null>(null);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  const i18nQuery = useQuery({
    queryKey: ["ui-config", "i18n"],
    queryFn: uiConfigApi.getI18nOverrides,
    enabled: canManage,
  });

  React.useEffect(() => {
    if (i18nQuery.data) setRows(i18nQuery.data.map(toRow));
  }, [i18nQuery.data]);

  const saveMutation = useMutation({
    mutationFn: uiConfigApi.updateI18nOverrides,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ui-config", "i18n"] });
      setFlash(t("i18n.saved"));
    },
  });

  if (!canManage) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <EmptyState
          icon={Languages}
          title={t("noPermission.title")}
          description={t("noPermission.description")}
        />
      </div>
    );
  }

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { locale: "vi", namespace: "", key: "", value: "" }]);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function onSave() {
    setValidationError(null);
    setFlash(null);
    const overrides = rows.map((r) => ({
      locale: r.locale.trim(),
      namespace: r.namespace.trim(),
      key: r.key.trim(),
      value: r.value,
    }));
    const parsed = putI18nOverridesRequestSchema.safeParse({ overrides });
    if (!parsed.success) {
      const dup = parsed.error.issues.some((i) => i.path.includes("overrides"));
      setValidationError(dup ? t("i18n.duplicateKey") : t("i18n.saveFailed"));
      return;
    }
    saveMutation.mutate(parsed.data);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t("i18n.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("i18n.subtitle")}</p>
        </div>
        <Button variant="outline" onClick={addRow}>
          {t("i18n.addItem")}
        </Button>
      </header>

      {flash && (
        <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          {flash}
        </p>
      )}
      {i18nQuery.isError && (
        <p
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t("i18n.loadFailed")}
          <Button variant="outline" size="sm" onClick={() => void i18nQuery.refetch()}>
            {t("common:actions.retry")}
          </Button>
        </p>
      )}
      {(validationError || saveMutation.isError) && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {validationError ?? t("i18n.saveFailed")}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("i18n.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {i18nQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : rows.length === 0 ? (
            <EmptyState icon={Languages} title={t("i18n.table.empty")} />
          ) : (
            <ul className="space-y-3">
              {rows.map((row, idx) => (
                <li
                  key={idx}
                  className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-[auto_1fr_1fr_2fr_auto]"
                >
                  <LabeledInput
                    label={t("i18n.table.locale")}
                    value={row.locale}
                    onChange={(v) => updateRow(idx, { locale: v })}
                  />
                  <LabeledInput
                    label={t("i18n.table.namespace")}
                    value={row.namespace}
                    onChange={(v) => updateRow(idx, { namespace: v })}
                  />
                  <LabeledInput
                    label={t("i18n.table.key")}
                    value={row.key}
                    onChange={(v) => updateRow(idx, { key: v })}
                  />
                  <LabeledInput
                    label={t("i18n.table.value")}
                    value={row.value}
                    onChange={(v) => updateRow(idx, { value: v })}
                  />
                  <div className="flex items-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeRow(idx)}
                      aria-label={t("i18n.removeItem")}
                    >
                      {t("i18n.removeItem")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button onClick={onSave} disabled={saveMutation.isPending}>
            {t("i18n.save")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

interface LabeledInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

function LabeledInput({ label, value, onChange }: LabeledInputProps) {
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
