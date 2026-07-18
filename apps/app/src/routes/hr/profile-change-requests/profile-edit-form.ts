/**
 * Bản đồ + hàm thuần cho màn "Đề nghị cập nhật hồ sơ" dạng SỬA TRỰC TIẾP (/me/profile/edit).
 *
 * Khác `change-request-form-schema.ts` (form tick-chọn-trường của HR-SCREEN-017): ở đây người dùng sửa
 * thẳng trên các ô như màn /hr/employees/:id/edit, còn `changedFields` được SUY RA từ chênh lệch giữa
 * giá trị ban đầu và giá trị hiện tại. DTO gửi lên server vẫn y hệt (`CreateProfileChangeRequest`) —
 * đây chỉ là lớp trình bày khác cho cùng một API.
 *
 * PHẠM VI FIELD: chỉ `PROFILE_CHANGE_ALLOWED_FIELDS` (contracts = nguồn sự thật, server chặn lại bằng
 * HR-ERR-040). KHÔNG được thêm ô cho field ngoài danh sách — user sửa xong sẽ bị nuốt âm thầm.
 */
import {
  PROFILE_CHANGE_SENSITIVE_FIELDS,
  type CreateProfileChangeRequest,
  type HrMeProfile,
  type ProfileChangeAllowedField,
} from "@mediaos/contracts";

/**
 * `avatar_file_id` CỐ Ý không có ô nhập: ảnh đại diện đã đổi được TRỰC TIẾP own-scope qua /me/avatar
 * (S5-ME-BE-4) nên không cần đi đường phê duyệt, và ô nhập "file id" thủ công là vô nghĩa với người dùng.
 */
export type ProfileEditField = Exclude<ProfileChangeAllowedField, "avatar_file_id">;

/** Ô nhập → khoá tương ứng trong HrMeProfile (snake_case DTO ↔ camelCase read model). */
const FIELD_TO_PROFILE_KEY: Readonly<Record<ProfileEditField, keyof HrMeProfile>> = {
  date_of_birth: "dateOfBirth",
  gender: "gender",
  marital_status: "maritalStatus",
  personal_email: "personalEmail",
  phone: "phone",
  current_address: "currentAddress",
  permanent_address: "permanentAddress",
  emergency_contact_name: "emergencyContactName",
  emergency_contact_phone: "emergencyContactPhone",
  identity_number: "identityNumber",
  identity_issue_date: "identityIssueDate",
  identity_issue_place: "identityIssuePlace",
};

/** Nhóm hiển thị — mirror bố cục section của màn sửa nhân viên (Cá nhân · Liên hệ · Giấy tờ). */
export const PROFILE_EDIT_GROUPS: readonly {
  id: string;
  labelKey: string;
  fields: readonly ProfileEditField[];
  /** Nhóm giấy tờ: duyệt nghiêm ngặt (PROFILE_CHANGE_SENSITIVE_FIELDS, SPEC-03 §14.18). */
  sensitive: boolean;
}[] = [
  {
    id: "section-personal",
    labelKey: "form.sections.personal",
    fields: ["gender", "date_of_birth", "marital_status"],
    sensitive: false,
  },
  {
    id: "section-contact",
    labelKey: "form.sections.contact",
    fields: [
      "personal_email",
      "phone",
      "current_address",
      "permanent_address",
      "emergency_contact_name",
      "emergency_contact_phone",
    ],
    sensitive: false,
  },
  {
    id: "section-identity",
    labelKey: "detail.groups.identity",
    fields: ["identity_number", "identity_issue_date", "identity_issue_place"],
    sensitive: true,
  },
];

export type ProfileEditValues = Record<ProfileEditField, string>;

export const PROFILE_EDIT_FIELDS: readonly ProfileEditField[] = PROFILE_EDIT_GROUPS.flatMap(
  (g) => g.fields,
);

const SENSITIVE_SET: ReadonlySet<string> = new Set(PROFILE_CHANGE_SENSITIVE_FIELDS);

export function isSensitiveField(field: ProfileEditField): boolean {
  return SENSITIVE_SET.has(field);
}

/**
 * Đổ giá trị hiện tại vào form. Field server MASK (thiếu quyền) trả null → ô rỗng: người dùng vẫn gõ
 * được giá trị mới để đề nghị, nhưng UI PHẢI nói rõ "giá trị hiện tại đang bị ẩn" — nếu không họ sẽ
 * tưởng hồ sơ đang trống (xem hint ở MyProfileEditPage).
 */
export function profileToEditValues(profile: HrMeProfile): ProfileEditValues {
  const values = {} as ProfileEditValues;
  for (const field of PROFILE_EDIT_FIELDS) {
    const raw = profile[FIELD_TO_PROFILE_KEY[field]];
    values[field] = typeof raw === "string" ? raw : "";
  }
  return values;
}

/** Ô đã đổi so với giá trị ban đầu (so sánh sau trim — gõ thừa khoảng trắng KHÔNG tính là thay đổi). */
export function changedFieldsOf(
  initial: ProfileEditValues,
  current: ProfileEditValues,
): ProfileEditField[] {
  return PROFILE_EDIT_FIELDS.filter((f) => (current[f] ?? "").trim() !== (initial[f] ?? "").trim());
}

/**
 * Form → DTO. Trả null khi KHÔNG có ô nào đổi (người gọi hiện thông báo thay vì gửi request rỗng —
 * server sẽ trả 400 khó hiểu).
 *
 * Ô bị XOÁ TRẮNG (có giá trị → rỗng) KHÔNG được gửi: schema server đòi giá trị mới không rỗng, và
 * "xoá field" không nằm trong luồng đề nghị sửa. Người gọi cảnh báo riêng (xem clearedFieldsOf).
 */
export function buildChangeRequestDto(
  initial: ProfileEditValues,
  current: ProfileEditValues,
  reason: string,
): CreateProfileChangeRequest | null {
  const changed = changedFieldsOf(initial, current).filter(
    (f) => (current[f] ?? "").trim().length > 0,
  );
  if (changed.length === 0) return null;

  const newValues: Record<string, unknown> = {};
  for (const field of changed) newValues[field] = current[field]!.trim();

  const trimmedReason = reason.trim();
  return {
    changedFields: changed,
    newValues,
    reason: trimmedReason.length > 0 ? trimmedReason : undefined,
  };
}

/** Ô bị xoá trắng — không gửi được, cần báo người dùng thay vì im lặng bỏ qua. */
export function clearedFieldsOf(
  initial: ProfileEditValues,
  current: ProfileEditValues,
): ProfileEditField[] {
  return changedFieldsOf(initial, current).filter(
    (f) => (current[f] ?? "").trim().length === 0 && (initial[f] ?? "").trim().length > 0,
  );
}
