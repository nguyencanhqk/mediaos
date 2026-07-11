import { z } from "zod";
import type {
  CreateHrEmployeeRequest,
  HrEmployeeDetail,
  UpdateHrEmployeeRequest,
} from "@mediaos/contracts";

/**
 * S2-FE-HR-2 — EmployeeForm schema + DTO mappers.
 *
 * ONE form-values type (`EmployeeFormValues`) drives both create & edit. Validation differs by mode:
 * create validates the account section (email/fullName/password) + structural fields; edit validates
 * structural fields only (account is NOT editable here — that path is link/unlink, out of scope).
 *
 * SELECT/empty fields are kept as "" (not undefined) so React Hook Form controls them; the mappers
 * translate "" → undefined (create: omit) or "" → null (edit: clear) at the API boundary. baseSalary
 * + PII are DELIBERATELY ABSENT (BẤT BIẾN #3 — write-core DTOs exclude them).
 *
 * Error messages are i18n KEYS (namespace "hr", prefix "form.validation.") — resolved via t(message).
 */

export const WORK_TYPE_VALUES = ["offline", "remote", "hybrid"] as const;
export const EMPLOYMENT_TYPE_VALUES = [
  "full_time",
  "part_time",
  "freelancer",
  "intern",
  "probation",
] as const;
export const SALARY_TYPE_VALUES = ["monthly", "hourly", "project"] as const;

const isoDateOrEmpty = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, { message: "form.validation.dateInvalid" });

export const GENDER_VALUES = ["", "Male", "Female", "Other"] as const;
export const MARITAL_STATUS_VALUES = ["", "single", "married", "other"] as const;

/** Structural fields shared by create & edit. All optional ("" = unset). */
const structuralShape = {
  employeeCode: z.string().max(50, { message: "form.validation.codeTooLong" }),
  orgUnitId: z.string(),
  positionId: z.string(),
  jobLevelId: z.string(),
  contractTypeId: z.string(),
  workType: z.enum(WORK_TYPE_VALUES),
  employmentType: z.enum(EMPLOYMENT_TYPE_VALUES),
  salaryType: z.enum(SALARY_TYPE_VALUES),
  startDate: isoDateOrEmpty,
  endDate: isoDateOrEmpty,
  // HR-PROFILE-UI-1b — directory (edit-only trên UI nhưng shape dùng chung, "" = unset).
  officialDate: isoDateOrEmpty,
  probationEndDate: isoDateOrEmpty,
  workLocation: z.string().max(255),
};

/**
 * HR-PROFILE-UI-1b — personal/PII fields (EDIT only; section chỉ render khi caller có
 * view-sensitive:employee — server gate lần cuối, FE không tự nới).
 */
const personalShape = {
  gender: z.enum(GENDER_VALUES),
  dateOfBirth: isoDateOrEmpty,
  maritalStatus: z.enum(MARITAL_STATUS_VALUES),
  personalEmail: z
    .string()
    .max(255)
    .refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "form.validation.emailInvalid",
    }),
  phone: z.string().max(50),
  currentAddress: z.string().max(1000),
  permanentAddress: z.string().max(1000),
  emergencyContactName: z.string().max(255),
  emergencyContactPhone: z.string().max(50),
  taxCode: z.string().max(100),
  placeOfBirth: z.string().max(255),
  nativePlace: z.string().max(255),
  ethnicity: z.string().max(100),
  religion: z.string().max(100),
  nationality: z.string().max(100),
};

/** Key personalExtra (blob JSONB) trong form values. */
export const PERSONAL_EXTRA_FORM_KEYS = [
  "placeOfBirth",
  "nativePlace",
  "ethnicity",
  "religion",
  "nationality",
] as const;

/** Account fields — only meaningful in create mode (never edited via this form). */
const accountShape = {
  email: z.string(),
  fullName: z.string(),
  password: z.string(),
};

/** Reject end-before-start when both dates are present. */
function endNotBeforeStart(v: { startDate: string; endDate: string }): boolean {
  if (!v.startDate || !v.endDate) return true;
  return v.endDate >= v.startDate;
}

const createSchema = z
  .object({
    ...accountShape,
    ...structuralShape,
    ...personalShape,
    email: z
      .string()
      .min(1, { message: "form.validation.emailRequired" })
      .email({ message: "form.validation.emailInvalid" })
      .max(255, { message: "form.validation.emailInvalid" }),
    fullName: z
      .string()
      .min(1, { message: "form.validation.fullNameRequired" })
      .max(200, { message: "form.validation.fullNameTooLong" }),
    password: z
      .string()
      .max(200)
      .refine((p) => p === "" || p.length >= 8, { message: "form.validation.passwordTooShort" }),
  })
  .refine(endNotBeforeStart, { message: "form.validation.endBeforeStart", path: ["endDate"] });

const editSchema = z
  .object({ ...accountShape, ...structuralShape, ...personalShape })
  .refine(endNotBeforeStart, { message: "form.validation.endBeforeStart", path: ["endDate"] });

export type EmployeeFormMode = "create" | "edit";

/**
 * Form-values type = Zod source of truth (CLAUDE.md §4). create & edit schemas share the exact same
 * keys (edit only relaxes the account-field validation), so both infer to this single shape — no
 * hand-maintained interface to drift out of sync.
 */
export type EmployeeFormValues = z.infer<typeof createSchema>;

export function employeeFormSchema(mode: EmployeeFormMode) {
  return mode === "create" ? createSchema : editSchema;
}

/** Blank create-mode defaults (sensible enum defaults mirror the BE schema defaults). */
export const EMPTY_EMPLOYEE_FORM: EmployeeFormValues = {
  email: "",
  fullName: "",
  password: "",
  employeeCode: "",
  orgUnitId: "",
  positionId: "",
  jobLevelId: "",
  contractTypeId: "",
  workType: "offline",
  employmentType: "full_time",
  salaryType: "monthly",
  startDate: "",
  endDate: "",
  officialDate: "",
  probationEndDate: "",
  workLocation: "",
  gender: "",
  dateOfBirth: "",
  maritalStatus: "",
  personalEmail: "",
  phone: "",
  currentAddress: "",
  permanentAddress: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  taxCode: "",
  placeOfBirth: "",
  nativePlace: "",
  ethnicity: "",
  religion: "",
  nationality: "",
};

const WORK_TYPE_SET = new Set<string>(WORK_TYPE_VALUES);
const EMPLOYMENT_TYPE_SET = new Set<string>(EMPLOYMENT_TYPE_VALUES);
const SALARY_TYPE_SET = new Set<string>(SALARY_TYPE_VALUES);

/** Pre-fill edit form from a loaded detail. Unknown/legacy enum strings fall back to the default. */
export function detailToFormValues(d: HrEmployeeDetail): EmployeeFormValues {
  return {
    ...EMPTY_EMPLOYEE_FORM,
    employeeCode: d.employeeCode ?? "",
    orgUnitId: d.orgUnitId ?? "",
    positionId: d.positionId ?? "",
    // job-level / contract-type are not part of the read detail → left blank (set on demand).
    jobLevelId: "",
    contractTypeId: "",
    workType:
      d.workType && WORK_TYPE_SET.has(d.workType)
        ? (d.workType as EmployeeFormValues["workType"])
        : "offline",
    employmentType:
      d.employmentType && EMPLOYMENT_TYPE_SET.has(d.employmentType)
        ? (d.employmentType as EmployeeFormValues["employmentType"])
        : "full_time",
    salaryType:
      d.salaryType && SALARY_TYPE_SET.has(d.salaryType)
        ? (d.salaryType as EmployeeFormValues["salaryType"])
        : "monthly",
    startDate: d.startDate ?? "",
    endDate: d.endDate ?? "",
    // HR-PROFILE-UI-1b — directory + personal (server đã mask: thiếu quyền → null → "" trong form,
    // nhưng section PII chỉ render khi có quyền nên không bao giờ ghi đè mù).
    officialDate: d.officialDate ?? "",
    probationEndDate: d.probationEndDate ?? "",
    workLocation: d.workLocation ?? "",
    gender:
      d.gender && (GENDER_VALUES as readonly string[]).includes(d.gender)
        ? (d.gender as EmployeeFormValues["gender"])
        : "",
    dateOfBirth: d.dateOfBirth ?? "",
    maritalStatus:
      d.maritalStatus && (MARITAL_STATUS_VALUES as readonly string[]).includes(d.maritalStatus)
        ? (d.maritalStatus as EmployeeFormValues["maritalStatus"])
        : "",
    personalEmail: d.personalEmail ?? "",
    phone: d.phone ?? "",
    currentAddress: d.currentAddress ?? "",
    permanentAddress: d.permanentAddress ?? "",
    emergencyContactName: d.emergencyContactName ?? "",
    emergencyContactPhone: d.emergencyContactPhone ?? "",
    taxCode: d.taxCode ?? "",
    placeOfBirth: d.personalExtra?.placeOfBirth ?? "",
    nativePlace: d.personalExtra?.nativePlace ?? "",
    ethnicity: d.personalExtra?.ethnicity ?? "",
    religion: d.personalExtra?.religion ?? "",
    nationality: d.personalExtra?.nationality ?? "",
  };
}

const trimOrUndefined = (v: string): string | undefined => {
  const t = v.trim();
  return t === "" ? undefined : t;
};

/** Map validated create values → POST /hr/employees DTO ("" → omit). */
export function toCreateDto(v: EmployeeFormValues): CreateHrEmployeeRequest {
  return {
    email: v.email.trim(),
    fullName: trimOrUndefined(v.fullName),
    password: v.password === "" ? undefined : v.password,
    employeeCode: trimOrUndefined(v.employeeCode),
    orgUnitId: trimOrUndefined(v.orgUnitId),
    positionId: trimOrUndefined(v.positionId),
    jobLevelId: trimOrUndefined(v.jobLevelId),
    contractTypeId: trimOrUndefined(v.contractTypeId),
    workType: v.workType,
    employmentType: v.employmentType,
    salaryType: v.salaryType,
    startDate: trimOrUndefined(v.startDate),
    endDate: trimOrUndefined(v.endDate),
  };
}

/** Which form keys map to nullable columns (PATCH "" → null clears them). */
type NullableKey =
  | "orgUnitId"
  | "positionId"
  | "jobLevelId"
  | "contractTypeId"
  | "startDate"
  | "endDate"
  // HR-PROFILE-UI-1b — directory + personal nullable columns.
  | "officialDate"
  | "probationEndDate"
  | "workLocation"
  | "gender"
  | "dateOfBirth"
  | "maritalStatus"
  | "personalEmail"
  | "phone"
  | "currentAddress"
  | "permanentAddress"
  | "emergencyContactName"
  | "emergencyContactPhone"
  | "taxCode";
type DirtyMap = Partial<Record<keyof EmployeeFormValues, boolean | undefined>>;

/**
 * Map ONLY dirty values → PATCH /hr/employees/:id DTO. Sending only changed keys matches the BE
 * contract ("every present key is an intentional change") and keeps no-op writes off the audit trail.
 * personalExtra là FULL-REPLACE: BẤT KỲ key nhân khẩu nào dirty ⇒ gửi nguyên blob dựng từ form
 * (key rỗng bị loại; blob trống ⇒ null xóa blob).
 */
export function toUpdateDto(v: EmployeeFormValues, dirty: DirtyMap): UpdateHrEmployeeRequest {
  const dto: Record<string, unknown> = {};
  const nullableKeys: NullableKey[] = [
    "orgUnitId",
    "positionId",
    "jobLevelId",
    "contractTypeId",
    "startDate",
    "endDate",
    "officialDate",
    "probationEndDate",
    "workLocation",
    "gender",
    "dateOfBirth",
    "maritalStatus",
    "personalEmail",
    "phone",
    "currentAddress",
    "permanentAddress",
    "emergencyContactName",
    "emergencyContactPhone",
    "taxCode",
  ];
  for (const key of nullableKeys) {
    if (dirty[key]) {
      const raw = v[key];
      const trimmed = typeof raw === "string" ? raw.trim() : raw;
      dto[key] = trimmed === "" ? null : trimmed;
    }
  }
  // employeeCode is NON-nullable on the BE (min length 1) — only send a non-empty value.
  if (dirty.employeeCode) {
    const code = v.employeeCode.trim();
    if (code !== "") dto.employeeCode = code;
  }
  if (dirty.workType) dto.workType = v.workType;
  if (dirty.employmentType) dto.employmentType = v.employmentType;
  if (dirty.salaryType) dto.salaryType = v.salaryType;

  // personalExtra (blob JSONB) — full-replace khi có key nhân khẩu dirty.
  if (PERSONAL_EXTRA_FORM_KEYS.some((k) => dirty[k])) {
    const extra: Record<string, string> = {};
    for (const key of PERSONAL_EXTRA_FORM_KEYS) {
      const value = v[key].trim();
      if (value !== "") extra[key] = value;
    }
    dto.personalExtra = Object.keys(extra).length > 0 ? extra : null;
  }
  return dto as UpdateHrEmployeeRequest;
}
