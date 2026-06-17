import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateProjectRequest } from "@mediaos/contracts";
import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";
import { Dialog } from "@mediaos/ui";
import { projectsApi } from "@/lib/projects-api";
import { useEmployeeOptions } from "@/components/channels/use-channel-options";
import { ProjectFormFields, emptyProjectForm, type ProjectFormState } from "./project-form-fields";

function toCreateRequest(f: ProjectFormState): CreateProjectRequest {
  const req: CreateProjectRequest = { name: f.name.trim() };
  const code = f.code.trim();
  if (code) req.code = code;
  if (f.projectType) req.projectType = f.projectType;
  const description = f.description.trim();
  if (description) req.description = description;
  if (f.ownerUserId) req.ownerUserId = f.ownerUserId;
  if (f.projectManagerId) req.projectManagerId = f.projectManagerId;
  if (f.startDate) req.startDate = f.startDate;
  if (f.endDate) req.endDate = f.endDate;
  if (f.priority) req.priority = f.priority;
  const budget = f.budget.trim();
  if (budget) req.budget = Number(budget);
  return req;
}

export function CreateProjectDialog() {
  const { t } = useTranslation("projects");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProjectFormState>(emptyProjectForm);
  const employees = useEmployeeOptions();

  const create = useMutation({
    mutationFn: () => projectsApi.createProject(toCreateRequest(form)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      setForm(emptyProjectForm);
      setOpen(false);
    },
  });

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t("createDialog.trigger")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("createDialog.title")}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t("linkDialogs.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => create.mutate()}
              disabled={!form.name.trim() || create.isPending}
            >
              {create.isPending ? t("createDialog.creating") : t("createDialog.submit")}
            </Button>
          </>
        }
      >
        <ProjectFormFields
          value={form}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          employees={employees}
        />
        {create.isError && (
          <p className="text-sm text-destructive">
            {t("createDialog.createFailed", {
              detail: create.error instanceof Error ? create.error.message : t("createDialog.createFailedUnknown"),
            })}
          </p>
        )}
      </Dialog>
    </>
  );
}
