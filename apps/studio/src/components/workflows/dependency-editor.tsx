import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { DependencyDto, TemplateStepDto } from "@/lib/workflow-builder/contract";
import { workflowTemplatesApi } from "@/lib/workflow-templates-api";
import { Button } from "@mediaos/ui";
import { Select } from "@mediaos/ui";

interface DependencyEditorProps {
  templateId: string;
  steps: TemplateStepDto[];
  dependencies: DependencyDto[];
  /** Khoá sửa khi template đã published. */
  disabled: boolean;
}

/**
 * Sửa cạnh DAG bằng dropdown (chưa canvas — 2c).
 * Quy ước: "fromStep" chạy trước (tiền nhiệm), "toStep" phụ thuộc (chạy sau).
 */
export function DependencyEditor({ templateId, steps, dependencies, disabled }: DependencyEditorProps) {
  const { t } = useTranslation("workflows");
  const qc = useQueryClient();
  const [fromStepId, setFromStepId] = useState("");
  const [toStepId, setToStepId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const titleById = useMemo(() => new Map(steps.map((s) => [s.id, s.name])), [steps]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["workflow-template", templateId] });

  const add = useMutation({
    mutationFn: () =>
      workflowTemplatesApi.addDependency(templateId, { fromStepId, toStepId, dependencyType: "finish_to_start" }),
    onSuccess: () => {
      void invalidate();
      setFromStepId("");
      setToStepId("");
    },
  });

  const remove = useMutation({
    mutationFn: (depId: string) => workflowTemplatesApi.removeDependency(templateId, depId),
    onSuccess: () => void invalidate(),
  });

  const onAdd = () => {
    setLocalError(null);
    if (!fromStepId || !toStepId) {
      setLocalError(t("dependencies.errorBothRequired"));
      return;
    }
    if (fromStepId === toStepId) {
      setLocalError(t("dependencies.errorSelfDep"));
      return;
    }
    add.mutate();
  };

  const canEdit = !disabled && steps.length >= 2;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t("dependencies.heading", { count: dependencies.length })}</h2>
      <p className="text-sm text-muted-foreground">
        {t("dependencies.description")}
      </p>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/20 p-3">
          <label className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">{t("dependencies.labelFrom")}</span>
            <Select
              className="h-9 w-52"
              value={fromStepId}
              onChange={(e) => setFromStepId(e.target.value)}
            >
              <option value="">{t("dependencies.selectStep")}</option>
              {steps.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </label>
          <span className="pb-2 text-muted-foreground">→</span>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">{t("dependencies.labelTo")}</span>
            <Select
              className="h-9 w-52"
              value={toStepId}
              onChange={(e) => setToStepId(e.target.value)}
            >
              <option value="">{t("dependencies.selectStep")}</option>
              {steps.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </label>
          <Button size="sm" onClick={onAdd} disabled={add.isPending}>
            {add.isPending ? t("dependencies.addingBtn") : t("dependencies.addBtn")}
          </Button>
        </div>
      )}

      {localError && <p className="text-sm text-destructive">{localError}</p>}
      {add.isError && (
        <p className="text-sm text-destructive">
          {add.error instanceof Error ? add.error.message : t("dependencies.addError")}
        </p>
      )}

      {dependencies.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("dependencies.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {dependencies.map((dep) => (
            <li
              key={dep.id}
              className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-2.5 text-sm"
            >
              <span>
                <span className="font-medium">{titleById.get(dep.toStepId) ?? "—"}</span>
                <span className="text-muted-foreground"> {t("dependencies.depLabel")} </span>
                <span className="font-medium">{titleById.get(dep.fromStepId) ?? "—"}</span>
              </span>
              {!disabled && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => remove.mutate(dep.id)}
                  disabled={remove.isPending}
                >
                  {t("dependencies.deleteBtn")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
