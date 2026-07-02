import { z } from "zod";
import type { AuthUserDto, CreateAuthUserRequest, UpdateAuthUserRequest } from "@mediaos/contracts";

/**
 * S2-FE-AUTH-3 — UserForm schema + DTO mappers cho /system/users/new + /system/users/:id/edit.
 *
 * ONE form-values type (`UserFormValues`) cho cả create & edit. create validate email+password+fullName
 * (BE createAuthUserRequestSchema); edit CHỈ validate fullName (BE updateAuthUserRequestSchema — email
 * immutable, password KHÔNG đổi qua đây). Error message là i18n KEY (namespace "system",
 * prefix "users.form.validation.") — resolved via t(message).
 */

const PASSWORD_MIN = 10;

const createSchema = z.object({
  email: z
    .string()
    .min(1, { message: "users.form.validation.emailRequired" })
    .email({ message: "users.form.validation.emailInvalid" })
    .max(255, { message: "users.form.validation.emailInvalid" }),
  fullName: z
    .string()
    .min(1, { message: "users.form.validation.fullNameRequired" })
    .max(200, { message: "users.form.validation.fullNameTooLong" }),
  password: z
    .string()
    .min(PASSWORD_MIN, { message: "users.form.validation.passwordTooShort" })
    .max(128, { message: "users.form.validation.passwordTooLong" })
    .regex(/[a-z]/, { message: "users.form.validation.passwordNeedsLower" })
    .regex(/[A-Z]/, { message: "users.form.validation.passwordNeedsUpper" })
    .regex(/[0-9]/, { message: "users.form.validation.passwordNeedsDigit" }),
});

const editSchema = z.object({
  email: z.string(),
  fullName: z
    .string()
    .min(1, { message: "users.form.validation.fullNameRequired" })
    .max(200, { message: "users.form.validation.fullNameTooLong" }),
  password: z.string(),
});

export type UserFormMode = "create" | "edit";

/** Form-values type = Zod source of truth. create & edit share the same keys (edit relaxes email/password). */
export type UserFormValues = z.infer<typeof createSchema>;

export function userFormSchema(mode: UserFormMode) {
  return mode === "create" ? createSchema : editSchema;
}

export const EMPTY_USER_FORM: UserFormValues = {
  email: "",
  fullName: "",
  password: "",
};

/** Pre-fill edit form from a loaded detail. Password left blank (never re-populated — write-only). */
export function detailToFormValues(d: AuthUserDto): UserFormValues {
  return {
    email: d.email,
    fullName: d.fullName ?? "",
    password: "",
  };
}

/** Map validated create values → POST /auth/users DTO. */
export function toCreateDto(v: UserFormValues): CreateAuthUserRequest {
  return {
    email: v.email.trim(),
    fullName: v.fullName.trim(),
    password: v.password,
  };
}

/** Map validated edit values → PATCH /auth/users/:id DTO (fullName only — the sole editable field). */
export function toUpdateDto(v: UserFormValues): UpdateAuthUserRequest {
  return {
    fullName: v.fullName.trim(),
  };
}
