import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TemplateStepDto } from "@/lib/workflow-builder/contract";
import { workflowTemplatesApi } from "@/lib/workflow-templates-api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { roleLabel, stepTypeLabel } from "./constants";
import {
  StepFormFields,
  emptyStepForm,
  toCreateStepRequest,
  toUpdateStepRequest,
  type StepFormState,
} from "./step-form-fields";

interface StepEditorProps {
  templateId: string;
  steps: TemplateStepDto[];
  /** Khoá sửa khi template đã published (D4 immutable). */
  disabled: boolean;
}

function stepToForm(step: TemplateStepDto): StepFormState {
  return {
    code: step.code,
    name: step.name,
    stepType: step.stepType,
    assigneeRoleCode: step.assigneeRoleCode ?? "",
    reviewerRoleCode: step.reviewerRoleCode ?? "",
    isRequired: step.isRequired,
  };
}

export function StepEditor({ templateId, steps, disabled }: StepEditorProps) {
  const { t } = useTranslation("workflows");
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TemplateStepDto | "new" | null>(null);
  const [form, setForm] = useState<StepFormState>(emptyStepForm);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["workflow-template", templateId] });

  const save = useMutation({
    mutationFn: () =>
      editing === "new"
        ? workflowTemplatesApi.addStep(templateId, toCreateStepRequest(form))
        : workflowTemplatesApi.updateStep(
            templateId,
            (editing as TemplateStepDto).id,
            toUpdateStepRequest(form),
          ),
    onSuccess: () => {
      void invalidate();
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: (stepId: string) => workflowTemplatesApi.removeStep(templateId, stepId),
    onSuccess: () => void invalidate(),
  });

  const openNew = () => {
    setForm(emptyStepForm);
    setEditing("new");
  };
  const openEdit = (step: TemplateStepDto) => {
    setForm(stepToForm(step));
    setEditing(step);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("steps.heading", { count: steps.length })}</h2>
        {!disabled && (
          <Button size="sm" variant="outline" onClick={openNew}>
            {t("steps.addBtn")}
          </Button>
        )}
      </div>

      {steps.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t("steps.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {steps.map((step) => (
            <li
              key={step.id}
              className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{step.name}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {step.code}
                  </span>
                  {!step.isRequired && (
                    <span className="text-xs text-muted-foreground">{t("steps.optional")}</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("steps.metaLine", { stepType: stepTypeLabel(step.stepType), assignee: roleLabel(step.assigneeRoleCode), reviewer: roleLabel(step.reviewerRoleCode) })}
                </p>
              </div>
              {!disabled && (
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(step)}>
                    {t("steps.editBtn")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => remove.mutate(step.id)}
                    disabled={remove.isPending}
                  >
                    {t("steps.deleteBtn")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? t("steps.dialog.titleNew") : t("steps.dialog.titleEdit")}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              {t("steps.dialog.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => save.mutate()}
              disabled={!form.code.trim() || !form.name.trim() || save.isPending}
            >
              {save.isPending ? t("steps.dialog.saving") : t("steps.dialog.save")}
            </Button>
          </>
        }
      >
        <StepFormFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
        {save.isError && (
          <p className="text-sm text-destructive">
            {save.error instanceof Error ? save.error.message : t("steps.saveError")}
          </p>
        )}
      </Dialog>
    </section>
  );
}
