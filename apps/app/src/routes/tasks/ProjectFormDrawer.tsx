import { useForm, type FieldError } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  taskProjectApi,
  taskProjectInvalidation,
  hrApi,
  hrKeys,
  ApiError,
  useCan,
} from "@mediaos/web-core";
import { Dialog, Button, Input, Select } from "@mediaos/ui";
import type { TaskProjectResponseDto } from "@mediaos/contracts";
import { useDirtyFormGuard } from "@/hooks/use-dirty-form-guard";
import {
  projectFormSchema,
  projectToFormValues,
  projectToCreatePayload,
  projectToUpdatePayload,
  PROJECT_PRIORITY_OPTIONS,
  EMPTY_PROJECT_FORM,
  type ProjectFormValues,
} from "./project-form-schema";

/**
 * ProjectFormDrawer — tạo/sửa dự án (S4-FE-TASK-1, SPEC-06 §13.2, TASK-SCREEN-002).
 *
 * Dựng trên `Dialog` (packages/ui — KHÔNG có primitive "Drawer" riêng, house style dùng modal căn giữa
 * cho form tạo/sửa — mirror MasterDataFormDialog). Cổng ghi = TASK.PROJECT.CREATE/UPDATE (đã qua useCan ở
 * component gọi, form KHÔNG tự gate lại — chỉ mount khi caller đã cho phép). Server là cổng thật.
 */
interface ProjectFormDrawerProps {
  mode: "create" | "edit";
  project?: TaskProjectResponseDto;
  /** S5-TASK-NAV-TREE-1 — prefill phòng ban khi tạo từ menu ⋯ của cây sidebar (chỉ mode "create"). */
  initialDepartmentId?: string;
  onClose: () => void;
  onSuccess: (project: TaskProjectResponseDto) => void;
}

function submitErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "projects.form.errors.conflict";
    if (err.status === 422 || err.status === 400) return "projects.form.errors.validation";
    if (err.status === 403) return "projects.form.errors.forbidden";
    if (err.status >= 500) return "projects.form.errors.server";
  }
  return "projects.form.errors.generic";
}

function isCodeConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && /CODE-TAKEN/.test(err.message);
}

export function ProjectFormDrawer({
  mode,
  project,
  initialDepartmentId,
  onClose,
  onSuccess,
}: ProjectFormDrawerProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const isEdit = mode === "edit";
  const canReadEmployees = useCan("read", "employee");

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    mode: "onSubmit",
    defaultValues:
      isEdit && project
        ? projectToFormValues(project)
        : {
            ...EMPTY_PROJECT_FORM,
            departmentId: initialDepartmentId ?? EMPTY_PROJECT_FORM.departmentId,
          },
  });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = form;

  useDirtyFormGuard({ isDirty });

  const { data: departments } = useQuery({
    queryKey: hrKeys.departments.list(),
    queryFn: () => hrApi.listDepartments(),
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
    mutationFn: async (values: ProjectFormValues): Promise<TaskProjectResponseDto> => {
      if (isEdit && project) {
        return taskProjectApi.updateProject(project.id, projectToUpdatePayload(values));
      }
      return taskProjectApi.createProject(projectToCreatePayload(values));
    },
    onSuccess: async (result) => {
      await Promise.all(
        (isEdit && project
          ? taskProjectInvalidation.detail(project.id)
          : taskProjectInvalidation.list()
        ).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onSuccess(result);
    },
    onError: (err) => {
      if (isCodeConflict(err)) {
        setError("code", { message: "projects.form.errors.conflict" });
      } else if (err instanceof ApiError && err.status === 409) {
        setError("name", { message: "projects.form.errors.conflict" });
      }
    },
  });

  const busy = isSubmitting || mutation.isPending;
  const noop = () => {};
  const errFor = (e: FieldError | undefined) => (e ? t(e.message ?? "") : undefined);

  return (
    <Dialog
      open
      onClose={busy ? noop : onClose}
      title={t(isEdit ? "projects.form.editTitle" : "projects.form.createTitle")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("projects.form.cancel")}
          </Button>
          <Button type="submit" form="project-form" disabled={busy}>
            {busy
              ? t("projects.form.saving")
              : isEdit
                ? t("projects.form.save")
                : t("projects.form.create")}
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
        id="project-form"
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
      >
        <div className="space-y-1.5">
          <label htmlFor="project-name" className="text-sm font-medium text-foreground">
            {t("projects.form.fields.name")}
            <span className="ml-0.5 text-destructive">*</span>
          </label>
          <Input id="project-name" autoComplete="off" {...register("name")} />
          {errors.name && (
            <p role="alert" className="text-sm text-destructive">
              {errFor(errors.name)}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="project-code" className="text-sm font-medium text-foreground">
            {t("projects.form.fields.code")}
          </label>
          <Input id="project-code" autoComplete="off" {...register("code")} />
          {errors.code && (
            <p role="alert" className="text-sm text-destructive">
              {errFor(errors.code)}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="project-description" className="text-sm font-medium text-foreground">
            {t("projects.form.fields.description")}
          </label>
          <textarea
            id="project-description"
            rows={3}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...register("description")}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="project-owner" className="text-sm font-medium text-foreground">
            {t("projects.form.fields.owner")}
          </label>
          <Select id="project-owner" {...register("ownerEmployeeId")}>
            <option value="">{t("projects.form.placeholders.none")}</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
              </option>
            ))}
          </Select>
          {!canReadEmployees && (
            <p className="text-xs text-muted-foreground">
              {t("projects.form.placeholders.ownerHint")}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="project-department" className="text-sm font-medium text-foreground">
            {t("projects.form.fields.department")}
          </label>
          <Select id="project-department" {...register("departmentId")}>
            <option value="">{t("projects.form.placeholders.none")}</option>
            {(departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="project-priority" className="text-sm font-medium text-foreground">
            {t("projects.form.fields.priority")}
          </label>
          <Select id="project-priority" {...register("priority")}>
            <option value="">{t("projects.form.placeholders.none")}</option>
            {PROJECT_PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {t(`projects.priority.${p}`)}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="project-start-date" className="text-sm font-medium text-foreground">
              {t("projects.form.fields.startDate")}
            </label>
            <Input id="project-start-date" type="date" {...register("startDate")} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="project-end-date" className="text-sm font-medium text-foreground">
              {t("projects.form.fields.endDate")}
            </label>
            <Input id="project-end-date" type="date" {...register("endDate")} />
            {errors.endDate && (
              <p role="alert" className="text-sm text-destructive">
                {errFor(errors.endDate)}
              </p>
            )}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
