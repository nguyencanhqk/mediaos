import { useEffect, useRef } from "react";
import { useForm, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, UserCog, ArrowLeft, RefreshCw } from "lucide-react";
import { hrApi, hrKeys, useCan, ApiError } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Input, Select, Card, CardContent } from "@mediaos/ui";
import { useDirtyFormGuard } from "@/hooks/use-dirty-form-guard";
import { HR_ENGINE_PAIRS } from "../constants";
import { useEmployeeLookups } from "./use-employee-lookups";
import {
  EMPTY_EMPLOYEE_FORM,
  WORK_TYPE_VALUES,
  EMPLOYMENT_TYPE_VALUES,
  SALARY_TYPE_VALUES,
  detailToFormValues,
  employeeFormSchema,
  toCreateDto,
  toUpdateDto,
  type EmployeeFormMode,
  type EmployeeFormValues,
} from "./employee-form-schema";

type TF = ReturnType<typeof useTranslation<"hr">>["t"];
type DirtyMap = Partial<Record<keyof EmployeeFormValues, boolean | undefined>>;

// ---------------------------------------------------------------------------
// Friendly submit error → i18n key (no internal detail leaked)
// ---------------------------------------------------------------------------
function submitErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError) {
    if (err.code === NO_CHANGES_CODE) return t("form.errors.noChanges");
    if (err.status === 409) return t("form.errors.conflict");
    if (err.status === 403) return t("form.errors.forbidden");
    if (err.status === 422 || err.status === 400) return t("form.errors.validation");
    if (err.status >= 500) return t("form.errors.server");
  }
  return t("form.errors.generic");
}

/** Sentinel for an edit submit that produced no persistable change (e.g. only-field cleared). */
const NO_CHANGES_CODE = "HR-ERR-NO-CHANGES";

/** Resolve a React Hook Form field error (whose message is an i18n key) to display text. */
function fieldError(err: { message?: string } | undefined, t: TF): string | undefined {
  return err ? t(err.message ?? "") : undefined;
}

// ---------------------------------------------------------------------------
// Labelled field wrapper (label + control + inline error)
// ---------------------------------------------------------------------------
function Field({
  id,
  label,
  required,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account section (create only)
// ---------------------------------------------------------------------------
function AccountSection({
  register,
  errors,
  t,
}: {
  register: UseFormRegister<EmployeeFormValues>;
  errors: FieldErrors<EmployeeFormValues>;
  t: TF;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <h3 className="text-sm font-semibold text-foreground">{t("form.sections.account")}</h3>
        <Field
          id="email"
          label={t("form.fields.email")}
          required
          error={fieldError(errors.email, t)}
        >
          <Input id="email" type="email" autoComplete="off" {...register("email")} />
        </Field>
        <Field
          id="fullName"
          label={t("form.fields.fullName")}
          required
          error={fieldError(errors.fullName, t)}
        >
          <Input id="fullName" autoComplete="off" {...register("fullName")} />
        </Field>
        <Field
          id="password"
          label={t("form.fields.initialPassword")}
          hint={t("form.hints.initialPassword")}
          error={fieldError(errors.password, t)}
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            {...register("password")}
          />
        </Field>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Work section (create + edit)
// ---------------------------------------------------------------------------
function WorkSection({
  register,
  errors,
  t,
  lookups,
}: {
  register: UseFormRegister<EmployeeFormValues>;
  errors: FieldErrors<EmployeeFormValues>;
  t: TF;
  lookups: ReturnType<typeof useEmployeeLookups>;
}) {
  const masterDataDisabled = !lookups.canManageMasterData;
  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <h3 className="text-sm font-semibold text-foreground">{t("form.sections.work")}</h3>

        <Field
          id="employeeCode"
          label={t("form.fields.employeeCode")}
          hint={t("form.hints.employeeCode")}
          error={fieldError(errors.employeeCode, t)}
        >
          <Input id="employeeCode" {...register("employeeCode")} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="orgUnitId" label={t("form.fields.department")}>
            <Select id="orgUnitId" {...register("orgUnitId")}>
              <option value="">{t("form.placeholders.select")}</option>
              {lookups.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field id="positionId" label={t("form.fields.position")}>
            <Select id="positionId" {...register("positionId")}>
              <option value="">{t("form.placeholders.select")}</option>
              {lookups.positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            id="jobLevelId"
            label={t("form.fields.jobLevel")}
            hint={masterDataDisabled ? t("form.hints.masterDataLocked") : undefined}
          >
            <Select id="jobLevelId" disabled={masterDataDisabled} {...register("jobLevelId")}>
              <option value="">{t("form.placeholders.select")}</option>
              {lookups.jobLevels.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            id="contractTypeId"
            label={t("form.fields.contractType")}
            hint={masterDataDisabled ? t("form.hints.masterDataLocked") : undefined}
          >
            <Select
              id="contractTypeId"
              disabled={masterDataDisabled}
              {...register("contractTypeId")}
            >
              <option value="">{t("form.placeholders.select")}</option>
              {lookups.contractTypes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field id="workType" label={t("form.fields.workType")}>
            <Select id="workType" {...register("workType")}>
              {WORK_TYPE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {t(`form.workType.${v}`)}
                </option>
              ))}
            </Select>
          </Field>

          <Field id="employmentType" label={t("form.fields.employmentType")}>
            <Select id="employmentType" {...register("employmentType")}>
              {EMPLOYMENT_TYPE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {t(`form.employmentType.${v}`)}
                </option>
              ))}
            </Select>
          </Field>

          <Field id="salaryType" label={t("form.fields.salaryType")}>
            <Select id="salaryType" {...register("salaryType")}>
              {SALARY_TYPE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {t(`form.salaryType.${v}`)}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            id="startDate"
            label={t("form.fields.startDate")}
            error={fieldError(errors.startDate, t)}
          >
            <Input id="startDate" type="date" {...register("startDate")} />
          </Field>

          <Field
            id="endDate"
            label={t("form.fields.endDate")}
            error={fieldError(errors.endDate, t)}
          >
            <Input id="endDate" type="date" {...register("endDate")} />
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
interface EmployeeFormPageProps {
  /** Present → edit mode; absent → create mode. */
  employeeId?: string;
  /** Navigate after a successful save (route layer wires this to the detail/list). */
  onSuccess?: (employeeId: string) => void;
  /** Navigate when the user cancels. */
  onCancel?: () => void;
}

export function EmployeeFormPage({ employeeId, onSuccess, onCancel }: EmployeeFormPageProps) {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");
  const queryClient = useQueryClient();
  const mode: EmployeeFormMode = employeeId ? "edit" : "create";

  const pair =
    mode === "create" ? HR_ENGINE_PAIRS.CREATE_EMPLOYEE : HR_ENGINE_PAIRS.UPDATE_EMPLOYEE;
  const canSubmit = useCan(pair.action, pair.resourceType);

  const lookups = useEmployeeLookups();

  // Edit mode: load the current detail to pre-fill the form.
  const detailQuery = useQuery({
    queryKey: hrKeys.employees.detail(employeeId ?? ""),
    queryFn: () => hrApi.getEmployee(employeeId as string),
    enabled: mode === "edit" && canSubmit && !!employeeId,
    staleTime: 30_000,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting, dirtyFields },
  } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema(mode)),
    mode: "onSubmit",
    defaultValues: EMPTY_EMPLOYEE_FORM,
  });

  // Pre-fill ONCE per employee when the edit detail first arrives. Guarding on a ref (not just
  // detailQuery.data) prevents a background refetch/invalidation from re-running reset() and silently
  // discarding the user's in-progress edits (reset would also clear isDirty + disable the guard).
  const prefilledRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode === "edit" && detailQuery.data && prefilledRef.current !== employeeId) {
      prefilledRef.current = employeeId ?? null;
      reset(detailToFormValues(detailQuery.data));
    }
  }, [mode, detailQuery.data, employeeId, reset]);

  useDirtyFormGuard({ isDirty });

  const mutation = useMutation({
    mutationFn: async (input: { values: EmployeeFormValues; dirty: DirtyMap }): Promise<string> => {
      if (mode === "create") {
        const res = await hrApi.createEmployee(toCreateDto(input.values));
        return res.id;
      }
      const patch = toUpdateDto(input.values, input.dirty);
      // Guard the only-dirty-field-cleared case (e.g. employeeCode emptied): the PATCH body would be
      // {} and the BE rejects it with an opaque "No fields to update" — surface a clear message instead.
      if (Object.keys(patch).length === 0) {
        throw new ApiError(400, NO_CHANGES_CODE, "no persistable changes");
      }
      const res = await hrApi.updateEmployee(employeeId as string, patch);
      return res.id;
    },
    onSuccess: async (savedId) => {
      await queryClient.invalidateQueries({ queryKey: hrKeys.employees.all });
      if (mode === "edit" && employeeId) {
        await queryClient.invalidateQueries({ queryKey: hrKeys.employees.detail(employeeId) });
      }
      // Reset clears the dirty flag so the guard does not block the post-save navigation.
      reset(EMPTY_EMPLOYEE_FORM);
      onSuccess?.(savedId);
    },
  });

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canSubmit) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("employees.forbidden.title")}
          description={t("form.forbidden.description")}
        />
      </div>
    );
  }

  // ── Edit: loading / error of the detail to pre-fill ──────────────────────────
  if (mode === "edit" && detailQuery.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={tc("loading")} icon={UserCog} />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }
  if (mode === "edit" && (detailQuery.isError || !detailQuery.data)) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("detail.error.title")}
          description={t("detail.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void detailQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const busy = isSubmitting || mutation.isPending;
  const submitDisabled = busy || (mode === "edit" && !isDirty);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={mode === "create" ? t("form.createTitle") : t("form.editTitle")}
        description={mode === "create" ? t("form.createDescription") : t("form.editDescription")}
        icon={mode === "create" ? UserPlus : UserCog}
        actions={
          onCancel && (
            <Button variant="outline" size="sm" onClick={onCancel}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("form.cancel")}
            </Button>
          )
        }
      />

      {mutation.isError && (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {submitErrorMessage(mutation.error, t)}
        </p>
      )}

      <form
        onSubmit={handleSubmit((values) => mutation.mutate({ values, dirty: { ...dirtyFields } }))}
        noValidate
        className="space-y-6"
      >
        {mode === "create" && <AccountSection register={register} errors={errors} t={t} />}
        <WorkSection register={register} errors={errors} t={t} lookups={lookups} />

        <div className="flex items-center justify-end gap-3">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              {t("form.cancel")}
            </Button>
          )}
          <Button type="submit" disabled={submitDisabled}>
            {busy
              ? t("form.submitting")
              : mode === "create"
                ? t("form.submitCreate")
                : t("form.submitSave")}
          </Button>
        </div>
      </form>
    </div>
  );
}
