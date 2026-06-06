import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateProjectRequest } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
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
        + Thêm dự án
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Thêm dự án mới"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button
              size="sm"
              onClick={() => create.mutate()}
              disabled={!form.name.trim() || create.isPending}
            >
              {create.isPending ? "Đang tạo…" : "Tạo dự án"}
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
            Tạo dự án thất bại:{" "}
            {create.error instanceof Error ? create.error.message : "Lỗi không xác định"}
          </p>
        )}
      </Dialog>
    </>
  );
}
