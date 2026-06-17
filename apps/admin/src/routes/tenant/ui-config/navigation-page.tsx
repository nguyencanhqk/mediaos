import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  putUiNavigationRequestSchema,
  type UiNavigationItemDto,
} from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCan } from "@/hooks/use-can";
import { uiConfigApi } from "@/lib/ui-config-api";

type Row = {
  key: string;
  label: string;
  route: string;
  moduleKey: string;
  isVisible: boolean;
};

function toRow(item: UiNavigationItemDto): Row {
  return {
    key: item.key,
    label: item.label,
    route: item.route,
    moduleKey: item.moduleKey ?? "",
    isVisible: item.isVisible,
  };
}

/**
 * AC-4 Navigation editor — self-service company-admin. Gate `manage:ui-navigation` ở BE.
 * Mục gắn module sẽ tự ẩn khỏi menu hiệu lực khi module tắt (BE gate, KHÔNG phải việc của trang này).
 */
export function NavigationPage() {
  const { t } = useTranslation("ui-config");
  const queryClient = useQueryClient();
  const canManage = useCan("manage", "ui-navigation");
  const [rows, setRows] = React.useState<Row[]>([]);
  const [flash, setFlash] = React.useState<string | null>(null);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  const navQuery = useQuery({
    queryKey: ["ui-config", "navigation"],
    queryFn: uiConfigApi.getNavigation,
    enabled: canManage,
  });

  React.useEffect(() => {
    if (navQuery.data) setRows(navQuery.data.map(toRow));
  }, [navQuery.data]);

  const saveMutation = useMutation({
    mutationFn: uiConfigApi.updateNavigation,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ui-config", "navigation"] });
      setFlash(t("navigation.saved"));
    },
  });

  if (!canManage) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <EmptyState
          icon={Menu}
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
    setRows((prev) => [
      ...prev,
      { key: "", label: "", route: "", moduleKey: "", isVisible: true },
    ]);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function onSave() {
    setValidationError(null);
    setFlash(null);
    const items = rows.map((r, idx) => ({
      key: r.key.trim(),
      label: r.label.trim(),
      route: r.route.trim(),
      icon: null,
      parentKey: null,
      displayOrder: idx,
      moduleKey: r.moduleKey.trim() === "" ? null : r.moduleKey.trim(),
      isVisible: r.isVisible,
    }));
    const parsed = putUiNavigationRequestSchema.safeParse({ items });
    if (!parsed.success) {
      const dup = parsed.error.issues.some((i) => i.path.includes("items"));
      setValidationError(dup ? t("navigation.duplicateKey") : t("navigation.saveFailed"));
      return;
    }
    saveMutation.mutate(parsed.data);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t("navigation.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("navigation.subtitle")}</p>
        </div>
        <Button variant="outline" onClick={addRow}>
          {t("navigation.addItem")}
        </Button>
      </header>

      {flash && (
        <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          {flash}
        </p>
      )}
      {navQuery.isError && (
        <p
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t("navigation.loadFailed")}
          <Button variant="outline" size="sm" onClick={() => void navQuery.refetch()}>
            {t("common:actions.retry")}
          </Button>
        </p>
      )}
      {(validationError || saveMutation.isError) && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {validationError ?? t("navigation.saveFailed")}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("navigation.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {navQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : rows.length === 0 ? (
            <EmptyState icon={Menu} title={t("navigation.table.empty")} />
          ) : (
            <ul className="space-y-3">
              {rows.map((row, idx) => (
                <li
                  key={idx}
                  className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]"
                >
                  <LabeledInput
                    label={t("navigation.table.key")}
                    value={row.key}
                    onChange={(v) => updateRow(idx, { key: v })}
                  />
                  <LabeledInput
                    label={t("navigation.table.label")}
                    value={row.label}
                    onChange={(v) => updateRow(idx, { label: v })}
                  />
                  <LabeledInput
                    label={t("navigation.table.route")}
                    value={row.route}
                    onChange={(v) => updateRow(idx, { route: v })}
                  />
                  <LabeledInput
                    label={t("navigation.table.module")}
                    value={row.moduleKey}
                    placeholder={t("navigation.noModule")}
                    onChange={(v) => updateRow(idx, { moduleKey: v })}
                  />
                  <div className="flex items-end gap-2">
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={row.isVisible}
                        aria-label={t("navigation.table.visible")}
                        onChange={(e) => updateRow(idx, { isVisible: e.target.checked })}
                      />
                      {t("navigation.table.visible")}
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeRow(idx)}
                      aria-label={t("navigation.removeItem")}
                    >
                      {t("navigation.removeItem")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button onClick={onSave} disabled={saveMutation.isPending}>
            {t("navigation.save")}
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
  placeholder?: string;
}

function LabeledInput({ label, value, onChange, placeholder }: LabeledInputProps) {
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
