import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useForm, type UseFormRegister, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  taskCoreApi,
  taskSubtaskInvalidation,
  hrApi,
  hrKeys,
  useCan,
  ApiError,
} from "@mediaos/web-core";
import { Button, Input, Select, Dialog } from "@mediaos/ui";
import type { SubtaskListItemDto } from "@mediaos/contracts";
import {
  subtaskFormSchema,
  subtaskFormToUpdatePayload,
  subtaskItemToFormValues,
  type SubtaskFormValues,
} from "./subtask-form-schema";
import { editableDirtyFields } from "./task-form-schema";
import { useTaskPatchFieldLocks, type TaskPatchFieldLocks } from "./task-patch-field-locks";
import { TaskFieldLockedHint } from "./TaskFieldLockedHint";

/**
 * Dialog Sửa/Xoá 1 việc con — tách khỏi TaskSubtaskPanel.tsx (S5-TASK-SUBTASK-1) để giữ mỗi file
 * <400 dòng (CLAUDE.md §5 "nhiều file nhỏ"). Thêm việc con KHÔNG còn qua hộp thoại: ô nhập inline cuối
 * danh sách (TaskSubtaskPanelQuickAdd.tsx, S20-TASK-QUICKENTRY-1). Sửa dùng update:task (PATCH); xoá
 * dùng delete:task (sensitive) — gate ở CALLER (TaskSubtaskPanel), component ở đây KHÔNG tự gate lại.
 */
export function subtaskErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400 || err.status === 422) return "tasks.detail.subtasks.errors.validation";
    if (err.status === 403) return "tasks.detail.subtasks.errors.forbidden";
    if (err.status === 404) return "tasks.detail.subtasks.errors.notFound";
    if (err.status >= 500) return "tasks.detail.subtasks.errors.server";
  }
  return "tasks.detail.subtasks.errors.generic";
}

/** 3 field dùng chung cho form Thêm/Sửa (D-31: title bắt buộc; assignee/due tuỳ chọn). Options nhân
 * viên lấy từ `hrApi.listEmployees` (read:employee) — server đã lọc theo data-scope của actor, mirror
 * TaskFormDrawer/TaskAssignControl. S20-SEC-TASKPATCHGATE-1: `locked` khoá ô người phụ trách / hạn
 * khi thiếu cặp chuyên trách (`assign:task` / `update-deadline:task`) — server đòi cặp khi trường ĐỔI. */
function SubtaskFormFields({
  idPrefix,
  register,
  errors,
  employees,
  locked,
}: {
  idPrefix: string;
  register: UseFormRegister<SubtaskFormValues>;
  errors: FieldErrors<SubtaskFormValues>;
  employees: Array<{ id: string; fullName: string }>;
  locked: Pick<TaskPatchFieldLocks, "assigneeEmployeeId" | "dueAt">;
}) {
  const { t } = useTranslation("tasks");
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-title`} className="text-sm font-medium text-foreground">
          {t("tasks.detail.subtasks.fields.title")}
          <span className="ml-0.5 text-destructive">*</span>
        </label>
        <Input id={`${idPrefix}-title`} autoComplete="off" {...register("title")} />
        {errors.title && (
          <p role="alert" className="text-sm text-destructive">
            {t(errors.title.message ?? "")}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-assignee`} className="text-sm font-medium text-foreground">
          {t("tasks.detail.subtasks.fields.assignee")}
        </label>
        <Select
          id={`${idPrefix}-assignee`}
          {...register("assigneeEmployeeId")}
          disabled={locked.assigneeEmployeeId}
          aria-describedby={locked.assigneeEmployeeId ? `${idPrefix}-assignee-locked` : undefined}
        >
          <option value="">{t("tasks.form.placeholders.none")}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.fullName}
            </option>
          ))}
        </Select>
        {locked.assigneeEmployeeId && <TaskFieldLockedHint id={`${idPrefix}-assignee-locked`} />}
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-due`} className="text-sm font-medium text-foreground">
          {t("tasks.detail.subtasks.fields.dueAt")}
        </label>
        <Input
          id={`${idPrefix}-due`}
          type="datetime-local"
          {...register("dueAt")}
          disabled={locked.dueAt}
          aria-describedby={locked.dueAt ? `${idPrefix}-due-locked` : undefined}
        />
        {locked.dueAt && <TaskFieldLockedHint id={`${idPrefix}-due-locked`} />}
      </div>
    </div>
  );
}

/**
 * Nhân viên đã chuẩn hoá thành option cho <Select>: `fullName` của HR DTO là nullable
 * (bị mask hoặc chưa nhập), nên rơi về mã nhân viên để option không bao giờ rỗng.
 */
function useEmployeeOptions(): Array<{ id: string; fullName: string }> {
  const canReadEmployees = useCan("read", "employee");
  const { data } = useQuery({
    queryKey: hrKeys.employees.list({ pageSize: 100, status: "active" }),
    queryFn: () => hrApi.listEmployees({ pageSize: 100, status: "active" }),
    enabled: canReadEmployees,
    staleTime: 60_000,
  });
  return useMemo(
    () =>
      (data?.items ?? []).map((e) => ({
        id: e.id,
        fullName: e.fullName ?? e.employeeCode ?? "—",
      })),
    [data],
  );
}

export function EditSubtaskDialog({
  parentTaskId,
  projectId,
  item,
  onClose,
}: {
  parentTaskId: string;
  projectId: string | null;
  item: SubtaskListItemDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const employees = useEmployeeOptions();
  const locked = useTaskPatchFieldLocks();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<SubtaskFormValues>({
    resolver: zodResolver(subtaskFormSchema),
    mode: "onSubmit",
    defaultValues: subtaskItemToFormValues(item),
  });

  const mutation = useMutation({
    mutationFn: async (values: SubtaskFormValues) => {
      const payload = subtaskFormToUpdatePayload(values, editableDirtyFields(dirtyFields, locked));
      // Không sửa gì ⇒ không gọi API (PATCH rỗng bị server từ chối 400).
      if (Object.keys(payload).length === 0) return null;
      return taskCoreApi.updateTask(item.id, payload);
    },
    onSuccess: async () => {
      await Promise.all(
        taskSubtaskInvalidation
          .afterMutate(parentTaskId, projectId)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onClose();
    },
  });

  const busy = isSubmitting || mutation.isPending;
  const noop = () => {};

  return (
    <Dialog
      open
      onClose={busy ? noop : onClose}
      title={t("tasks.detail.subtasks.editDialog.title")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("tasks.detail.subtasks.editDialog.cancel")}
          </Button>
          <Button type="submit" form="subtask-edit-form" disabled={busy}>
            {busy
              ? t("tasks.detail.subtasks.editDialog.saving")
              : t("tasks.detail.subtasks.editDialog.confirm")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t(subtaskErrorKey(mutation.error))}
        </p>
      )}
      <form
        id="subtask-edit-form"
        noValidate
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
      >
        <SubtaskFormFields
          idPrefix="subtask-edit"
          register={register}
          errors={errors}
          employees={employees}
          locked={locked}
        />
      </form>
    </Dialog>
  );
}

export function DeleteSubtaskConfirm({
  parentTaskId,
  projectId,
  item,
  onClose,
}: {
  parentTaskId: string;
  projectId: string | null;
  item: SubtaskListItemDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => taskCoreApi.deleteTask(item.id),
    onSuccess: async () => {
      await Promise.all(
        taskSubtaskInvalidation
          .afterMutate(parentTaskId, projectId)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onClose();
    },
  });
  const noop = () => {};

  return (
    <Dialog
      open
      onClose={mutation.isPending ? noop : onClose}
      title={t("tasks.detail.subtasks.deleteDialog.title")}
      description={t("tasks.detail.subtasks.deleteDialog.description", { title: item.title })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("tasks.detail.subtasks.deleteDialog.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {t("tasks.detail.subtasks.deleteDialog.confirm")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t(subtaskErrorKey(mutation.error))}
        </p>
      )}
    </Dialog>
  );
}
