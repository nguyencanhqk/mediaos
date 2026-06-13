import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateTaskRequest, EmployeeListItemDto } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
        + Giao việc
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Giao việc tay"
        description="Tạo công việc ngoài quy trình (office) — không gắn video/workflow."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button
              size="sm"
              onClick={() => create.mutate()}
              disabled={!form.title.trim() || create.isPending}
            >
              {create.isPending ? "Đang tạo…" : "Giao việc"}
            </Button>
          </>
        }
      >
        <Field label="Tiêu đề công việc *">
          <Input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="VD: Soạn báo cáo tuần…"
            autoFocus
          />
        </Field>

        <Field label="Người nhận việc">
          <Select
            value={form.assigneeUserId}
            onChange={(e) => setForm((f) => ({ ...f, assigneeUserId: e.target.value }))}
          >
            <option value="">— Chưa gán —</option>
            {employees.map((emp) => (
              <option key={emp.userId} value={emp.userId}>
                {employeeLabel(emp)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Hạn hoàn thành">
          <Input
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
          />
        </Field>

        {create.isError && (
          <p className="text-sm text-destructive">
            Giao việc thất bại:{" "}
            {create.error instanceof Error ? create.error.message : "Lỗi không xác định"}
          </p>
        )}
      </Dialog>
    </>
  );
}
