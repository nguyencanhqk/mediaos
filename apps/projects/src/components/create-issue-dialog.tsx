import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CreateTaskRequest, PriorityDto, ProjectStateDto } from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { tasksApi } from "@/lib/tasks-api";
import { PrioritySelect } from "@/components/priority-select";
import { useEmployeeOptions, employeeLabel } from "@/lib/use-members";

interface CreateIssueDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  states: ProjectStateDto[];
}

interface IssueFormState {
  title: string;
  priority: PriorityDto;
  stateId: string;
  description: string;
  assigneeUserId: string;
  dueDate: string;
}

const emptyForm: IssueFormState = {
  title: "",
  priority: "none",
  stateId: "",
  description: "",
  assigneeUserId: "",
  dueDate: "",
};

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * Dialog "Tạo công việc" đầy đủ — tiêu đề (bắt buộc) + ưu tiên + trạng thái + mô tả + người nhận + hạn.
 * Tạo office task gắn project. Server gated create:task. Invalidate board sau khi tạo.
 */
export function CreateIssueDialog({ open, onClose, projectId, states }: CreateIssueDialogProps) {
  const { t } = useTranslation("projects");
  const qc = useQueryClient();
  const [form, setForm] = useState<IssueFormState>(emptyForm);
  const { employees } = useEmployeeOptions();

  const update = <K extends keyof IssueFormState>(key: K, value: IssueFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const create = useMutation({
    mutationFn: () => {
      const body: CreateTaskRequest = {
        title: form.title.trim(),
        taskType: "office",
        projectId,
        priority: form.priority,
      };
      if (form.stateId) body.stateId = form.stateId;
      if (form.description.trim()) body.description = form.description.trim();
      if (form.assigneeUserId) body.assigneeUserId = form.assigneeUserId;
      if (form.dueDate) body.dueDate = new Date(form.dueDate).toISOString();
      return tasksApi.createTask(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["board", projectId] });
      setForm(emptyForm);
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!create.isPending) onClose();
      }}
      title={t("createIssue.title")}
      description={t("createIssue.description")}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={create.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={() => create.mutate()}
            disabled={!form.title.trim() || create.isPending}
          >
            {create.isPending ? t("createIssue.submitting") : t("createIssue.submit")}
          </Button>
        </>
      }
    >
      <FormField label={t("createIssue.fieldTitle")}>
        <Input
          value={form.title}
          onChange={(e) => update("title", e.target.value)}
          placeholder={t("createIssue.fieldTitlePlaceholder")}
          autoFocus
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("createIssue.fieldPriority")}>
          <PrioritySelect
            value={form.priority}
            onChange={(p) => update("priority", p)}
            aria-label={t("createIssue.fieldPriority")}
          />
        </FormField>

        <FormField label={t("createIssue.fieldState")}>
          <Select value={form.stateId} onChange={(e) => update("stateId", e.target.value)}>
            <option value="">{t("createIssue.noState")}</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <FormField label={t("createIssue.fieldDescription")}>
        <textarea
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          rows={3}
          placeholder={t("createIssue.fieldDescriptionPlaceholder")}
          className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("createIssue.fieldAssignee")}>
          <Select
            value={form.assigneeUserId}
            onChange={(e) => update("assigneeUserId", e.target.value)}
          >
            <option value="">{t("createIssue.unassigned")}</option>
            {employees.map((emp) => (
              <option key={emp.userId} value={emp.userId}>
                {employeeLabel(emp)}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label={t("createIssue.fieldDue")}>
          <Input
            type="date"
            value={form.dueDate}
            onChange={(e) => update("dueDate", e.target.value)}
          />
        </FormField>
      </div>

      {create.isError && (
        <p className="text-sm text-destructive">
          {t("createIssue.error")} {create.error instanceof Error ? create.error.message : ""}
        </p>
      )}
    </Dialog>
  );
}
