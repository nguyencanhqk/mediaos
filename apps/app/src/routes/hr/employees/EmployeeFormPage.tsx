import { useEffect, useRef, useState } from "react";
import { useForm, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, UserCog, ArrowLeft, RefreshCw } from "lucide-react";
import { hrApi, hrKeys, useCan, ApiError } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Input, Select, Card, CardContent, cn } from "@mediaos/ui";
import { useDirtyFormGuard } from "@/hooks/use-dirty-form-guard";
import { HR_ENGINE_PAIRS } from "../constants";
import { useEmployeeLookups } from "./use-employee-lookups";
import {
  EMPTY_EMPLOYEE_FORM,
  WORK_TYPE_VALUES,
  EMPLOYMENT_TYPE_VALUES,
  SALARY_TYPE_VALUES,
  GENDER_VALUES,
  MARITAL_STATUS_VALUES,
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
// Section nav (HR-PROFILE-UI-1) — anchor trái + scrollspy IntersectionObserver
// ---------------------------------------------------------------------------
interface FormSection {
  id: string;
  label: string;
}

function SectionNav({ sections, title }: { sections: FormSection[]; title: string }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    // jsdom/browser cũ không có IntersectionObserver → bỏ scrollspy, nav vẫn click-scroll được.
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) setActive(visible[0]!.target.id);
      },
      // Vùng "đang đọc" = dải 20–30% từ mép trên viewport.
      { rootMargin: "-20% 0px -70% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  // top-6: cuộn giờ nằm TRONG <main> của workspace (topbar ngoài khung cuộn) —
  // offset chỉ cần khớp padding trang, không cộng chiều cao topbar nữa
  return (
    <nav className="sticky top-24 hidden self-start lg:block">
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      <ul className="space-y-0.5 border-l border-border">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById(s.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className={cn(
                "-ml-px block w-full border-l-2 px-3 py-1.5 text-left text-sm transition-colors",
                active === s.id
                  ? "border-brand font-medium text-brand"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
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

          <Field id="workLocation" label={t("form.fields.workLocation")}>
            <Input id="workLocation" {...register("workLocation")} />
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Personal + contact sections (HR-PROFILE-UI-1b) — CHỈ edit-mode + caller có view-sensitive.
// Server vẫn là cổng cuối (PATCH chạm PII đòi view-sensitive per-row, fail-closed).
// ---------------------------------------------------------------------------
function PersonalSection({
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
        <h3 className="text-sm font-semibold text-foreground">{t("form.sections.personal")}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="gender" label={t("form.fields.gender")}>
            <Select id="gender" {...register("gender")}>
              {GENDER_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v === "" ? t("form.placeholders.select") : t(`employees.gender.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="dateOfBirth"
            label={t("form.fields.dateOfBirth")}
            error={fieldError(errors.dateOfBirth, t)}
          >
            <Input id="dateOfBirth" type="date" {...register("dateOfBirth")} />
          </Field>
          <Field id="maritalStatus" label={t("form.fields.maritalStatus")}>
            <Select id="maritalStatus" {...register("maritalStatus")}>
              {MARITAL_STATUS_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v === "" ? t("form.placeholders.select") : t(`detail.maritalStatus.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="placeOfBirth" label={t("form.fields.placeOfBirth")}>
            <Input id="placeOfBirth" {...register("placeOfBirth")} />
          </Field>
          <Field id="nativePlace" label={t("form.fields.nativePlace")}>
            <Input id="nativePlace" {...register("nativePlace")} />
          </Field>
          <Field id="ethnicity" label={t("form.fields.ethnicity")}>
            <Input id="ethnicity" {...register("ethnicity")} />
          </Field>
          <Field id="religion" label={t("form.fields.religion")}>
            <Input id="religion" {...register("religion")} />
          </Field>
          <Field id="nationality" label={t("form.fields.nationality")}>
            <Input id="nationality" {...register("nationality")} />
          </Field>
          <Field id="taxCode" label={t("form.fields.taxCode")}>
            <Input id="taxCode" {...register("taxCode")} />
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}

function ContactInfoSection({
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
        <h3 className="text-sm font-semibold text-foreground">{t("form.sections.contact")}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="personalEmail"
            label={t("form.fields.personalEmail")}
            error={fieldError(errors.personalEmail, t)}
          >
            <Input
              id="personalEmail"
              type="email"
              autoComplete="off"
              {...register("personalEmail")}
            />
          </Field>
          <Field id="phone" label={t("form.fields.phone")}>
            <Input id="phone" {...register("phone")} />
          </Field>
          <Field id="currentAddress" label={t("form.fields.currentAddress")}>
            <Input id="currentAddress" {...register("currentAddress")} />
          </Field>
          <Field id="permanentAddress" label={t("form.fields.permanentAddress")}>
            <Input id="permanentAddress" {...register("permanentAddress")} />
          </Field>
          <Field id="emergencyContactName" label={t("form.fields.emergencyContactName")}>
            <Input id="emergencyContactName" {...register("emergencyContactName")} />
          </Field>
          <Field id="emergencyContactPhone" label={t("form.fields.emergencyContactPhone")}>
            <Input id="emergencyContactPhone" {...register("emergencyContactPhone")} />
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Schedule section (HR-PROFILE-UI-1) — hình thức làm việc & thời gian
// ---------------------------------------------------------------------------
function ScheduleSection({
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
        <h3 className="text-sm font-semibold text-foreground">{t("form.sections.schedule")}</h3>

        <div className="grid gap-4 sm:grid-cols-2">
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

          <Field
            id="probationEndDate"
            label={t("form.fields.probationEndDate")}
            error={fieldError(errors.probationEndDate, t)}
          >
            <Input id="probationEndDate" type="date" {...register("probationEndDate")} />
          </Field>

          <Field
            id="officialDate"
            label={t("form.fields.officialDate")}
            error={fieldError(errors.officialDate, t)}
          >
            <Input id="officialDate" type="date" {...register("officialDate")} />
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
  // HR-PROFILE-UI-1b — section Cá nhân/Liên hệ chỉ render khi caller có view-sensitive (edit mode).
  // Server vẫn gate PATCH PII per-row; đây là UI-hint tránh render form field toàn giá trị bị mask.
  const canEditPersonal =
    useCan(HR_ENGINE_PAIRS.VIEW_SENSITIVE.action, HR_ENGINE_PAIRS.VIEW_SENSITIVE.resourceType) &&
    mode === "edit";

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
    // <form> BỌC CẢ TRANG (kể cả thanh hành động dính đầu) — nhờ vậy nút Lưu vẫn là type="submit"
    // NẰM TRONG form, không phải dùng thuộc tính form="id" để nối từ ngoài vào.
    <form
      onSubmit={handleSubmit((values) => mutation.mutate({ values, dirty: { ...dirtyFields } }))}
      noValidate
      className="space-y-6 p-6"
    >
      {/* Thanh hành động DÍNH ĐẦU TRANG: form này dài (5 section), trước đây nút Lưu/Hủy nằm tận cuối
          nên phải cuộn hết trang mới thao tác được. Khung cuộn là <main> của ModuleWorkspaceLayout
          (KHÔNG phải document) ⇒ sticky top-0 dính vào mép trên vùng nội dung. -mx-6/-mt-6 để nền
          thanh tràn hết chiều ngang, che nội dung cuộn phía dưới (nền đục, không trong suốt). */}
      <div className="sticky top-0 z-20 -mx-6 -mt-6 space-y-3 border-b border-border bg-background px-6 py-4">
        <PageHeader
          title={mode === "create" ? t("form.createTitle") : t("form.editTitle")}
          description={mode === "create" ? t("form.createDescription") : t("form.editDescription")}
          icon={mode === "create" ? UserPlus : UserCog}
          actions={
            <>
              {onCancel && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onCancel}
                  disabled={busy}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t("form.cancel")}
                </Button>
              )}
              <Button type="submit" size="sm" disabled={submitDisabled}>
                {busy
                  ? t("form.submitting")
                  : mode === "create"
                    ? t("form.submitCreate")
                    : t("form.submitSave")}
              </Button>
            </>
          }
        />

        {/* Lỗi submit nằm TRONG thanh dính: nút Lưu giờ ở đầu trang nên người dùng có thể bấm khi đang
            cuộn ở cuối — nếu để lỗi ở luồng thường (đầu trang) thì submit hỏng sẽ KHÔNG ai thấy. */}
        {mutation.isError && (
          <p
            role="alert"
            aria-live="assertive"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {submitErrorMessage(mutation.error, t)}
          </p>
        )}
      </div>

      {/* HR-PROFILE-UI-1 — layout 2 cột: anchor nav trái (scrollspy) + form section phải */}
      <div className="lg:grid lg:grid-cols-[200px_1fr] lg:items-start lg:gap-6">
        {/* top-24 (không phải top-6 như trước): chừa chỗ cho thanh hành động dính ở trên, nếu không
            các mục nav sẽ chui xuống dưới thanh đó. scroll-mt của từng section cũng tăng tương ứng. */}
        <SectionNav
          title={t("form.nav.title")}
          sections={[
            ...(mode === "create"
              ? [{ id: "section-account", label: t("form.sections.account") }]
              : []),
            ...(canEditPersonal
              ? [
                  { id: "section-personal", label: t("form.sections.personal") },
                  { id: "section-contact", label: t("form.sections.contact") },
                ]
              : []),
            { id: "section-work", label: t("form.sections.work") },
            { id: "section-schedule", label: t("form.sections.schedule") },
          ]}
        />

        <div className="space-y-6">
          {mode === "create" && (
            <div id="section-account" className="scroll-mt-28">
              <AccountSection register={register} errors={errors} t={t} />
            </div>
          )}
          {canEditPersonal && (
            <>
              <div id="section-personal" className="scroll-mt-28">
                <PersonalSection register={register} errors={errors} t={t} />
              </div>
              <div id="section-contact" className="scroll-mt-28">
                <ContactInfoSection register={register} errors={errors} t={t} />
              </div>
            </>
          )}
          <div id="section-work" className="scroll-mt-28">
            <WorkSection register={register} errors={errors} t={t} lookups={lookups} />
          </div>
          <div id="section-schedule" className="scroll-mt-28">
            <ScheduleSection register={register} errors={errors} t={t} />
          </div>
        </div>
      </div>
    </form>
  );
}
