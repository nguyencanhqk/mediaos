import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock, Save } from "lucide-react";
import {
  ApiError,
  goalApi,
  goalInvalidation,
  goalKeys,
  hrApi,
  hrKeys,
  taskProjectApi,
  taskKeys,
  useCan,
} from "@mediaos/web-core";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
import { Button, Card, CardContent, Input, Select } from "@mediaos/ui";
import { EmployeePicker } from "@/routes/tasks/EmployeePicker";
import {
  GOAL_LEVEL_OPTIONS,
  GOAL_MEASURE_TYPE_OPTIONS,
  GOAL_PERIOD_TYPE_OPTIONS,
  GOAL_PROGRESS_MODE_OPTIONS,
  GOAL_STATUS_OPTIONS,
} from "./constants";
import {
  EMPTY_GOAL_FORM,
  detailToFormValues,
  goalFormSchema,
  toCreateDto,
  toUpdateDto,
  type GoalFormValues,
} from "./goal-form-schema";

interface GoalFormPageProps {
  /** Có → SỬA; không → TẠO. */
  goalId?: string;
  onSuccess: (goalId: string) => void;
  onCancel: () => void;
}

/**
 * GOAL-SCREEN-003 (S5-GOAL-FE-1) — form tạo/sửa mục tiêu. Một component cho CẢ create + edit
 * (mẫu EmployeeFormPage). Chọn `level` → hiện đúng field neo (phòng/dự án/nhân viên — EmployeePicker
 * dùng chung #251). Chọn `progressMode` → mô tả từng mode. RHF + Zod validate GOAL-ERR-001/003/011/015
 * ở client; server re-validate §12 là cổng cuối (422 + mã lỗi → thông điệp người-đọc).
 *
 * Goal đã chốt kỳ (GOAL-ERR-005): khóa form + disable submit (defense-in-depth — nút Sửa ở detail cũng
 * đã ẩn khi finalized). Mutation invalidate list + tree + detail qua goalInvalidation.
 */
export function GoalFormPage({ goalId, onSuccess, onCancel }: GoalFormPageProps) {
  const { t } = useTranslation("goals");
  const queryClient = useQueryClient();
  const isEdit = Boolean(goalId);

  const detailQuery = useQuery({
    queryKey: goalKeys.detail(goalId ?? ""),
    queryFn: () => goalApi.getGoal(goalId as string),
    enabled: isEdit,
    staleTime: 10_000,
  });
  const finalizedLocked = Boolean(detailQuery.data?.finalizedAt);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<GoalFormValues>({
    resolver: zodResolver(goalFormSchema),
    mode: "onSubmit",
    defaultValues: EMPTY_GOAL_FORM,
  });

  // Điền sẵn khi sửa — MỘT LẦN (ref chặn reset đè khi user đang gõ).
  const filledRef = useRef(false);
  useEffect(() => {
    if (isEdit && detailQuery.data && !filledRef.current) {
      reset(detailToFormValues(detailQuery.data));
      filledRef.current = true;
    }
  }, [isEdit, detailQuery.data, reset]);

  const level = watch("level");
  const measureType = watch("measureType");
  const progressMode = watch("progressMode");
  const employeeId = watch("employeeId");

  // Danh mục neo — tải theo cấp đang chọn (fail-soft nếu thiếu quyền → option rỗng).
  const { data: departments } = useQuery({
    queryKey: hrKeys.departments.list(),
    queryFn: () => hrApi.listDepartments(),
    enabled: level === "department",
    staleTime: 300_000,
  });
  const { data: projectsList } = useQuery({
    queryKey: taskKeys.projects.list({ scope: "goal-form" }),
    queryFn: () => taskProjectApi.listProjects({ limit: 100 }),
    enabled: level === "project",
    staleTime: 60_000,
  });
  // Nhân viên — nguồn CHUNG cho: option select "Người phụ trách" (luôn hiện) + giải tên hiển thị của
  // neo nhân viên đã chọn (EmployeePicker tự tải danh sách RIÊNG cho dropdown của nó, nhưng KHÔNG trả
  // tên về parent). Tải khi form còn ghi được — thiếu read:employee thì rỗng (fail-soft: owner do BE tự
  // gán; §11). KHÔNG gate theo `ownerEmployeeId !== ""` — sẽ không bao giờ có option để CHỌN owner lần đầu.
  const canReadEmployees = useCan("read", "employee");
  const { data: employeesPage } = useQuery({
    queryKey: hrKeys.employees.list({ pageSize: 100, status: "active" }),
    queryFn: () => hrApi.listEmployees({ pageSize: 100, status: "active" }),
    enabled: !finalizedLocked && canReadEmployees,
    staleTime: 60_000,
  });
  const employeeById = useMemo(() => {
    const map = new Map<
      string,
      { fullName: string | null; avatarUrl: string | null | undefined }
    >();
    for (const e of employeesPage?.items ?? []) {
      map.set(e.id, { fullName: e.fullName, avatarUrl: e.avatarUrl });
    }
    return map;
  }, [employeesPage]);

  // Mục tiêu cha (tùy chọn) — mọi goal trừ chính nó.
  const { data: parentCandidates } = useQuery({
    queryKey: goalKeys.list({ scope: "parent-picker" }),
    queryFn: () => goalApi.listGoals({ limit: 200 }),
    enabled: level !== "",
    staleTime: 30_000,
  });

  const [serverError, setServerError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: (values: GoalFormValues): Promise<GoalCoreResponseDto> =>
      isEdit
        ? goalApi.updateGoal(goalId as string, toUpdateDto(values))
        : goalApi.createGoal(toCreateDto(values)),
    onSuccess: (saved) => {
      const keys = isEdit ? goalInvalidation.update(saved.id) : goalInvalidation.create();
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
      onSuccess(saved.id);
    },
    onError: (err: unknown) => {
      setServerError(mapSaveError(err, t));
    },
  });

  const onSubmit = (values: GoalFormValues) => {
    setServerError(null);
    saveMutation.mutate(values);
  };

  if (isEdit && detailQuery.isLoading) {
    return <div className="m-4 h-64 animate-pulse rounded-xl bg-muted" />;
  }
  if (isEdit && detailQuery.isError) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive" role="alert">
          {t("form.loadError")}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onCancel}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("actions.back", { ns: "common" })}
        </Button>
      </div>
    );
  }

  const disabled = finalizedLocked || saveMutation.isPending;

  return (
    <form
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">
          {isEdit ? t("form.editTitle") : t("form.createTitle")}
        </h1>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("actions.cancel", { ns: "common" })}
        </Button>
      </div>

      {finalizedLocked && (
        <div
          className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning"
          role="alert"
        >
          <Lock className="h-4 w-4" />
          {t("form.finalizedLocked")}
        </div>
      )}

      {/* Cơ bản */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm font-semibold text-foreground">{t("form.sections.basic")}</p>
          <Field label={t("form.fields.name")} error={errFor(errors.name?.message, t)} required>
            <Input
              {...register("name")}
              placeholder={t("form.placeholders.name")}
              disabled={disabled}
            />
          </Field>
          <Field label={t("form.fields.description")}>
            <textarea
              {...register("description")}
              placeholder={t("form.placeholders.description")}
              disabled={disabled}
              rows={3}
              className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </Field>
        </CardContent>
      </Card>

      {/* Neo mục tiêu */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm font-semibold text-foreground">{t("form.sections.anchor")}</p>
          <Field label={t("form.fields.level")} error={errFor(errors.level?.message, t)} required>
            <Select {...register("level")} disabled={disabled || isEdit}>
              <option value="">{t("form.fields.level")}…</option>
              {GOAL_LEVEL_OPTIONS.map((lv) => (
                <option key={lv} value={lv}>
                  {t(`level.${lv}`)}
                </option>
              ))}
            </Select>
          </Field>

          {level === "department" && (
            <Field
              label={t("form.fields.department")}
              error={errFor(errors.departmentId?.message, t)}
              required
            >
              <Select {...register("departmentId")} disabled={disabled}>
                <option value="">{t("form.placeholders.selectDepartment")}</option>
                {(departments ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {level === "project" && (
            <Field
              label={t("form.fields.project")}
              error={errFor(errors.projectId?.message, t)}
              required
            >
              <Select {...register("projectId")} disabled={disabled}>
                <option value="">{t("form.placeholders.selectProject")}</option>
                {(projectsList ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {level === "employee" && (
            <Field
              label={t("form.fields.employee")}
              error={errFor(errors.employeeId?.message, t)}
              required
            >
              <EmployeePicker
                employeeId={employeeId || null}
                name={employeeById.get(employeeId)?.fullName ?? null}
                avatarUrl={employeeById.get(employeeId)?.avatarUrl}
                onSelect={(id) => setValue("employeeId", id ?? "", { shouldValidate: true })}
                canEdit={!disabled}
                allowClear
                showName
                testId="goal-employee-anchor"
                emptyLabel={t("form.fields.employee")}
              />
            </Field>
          )}

          {/* Người phụ trách (tùy chọn) */}
          <Field label={t("form.fields.owner")} hint={t("form.hints.ownerAuto")}>
            <Select {...register("ownerEmployeeId")} disabled={disabled}>
              <option value="">—</option>
              {(employeesPage?.items ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName}
                </option>
              ))}
            </Select>
          </Field>

          {/* Mục tiêu cha (tùy chọn) */}
          <Field label={t("form.fields.parentGoal")} hint={t("form.hints.parentOptional")}>
            <Select {...register("parentGoalId")} disabled={disabled}>
              <option value="">{t("form.placeholders.selectParent")}</option>
              {(parentCandidates ?? [])
                .filter((g) => g.id !== goalId)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.goalCode} — {g.name}
                  </option>
                ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      {/* Kỳ */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm font-semibold text-foreground">{t("form.sections.period")}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("form.fields.periodType")}>
              <Select {...register("periodType")} disabled={disabled}>
                {GOAL_PERIOD_TYPE_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {t(`periodType.${p}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t("form.fields.periodStart")}
              error={errFor(errors.periodStart?.message, t)}
              required
            >
              <Input type="date" {...register("periodStart")} disabled={disabled} />
            </Field>
            <Field
              label={t("form.fields.periodEnd")}
              error={errFor(errors.periodEnd?.message, t)}
              required
            >
              <Input type="date" {...register("periodEnd")} disabled={disabled} />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Đo tiến độ */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm font-semibold text-foreground">{t("form.sections.measure")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("form.fields.progressMode")} hint={t(`mode.${progressMode}.desc`)}>
              <Select {...register("progressMode")} disabled={disabled}>
                {GOAL_PROGRESS_MODE_OPTIONS.map((m) => (
                  <option key={m} value={m} disabled={m === "project" && level !== "project"}>
                    {t(`mode.${m}.label`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("form.fields.measureType")}>
              <Select {...register("measureType")} disabled={disabled}>
                {GOAL_MEASURE_TYPE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {t(`measureType.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t("form.fields.targetValue")}
              error={errFor(errors.targetValue?.message, t)}
            >
              <Input
                type="number"
                step="any"
                {...register("targetValue")}
                disabled={disabled || measureType === "boolean"}
              />
            </Field>
            <Field label={t("form.fields.unit")}>
              <Input
                {...register("unit")}
                placeholder={t("form.placeholders.unit")}
                disabled={disabled}
              />
            </Field>
            <Field
              label={t("form.fields.weight")}
              error={errFor(errors.weight?.message, t)}
              required
            >
              <Input type="number" step="any" {...register("weight")} disabled={disabled} />
            </Field>
            <Field label={t("form.fields.status")}>
              <Select {...register("status")} disabled={disabled}>
                {GOAL_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      {serverError && (
        <p className="text-sm text-destructive" role="alert">
          {serverError}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={saveMutation.isPending}
        >
          {t("actions.cancel", { ns: "common" })}
        </Button>
        <Button type="submit" disabled={disabled}>
          <Save className="mr-2 h-4 w-4" />
          {isEdit ? t("form.submitSave") : t("form.submitCreate")}
        </Button>
      </div>
    </form>
  );
}

/** Nhãn + control + lỗi (mẫu Field của EmployeeFormPage). */
function Field({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
      {hint && !error && <span className="text-xs text-muted-foreground">{hint}</span>}
      {error && (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

/** Zod message (khóa i18n ns goals) → text; undefined nếu không có lỗi. */
function errFor(
  message: string | undefined,
  t: ReturnType<typeof useTranslation<"goals">>["t"],
): string | undefined {
  return message ? t(message) : undefined;
}

/** ApiError 422 (GOAL-ERR-XXX) → thông điệp người-đọc từ server (BE trả message vi); fallback generic. */
function mapSaveError(err: unknown, t: ReturnType<typeof useTranslation<"goals">>["t"]): string {
  if (err instanceof ApiError && err.message && err.status !== 500) {
    return err.message;
  }
  return t("form.errors.generic");
}
