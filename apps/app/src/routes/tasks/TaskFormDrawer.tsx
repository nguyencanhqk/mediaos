import { useEffect } from "react";
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
import { TASK_CORE_PRIORITY_OPTIONS, isoToLocalDatetime, localDatetimeToIso } from "./constants";
import { DeadlineQuickPicker } from "./DeadlineQuickPicker";
import {
  taskFormSchema,
  taskToFormValues,
  taskFormToCreatePayload,
  taskFormToUpdatePayload,
  editableDirtyFields,
  EMPTY_TASK_FORM,
  type TaskFormValues,
} from "./task-form-schema";
import { useTaskPatchFieldLocks, type TaskPatchFieldLocks } from "./task-patch-field-locks";
import { TaskFieldLockedHint } from "./TaskFieldLockedHint";
import { useMyEmployeeLink } from "./use-my-employee";
import { isAssigneeRejection } from "./task-quick-add-errors";

/**
 * TaskFormDrawer — tạo/sửa task core (S4-FE-TASK-2, SPEC-06 §13.6, TASK-SCREEN-006).
 *
 * Dựng trên `Dialog` (packages/ui — house style modal, mirror ProjectFormDrawer). Cổng ghi =
 * create:task/update:task đã qua useCan ở CALLER (form KHÔNG tự gate lại — chỉ mount khi caller đã cho
 * phép). Server là cổng thật. Project/Assignee/Department options lấy từ API scoped theo quyền đọc tương
 * ứng của actor (read:project/read:employee/read:department) — "chỉ hiện lựa chọn trong phạm vi" do
 * SERVER lọc, form không tự lọc thêm.
 *
 * S20-SEC-TASKPATCHGATE-1 — chế độ SỬA: ô hạn / ưu tiên / người phụ trách khoá theo cặp quyền chuyên
 * trách server trả (`useTaskPatchFieldLocks`); payload CHỈ gồm trường người dùng đã sửa và không bị
 * khoá (server đòi cặp khi trường ĐỔI, thiếu ⇒ 403 cả request). Chế độ TẠO không đổi.
 *
 * S20-TASK-QUICKEDIT-1 — cạnh ô hạn có popover mốc nhanh dùng chung (DeadlineQuickPicker): chọn mốc
 * chỉ ĐIỀN ô (đánh dấu đã sửa), lưu vẫn theo nút Lưu như mọi trường khác của form.
 *
 * S20-TASK-QUICKADD-1 (US-TASK-NV-05) — chế độ TẠO: luôn có lựa chọn «Tôi» (employeeId của tôi từ
 * `/auth/me`, không cần `read:employee`); không mở từ dự án ⇒ người phụ trách điền sẵn «Tôi», đổi được.
 * Server từ chối vì người phụ trách ⇒ lỗi TẠI Ô người phụ trách. `defaultProject` (board) ⇒ ô dự án
 * chọn sẵn dự án đó (có option riêng dù danh sách dự án chưa tải / không được đọc).
 */
interface TaskFormDrawerProps {
  mode: "create" | "edit";
  task?: TaskCoreResponseDto;
  onClose: () => void;
  onSuccess: (task: TaskCoreResponseDto) => void;
  /** Chỉ chế độ TẠO: dự án điền sẵn (mở từ board/workspace). */
  defaultProject?: { readonly id: string; readonly name: string | null };
}

const NO_FIELD_LOCKS: TaskPatchFieldLocks = {
  assigneeEmployeeId: false,
  priority: false,
  dueAt: false,
};

function submitErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "tasks.form.errors.conflict";
    if (err.status === 422 || err.status === 400) return "tasks.form.errors.validation";
    if (err.status === 403) return "tasks.form.errors.forbidden";
    if (err.status >= 500) return "tasks.form.errors.server";
  }
  return "tasks.form.errors.generic";
}

export function TaskFormDrawer({
  mode,
  task,
  onClose,
  onSuccess,
  defaultProject,
}: TaskFormDrawerProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const isEdit = mode === "edit";
  const canReadEmployees = useCan("read", "employee");
  const canReadProjects = useCan("read", "project");
  const canReadDepartments = useCan("read", "department");
  const editLocks = useTaskPatchFieldLocks();
  const locked = isEdit ? editLocks : NO_FIELD_LOCKS;
  const me = useMyEmployeeLink(!isEdit);
  const myEmployeeId = me.status === "linked" ? me.employeeId : null;
  const defaultProjectId = isEdit ? undefined : defaultProject?.id;

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    mode: "onSubmit",
    defaultValues:
      isEdit && task
        ? taskToFormValues(task)
        : { ...EMPTY_TASK_FORM, projectId: defaultProjectId ?? "" },
  });

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    watch,
    resetField,
    getValues,
    getFieldState,
    formState: { errors, isDirty, isSubmitting, dirtyFields },
  } = form;

  // Tạo việc ngoài dự án ⇒ người phụ trách mặc định là TÔI (phạm vi Own/Team bắt buộc có người — thiếu
  // là 403). Chạy khi /auth/me về; `resetField` đổi cả giá trị mặc định ⇒ form vẫn «chưa sửa». Người
  // dùng đã tự chọn người / chọn dự án trước đó thì không đè.
  useEffect(() => {
    if (isEdit || defaultProjectId || !myEmployeeId) return;
    if (getFieldState("assigneeEmployeeId").isDirty) return;
    if (getValues("assigneeEmployeeId") || getValues("projectId")) return;
    resetField("assigneeEmployeeId", { defaultValue: myEmployeeId });
  }, [isEdit, defaultProjectId, myEmployeeId, getFieldState, getValues, resetField]);

  useDirtyFormGuard({ isDirty });

  const { data: projects } = useQuery({
    queryKey: taskKeys.projects.list({ limit: 100 }),
    queryFn: () => taskProjectApi.listProjects({ limit: 100 }),
    enabled: canReadProjects,
    staleTime: 60_000,
  });

  const { data: departments } = useQuery({
    queryKey: hrKeys.departments.lookup(),
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
  // «Tôi» là option riêng ⇒ bỏ chính tôi khỏi danh sách để không lặp.
  const employees = (employeesPage?.items ?? []).filter((e) => e.id !== myEmployeeId);
  const showDefaultProjectOption =
    defaultProjectId !== undefined && !(projects ?? []).some((p) => p.id === defaultProjectId);

  const mutation = useMutation({
    mutationFn: async (values: TaskFormValues): Promise<TaskCoreResponseDto> => {
      if (isEdit && task) {
        const payload = taskFormToUpdatePayload(values, editableDirtyFields(dirtyFields, locked));
        // Không sửa gì ⇒ không gọi API (PATCH rỗng bị server từ chối 400).
        if (Object.keys(payload).length === 0) return task;
        return taskCoreApi.updateTask(task.id, payload);
      }
      return taskCoreApi.createTask(taskFormToCreatePayload(values));
    },
    onSuccess: async (result) => {
      // S5-TASK-BOARD-UX-1 — board Kanban KHÔNG nằm dưới prefix `tasks/list`, nên chỉ invalidate
      // list/detail thì thẻ mới (hoặc tiêu đề vừa sửa) không lên board cho tới khi hết staleTime 15s
      // (refetchOnWindowFocus đang tắt) — người dùng đọc là "tạo xong mà board trống". Thêm khoá
      // kanban + report của ĐÚNG dự án, mirror taskSubtaskInvalidation.afterMutate.
      const projectId = result.projectId ?? task?.projectId ?? null;
      const keys = [
        ...(isEdit && task
          ? taskCoreInvalidation.detail(task.id)
          : [...taskCoreInvalidation.list(), ...taskCoreInvalidation.my()]),
        ...(projectId ? [taskKeys.kanban(projectId), taskKeys.projects.report(projectId)] : []),
      ];
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      onSuccess(result);
    },
    onError: (err) => {
      if (isAssigneeRejection(err)) {
        setError("assigneeEmployeeId", {
          type: "server",
          message: "quickAdd.form.assigneeOutOfScope",
        });
      }
    },
  });
  const assigneeRejected = mutation.isError && isAssigneeRejection(mutation.error);

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
      {mutation.isError && !assigneeRejected && (
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
          {/*
           * S5-TASK-MOVEPROJ-1 — chọn dự án CHỈ khi TẠO. Ở chế độ SỬA hiện chữ chỉ-đọc: đổi dự án
           * còn phải chọn CỘT đích của dự án mới (nếu không `state_id` mồ côi — xem docblock
           * taskFormToUpdatePayload), nên nó đi đường riêng `TaskMoveProjectDialog`. Không dùng
           * `disabled` trên ô đã register: react-hook-form có thể trả `undefined` ⇒ payload gửi
           * `projectId: null` ⇒ GỠ task khỏi dự án — hỏng nặng hơn thứ đang vá.
           */}
          {isEdit ? (
            <>
              <p className="text-sm text-foreground">
                {task?.projectName ?? t("tasks.form.placeholders.none")}
              </p>
              <p className="text-xs text-muted-foreground">{t("tasks.form.hints.moveProject")}</p>
            </>
          ) : (
            <Select id="task-project" {...register("projectId")}>
              <option value="">{t("tasks.form.placeholders.none")}</option>
              {showDefaultProjectOption && (
                <option value={defaultProjectId}>
                  {defaultProject?.name ?? t("quickAdd.form.currentProject")}
                </option>
              )}
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="task-assignee" className="text-sm font-medium text-foreground">
            {t("tasks.form.fields.assignee")}
          </label>
          <Select
            id="task-assignee"
            {...register("assigneeEmployeeId", {
              // Lỗi «ngoài phạm vi» của server gắn với lựa chọn CŨ — đổi người thì gỡ ngay.
              onChange: () => clearErrors("assigneeEmployeeId"),
            })}
            disabled={locked.assigneeEmployeeId}
            aria-invalid={errors.assigneeEmployeeId ? true : undefined}
            aria-describedby={
              locked.assigneeEmployeeId
                ? "task-assignee-locked"
                : errors.assigneeEmployeeId
                  ? "task-assignee-error"
                  : undefined
            }
          >
            <option value="">{t("tasks.form.placeholders.none")}</option>
            {myEmployeeId && (
              <option value={myEmployeeId}>
                {me.status === "linked" && me.fullName
                  ? t("quickAdd.form.meNamed", { name: me.fullName })
                  : t("quickAdd.form.me")}
              </option>
            )}
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
              </option>
            ))}
          </Select>
          {locked.assigneeEmployeeId && <TaskFieldLockedHint id="task-assignee-locked" />}
          {errors.assigneeEmployeeId && (
            <p id="task-assignee-error" role="alert" className="text-sm text-destructive">
              {errFor(errors.assigneeEmployeeId)}
            </p>
          )}
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
          <Select
            id="task-priority"
            {...register("priority")}
            disabled={locked.priority}
            aria-describedby={locked.priority ? "task-priority-locked" : undefined}
          >
            <option value="">{t("tasks.form.placeholders.none")}</option>
            {TASK_CORE_PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {t(`tasks.priority.${p}`)}
              </option>
            ))}
          </Select>
          {locked.priority && <TaskFieldLockedHint id="task-priority-locked" />}
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
            <Input
              id="task-due-at"
              type="datetime-local"
              {...register("dueAt")}
              disabled={locked.dueAt}
              aria-describedby={locked.dueAt ? "task-due-at-locked" : undefined}
            />
            {!locked.dueAt && (
              <DeadlineQuickPicker
                id="task-due-at-quick"
                variant="quick"
                allowCustom={false}
                ariaLabel={t("deadlinePicker.triggerLabel")}
                value={localDatetimeToIso(watch("dueAt")) ?? null}
                onSelect={(dueAt) =>
                  setValue("dueAt", isoToLocalDatetime(dueAt), {
                    shouldDirty: true,
                    shouldValidate: false,
                  })
                }
              />
            )}
            {locked.dueAt && <TaskFieldLockedHint id="task-due-at-locked" />}
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
