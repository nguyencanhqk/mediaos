import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProjectDto, UpdateProjectRequest } from "@mediaos/contracts";
import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";
import { Dialog } from "@mediaos/ui";
import { projectsApi } from "@/lib/projects-api";
import { useEmployeeOptions } from "@/components/channels/use-channel-options";
import { ProjectFormFields, type ProjectFormState } from "./project-form-fields";

function toFormState(p: ProjectDto): ProjectFormState {
  return {
    name: p.name,
    code: p.code ?? "",
    projectType: p.projectType ?? "",
    description: p.description ?? "",
    ownerUserId: p.ownerUserId ?? "",
    projectManagerId: p.projectManagerId ?? "",
    startDate: p.startDate ?? "",
    endDate: p.endDate ?? "",
    priority: p.priority ?? "",
    budget: p.budget ?? "",
    status: p.status,
  };
}

/** Form → patch: gửi mọi field editable (null khi xoá) để PATCH partial áp đúng. */
function toUpdateRequest(f: ProjectFormState): UpdateProjectRequest {
  const budget = f.budget.trim();
  return {
    name: f.name.trim(),
    code: f.code.trim() || null,
    projectType: f.projectType || null,
    description: f.description.trim() || null,
    ownerUserId: f.ownerUserId || null,
    projectManagerId: f.projectManagerId || null,
    startDate: f.startDate || null,
    endDate: f.endDate || null,
    priority: f.priority || null,
    budget: budget ? Number(budget) : null,
    status: f.status,
  };
}

interface EditProjectDialogProps {
  project: ProjectDto;
  open: boolean;
  onClose: () => void;
}

export function EditProjectDialog({ project, open, onClose }: EditProjectDialogProps) {
  const { t } = useTranslation("projects");
  const qc = useQueryClient();
  const [form, setForm] = useState<ProjectFormState>(() => toFormState(project));
  const employees = useEmployeeOptions();

  // Re-sync khi mở lại / project đổi.
  useEffect(() => {
    if (open) setForm(toFormState(project));
  }, [open, project]);

  const update = useMutation({
    mutationFn: () => projectsApi.updateProject(project.id, toUpdateRequest(form)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("editDialog.title")}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("linkDialogs.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={() => update.mutate()}
            disabled={!form.name.trim() || update.isPending}
          >
            {update.isPending ? t("common:saving") : t("common:actions.save")}
          </Button>
        </>
      }
    >
      <ProjectFormFields
        value={form}
        onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        employees={employees}
        showStatus
      />
      {update.isError && (
        <p className="text-sm text-destructive">
          {t("editDialog.saveFailed", {
            detail: update.error instanceof Error ? update.error.message : t("editDialog.saveFailedUnknown"),
          })}
        </p>
      )}
    </Dialog>
  );
}
