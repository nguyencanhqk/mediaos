import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TemplateStepDto } from "@/lib/workflow-builder/contract";
import { workflowTemplatesApi } from "@/lib/workflow-templates-api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { STEP_TYPE_LABELS, roleLabel } from "./constants";
import {
  StepFormFields,
  emptyStepForm,
  toStepRequest,
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
    title: step.title,
    stepType: step.stepType,
    assigneeRoleCode: step.assigneeRoleCode ?? "",
    reviewerRoleCode: step.reviewerRoleCode ?? "",
    isRequired: step.isRequired,
  };
}

export function StepEditor({ templateId, steps, disabled }: StepEditorProps) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TemplateStepDto | "new" | null>(null);
  const [form, setForm] = useState<StepFormState>(emptyStepForm);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["workflow-template", templateId] });

  const save = useMutation({
    mutationFn: () => {
      const req = toStepRequest(form);
      return editing === "new"
        ? workflowTemplatesApi.addStep(templateId, req)
        : workflowTemplatesApi.updateStep(templateId, (editing as TemplateStepDto).id, req);
    },
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
        <h2 className="text-lg font-semibold">Các bước ({steps.length})</h2>
        {!disabled && (
          <Button size="sm" variant="outline" onClick={openNew}>
            + Thêm bước
          </Button>
        )}
      </div>

      {steps.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Chưa có bước nào. Thêm bước đầu tiên để bắt đầu.
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
                  <span className="font-medium">{step.title}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {step.code}
                  </span>
                  {!step.isRequired && (
                    <span className="text-xs text-muted-foreground">(không bắt buộc)</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {STEP_TYPE_LABELS[step.stepType]} · Thực hiện: {roleLabel(step.assigneeRoleCode)} ·
                  Duyệt: {roleLabel(step.reviewerRoleCode)}
                </p>
              </div>
              {!disabled && (
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(step)}>
                    Sửa
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => remove.mutate(step.id)}
                    disabled={remove.isPending}
                  >
                    Xoá
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
        title={editing === "new" ? "Thêm bước" : "Sửa bước"}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Huỷ
            </Button>
            <Button
              size="sm"
              onClick={() => save.mutate()}
              disabled={!form.code.trim() || !form.title.trim() || save.isPending}
            >
              {save.isPending ? "Đang lưu…" : "Lưu"}
            </Button>
          </>
        }
      >
        <StepFormFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
        {save.isError && (
          <p className="text-sm text-destructive">
            {save.error instanceof Error ? save.error.message : "Lưu bước thất bại."}
          </p>
        )}
      </Dialog>
    </section>
  );
}
