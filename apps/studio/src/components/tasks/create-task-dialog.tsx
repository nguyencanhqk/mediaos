import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CreateTaskRequest, EmployeeListItemDto } from "@mediaos/contracts";
import { Button } from "@mediaos/ui";
import { Dialog } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
import { tasksApi } from "@/lib/tasks-api";
import { useEmployeeOptions } from "@/components/channels/use-channel-options";

/**
 * Dialog "Giao việc tay" (G9-2 / TASK-001) — tạo office task ngoài workflow (BẤT BIẾN #4).
 * Hiển thị gated bởi <PermissionGate create task> ở caller; BE vẫn là nguồn sự thật (gate `create:task`).
 * Office task không cần content/workflow — chỉ tiêu đề + (tuỳ chọn) người nhận + hạn.
 */
interface TaskFormState {
  title: string;
  assigneeUserId: string;
  dueDate: string; // yyyy-mm-dd từ <input type="date">; convert ISO khi submit
}

const emptyTaskForm: TaskFormState = { title: "", assigneeUserId: "", dueDate: "" };

function employeeLabel(e: EmployeeListItemDto): string {
  return e.userFullName ?? e.userEmail ?? e.userId;
}

function toCreateRequest(f: TaskFormState): CreateTaskRequest {
  const req: CreateTaskRequest = { title: f.title.trim(), taskType: "office" };
  if (f.assigneeUserId) req.assigneeUserId = f.assigneeUserId;
  // due_date lưu UTC-at-rest: <input type="date"> → ISO datetime (z.string().datetime()).
  if (f.dueDate) req.dueDate = new Date(f.dueDate).toISOString();
  return req;
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function CreateTaskDialog() {
  const { t } = useTranslation("tasks");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TaskFormState>(emptyTaskForm);
  const employees = useEmployeeOptions();

  const create = useMutation({
    mutationFn: () => tasksApi.createTask(toCreateRequest(form)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      setForm(emptyTaskForm);
      setOpen(false);
    },
  });

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t("createTask.triggerButton")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("createTask.dialogTitle")}
        description={t("createTask.dialogDescription")}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t("createTask.cancelButton")}
            </Button>
            <Button
              size="sm"
              onClick={() => create.mutate()}
              disabled={!form.title.trim() || create.isPending}
            >
              {create.isPending ? t("createTask.submitting") : t("createTask.submitButton")}
            </Button>
          </>
        }
      >
        <Field label={t("createTask.fieldTitle")}>
          <Input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder={t("createTask.fieldTitlePlaceholder")}
            autoFocus
          />
        </Field>

        <Field label={t("createTask.fieldAssignee")}>
          <Select
            value={form.assigneeUserId}
            onChange={(e) => setForm((f) => ({ ...f, assigneeUserId: e.target.value }))}
          >
            <option value="">{t("common:unassigned")}</option>
            {employees.map((emp) => (
              <option key={emp.userId} value={emp.userId}>
                {employeeLabel(emp)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("createTask.fieldDueDate")}>
          <Input
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
          />
        </Field>

        {create.isError && (
          <p className="text-sm text-destructive">
            {t("createTask.errorFailed")}{" "}
            {create.error instanceof Error ? create.error.message : t("createTask.errorUnknown")}
          </p>
        )}
      </Dialog>
    </>
  );
}
