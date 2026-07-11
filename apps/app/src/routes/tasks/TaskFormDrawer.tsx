import { useForm, type FieldError } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  taskCoreApi,
  taskProjectApi,
  taskCoreInvalidation,
  hrApi,
  hrKeys,
  taskKeys,
  ApiError,
  useCan,
} from "@mediaos/web-core";
import { Dialog, Button, Input, Select } from "@mediaos/ui";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { useDirtyFormGuard } from "@/hooks/use-dirty-form-guard";
import { TASK_CORE_PRIORITY_OPTIONS } from "./constants";
import {
  taskFormSchema,
  taskToFormValues,
  taskFormToCreatePayload,
  taskFormToUpdatePayload,
  EMPTY_TASK_FORM,
  type TaskFormValues,
} from "./task-form-schema";

/**
 * TaskFormDrawer — tạo/sửa task core (S4-FE-TASK-2, SPEC-06 §13.6, TASK-SCREEN-006).
 *
 * Dựng trên `Dialog` (packages/ui — house style modal, mirror ProjectFormDrawer). Cổng ghi =
 * create:task/update:task đã qua useCan ở CALLER (form KHÔNG tự gate lại — chỉ mount khi caller đã cho
 * phép). Server là cổng thật. Project/Assignee/Department options lấy từ API scoped theo quyền đọc tương
 * ứng của actor (read:project/read:employee/read:department) — "chỉ hiện lựa chọn trong phạm vi" do
 * SERVER lọc, form không tự lọc thêm.
 */
interface TaskFormDrawerProps {
  mode: "create" | "edit";
  task?: TaskCoreResponseDto;
  onClose: () => void;
  onSuccess: (task: TaskCoreResponseDto) => void;
}

function submitErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "tasks.form.errors.conflict";
    if (err.status === 422 || err.status === 400) return "tasks.form.errors.validation";
    if (err.status === 403) return "tasks.form.errors.forbidden";
    if (err.status >= 500) return "tasks.form.errors.server";
  }
  return "tasks.form.errors.generic";
}

export function TaskFormDrawer({ mode, task, onClose, onSuccess }: TaskFormDrawerProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const isEdit = mode === "edit";
  const canReadEmployees = useCan("read", "employee");
  const canReadProjects = useCan("read", "project");
  const canReadDepartments = useCan("read", "department");

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    mode: "onSubmit",
    defaultValues: isEdit && task ? taskToFormValues(task) : EMPTY_TASK_FORM,
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty, isSubmitting },
  } = form;

  useDirtyFormGuard({ isDirty });

  const { data: projects } = useQuery({
    queryKey: taskKeys.projects.list({ limit: 100 }),
    queryFn: () => taskProjectApi.listProjects({ limit: 100 }),
    enabled: canReadProjects,
    staleTime: 60_000,
  });

  const { data: departments } = useQuery({
    queryKey: hrKeys.departments.list(),
    queryFn: () => hrApi.listDepartments(),
    enabled: canReadDepartments,
    staleTime: 5 * 60 * 1000,
  });

  const { data: employeesPage } = useQuery({
    queryKey: hrKeys.employees.list({ pageSize: 100, status: "active" }),
    queryFn: () => hrApi.listEmployees({ pageSize: 100, status: "active" }),
    enabled: canReadEmployees,
    staleTime: 60_000,
  });
  const employees = employeesPage?.items ?? [];

  const mutation = useMutation({
    mutationFn: async (values: TaskFormValues): Promise<TaskCoreResponseDto> => {
      if (isEdit && task) {
        return taskCoreApi.updateTask(task.id, taskFormToUpdatePayload(values));
      }
      return taskCoreApi.createTask(taskFormToCreatePayload(values));
    },
    onSuccess: async (result) => {
      await Promise.all(
        (isEdit && task ? taskCoreInvalidation.detail(task.id) : taskCoreInvalidation.list()).map(
          (queryKey) => queryClient.invalidateQueries({ queryKey }),
        ),
      );
      onSuccess(result);
    },
  });

  const busy = isSubmitting || mutation.isPending;
  const noop = () => {};
  const errFor = (e: FieldError | undefined) => (e ? t(e.message ?? "") : undefined);

  return (
    <Dialog
      open
      onClose={busy ? noop : onClose}
      title={t(isEdit ? "tasks.form.editTitle" : "tasks.form.createTitle")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("tasks.form.cancel")}
          </Button>
          <Button type="submit" form="task-core-form" disabled={busy}>
            {busy ? t("tasks.form.saving") : isEdit ? t("tasks.form.save") : t("tasks.form.create")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t(submitErrorKey(mutation.error))}
        </p>
      )}
      <form
        id="task-core-form"
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
      >
        <div className="space-y-1.5">
          <label htmlFor="task-title" className="text-sm font-medium text-foreground">
            {t("tasks.form.fields.title")}
            <span className="ml-0.5 text-destructive">*</span>
          </label>
          <Input id="task-title" autoComplete="off" {...register("title")} />
          {errors.title && (
            <p role="alert" className="text-sm text-destructive">
              {errFor(errors.title)}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="task-description" className="text-sm font-medium text-foreground">
            {t("tasks.form.fields.description")}
          </label>
          <textarea
            id="task-description"
            rows={3}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...register("description")}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="task-project" className="text-sm font-medium text-foreground">
            {t("tasks.form.fields.project")}
          </label>
          <Select id="task-project" {...register("projectId")}>
            <option value="">{t("tasks.form.placeholders.none")}</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="task-assignee" className="text-sm font-medium text-foreground">
            {t("tasks.form.fields.assignee")}
          </label>
          <Select id="task-assignee" {...register("assigneeEmployeeId")}>
            <option value="">{t("tasks.form.placeholders.none")}</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="task-department" className="text-sm font-medium text-foreground">
            {t("tasks.form.fields.department")}
          </label>
          <Select id="task-department" {...register("departmentId")}>
            <option value="">{t("tasks.form.placeholders.none")}</option>
            {(departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="task-priority" className="text-sm font-medium text-foreground">
            {t("tasks.form.fields.priority")}
          </label>
          <Select id="task-priority" {...register("priority")}>
            <option value="">{t("tasks.form.placeholders.none")}</option>
            {TASK_CORE_PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {t(`tasks.priority.${p}`)}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="task-start-at" className="text-sm font-medium text-foreground">
              {t("tasks.form.fields.startAt")}
            </label>
            <Input id="task-start-at" type="datetime-local" {...register("startAt")} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="task-due-at" className="text-sm font-medium text-foreground">
              {t("tasks.form.fields.dueAt")}
            </label>
            <Input id="task-due-at" type="datetime-local" {...register("dueAt")} />
            {errors.dueAt && (
              <p role="alert" className="text-sm text-destructive">
                {errFor(errors.dueAt)}
              </p>
            )}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
