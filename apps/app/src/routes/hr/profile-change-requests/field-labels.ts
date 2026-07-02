/**
 * S2-FE-HR-4 — Nhãn + kiểu input cho các field được phép đề xuất sửa qua profile-change-request
 * (SPEC-03 §13.4/§14.18, nguồn field = PROFILE_CHANGE_ALLOWED_FIELDS trong @mediaos/contracts —
 * KHÔNG tự liệt kê field mới ở FE; server validate lại (HR-ERR-040) nếu FE lệch).
 */
import { PROFILE_CHANGE_ALLOWED_FIELDS, type ProfileChangeAllowedField } from "@mediaos/contracts";

export type ProfileChangeFieldInputType = "text" | "date" | "select";

export interface ProfileChangeFieldMeta {
  field: ProfileChangeAllowedField;
  labelKey: string;
  inputType: ProfileChangeFieldInputType;
  /** Chỉ dùng khi inputType === "select". */
  options?: readonly { value: string; labelKey: string }[];
  /** Nhóm "Giấy tờ" (SPEC-03 §14.18) — duyệt nghiêm ngặt, cần HR.EMPLOYEE.VIEW_SENSITIVE. */
  sensitive: boolean;
}

const GENDER_OPTIONS = [
  { value: "Male", labelKey: "changeRequest.fieldOptions.gender.male" },
  { value: "Female", labelKey: "changeRequest.fieldOptions.gender.female" },
  { value: "Other", labelKey: "changeRequest.fieldOptions.gender.other" },
] as const;

const MARITAL_STATUS_OPTIONS = [
  { value: "Single", labelKey: "changeRequest.fieldOptions.maritalStatus.single" },
  { value: "Married", labelKey: "changeRequest.fieldOptions.maritalStatus.married" },
  { value: "Other", labelKey: "changeRequest.fieldOptions.maritalStatus.other" },
] as const;

/** Metadata theo ĐÚNG thứ tự PROFILE_CHANGE_ALLOWED_FIELDS (nguồn contracts). */
export const PROFILE_CHANGE_FIELD_META: Readonly<
  Record<ProfileChangeAllowedField, ProfileChangeFieldMeta>
> = {
  avatar_file_id: {
    field: "avatar_file_id",
    labelKey: "changeRequest.fields.avatar_file_id",
    inputType: "text",
    sensitive: false,
  },
  date_of_birth: {
    field: "date_of_birth",
    labelKey: "changeRequest.fields.date_of_birth",
    inputType: "date",
    sensitive: false,
  },
  gender: {
    field: "gender",
    labelKey: "changeRequest.fields.gender",
    inputType: "select",
    options: GENDER_OPTIONS,
    sensitive: false,
  },
  marital_status: {
    field: "marital_status",
    labelKey: "changeRequest.fields.marital_status",
    inputType: "select",
    options: MARITAL_STATUS_OPTIONS,
    sensitive: false,
  },
  personal_email: {
    field: "personal_email",
    labelKey: "changeRequest.fields.personal_email",
    inputType: "text",
    sensitive: false,
  },
  phone: {
    field: "phone",
    labelKey: "changeRequest.fields.phone",
    inputType: "text",
    sensitive: false,
  },
  current_address: {
    field: "current_address",
    labelKey: "changeRequest.fields.current_address",
    inputType: "text",
    sensitive: false,
  },
  permanent_address: {
    field: "permanent_address",
    labelKey: "changeRequest.fields.permanent_address",
    inputType: "text",
    sensitive: false,
  },
  emergency_contact_name: {
    field: "emergency_contact_name",
    labelKey: "changeRequest.fields.emergency_contact_name",
    inputType: "text",
    sensitive: false,
  },
  emergency_contact_phone: {
    field: "emergency_contact_phone",
    labelKey: "changeRequest.fields.emergency_contact_phone",
    inputType: "text",
    sensitive: false,
  },
  identity_number: {
    field: "identity_number",
    labelKey: "changeRequest.fields.identity_number",
    inputType: "text",
    sensitive: true,
  },
  identity_issue_date: {
    field: "identity_issue_date",
    labelKey: "changeRequest.fields.identity_issue_date",
    inputType: "date",
    sensitive: true,
  },
  identity_issue_place: {
    field: "identity_issue_place",
    labelKey: "changeRequest.fields.identity_issue_place",
    inputType: "text",
    sensitive: true,
  },
};

/** Danh sách field theo thứ tự hiển thị — luôn đọc từ contracts (nguồn sự thật). */
export const PROFILE_CHANGE_FIELD_LIST: readonly ProfileChangeFieldMeta[] =
  PROFILE_CHANGE_ALLOWED_FIELDS.map((f) => PROFILE_CHANGE_FIELD_META[f]);
