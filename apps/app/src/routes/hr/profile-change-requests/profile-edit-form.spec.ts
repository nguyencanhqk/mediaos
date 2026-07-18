/**
 * Hàm thuần suy ra `changedFields` cho màn sửa-rồi-gửi-duyệt (/me/profile/edit).
 *
 * Đây là chỗ dễ sai nhất của luồng: người dùng KHÔNG tick chọn trường nữa, nên nếu diff sai thì hoặc
 * gửi thừa field (HR duyệt nhầm thứ user không định đổi) hoặc nuốt field user vừa sửa.
 */
import { describe, it, expect } from "vitest";
import type { HrMeProfile } from "@mediaos/contracts";
import {
  PROFILE_EDIT_FIELDS,
  buildChangeRequestDto,
  changedFieldsOf,
  clearedFieldsOf,
  profileToEditValues,
  type ProfileEditValues,
} from "./profile-edit-form";

function baseValues(overrides: Partial<ProfileEditValues> = {}): ProfileEditValues {
  const v = {} as ProfileEditValues;
  for (const f of PROFILE_EDIT_FIELDS) v[f] = "";
  return { ...v, ...overrides };
}

describe("profile-edit-form", () => {
  it("KHÔNG mở ô cho avatar_file_id (đổi ảnh đi đường own-scope /me/avatar, không qua duyệt)", () => {
    expect(PROFILE_EDIT_FIELDS).not.toContain("avatar_file_id");
  });

  it("profileToEditValues: null (server mask hoặc trống) → chuỗi rỗng, không phải 'null'", () => {
    const profile = {
      phone: null,
      identityNumber: null,
      personalEmail: "a@demo.local",
      dateOfBirth: "1990-05-01",
    } as unknown as HrMeProfile;

    const values = profileToEditValues(profile);
    expect(values.phone).toBe("");
    expect(values.identity_number).toBe("");
    expect(values.personal_email).toBe("a@demo.local");
    expect(values.date_of_birth).toBe("1990-05-01");
  });

  it("chỉ ô THỰC SỰ đổi mới vào changedFields", () => {
    const initial = baseValues({ phone: "0901", personal_email: "a@demo.local" });
    const current = baseValues({ phone: "0902", personal_email: "a@demo.local" });

    expect(changedFieldsOf(initial, current)).toEqual(["phone"]);
  });

  it("gõ thêm khoảng trắng KHÔNG tính là thay đổi (tránh gửi yêu cầu rác)", () => {
    const initial = baseValues({ phone: "0901" });
    const current = baseValues({ phone: "  0901  " });

    expect(changedFieldsOf(initial, current)).toEqual([]);
    expect(buildChangeRequestDto(initial, current, "")).toBeNull();
  });

  it("không đổi gì → DTO null (người gọi báo 'chưa thay đổi', KHÔNG gửi request rỗng)", () => {
    const values = baseValues({ phone: "0901" });
    expect(buildChangeRequestDto(values, values, "lý do")).toBeNull();
  });

  it("DTO chỉ chứa field đã đổi, giá trị đã trim, kèm reason", () => {
    const initial = baseValues({ phone: "0901", current_address: "Hà Nội" });
    const current = baseValues({ phone: "  0902  ", current_address: "Hà Nội" });

    const dto = buildChangeRequestDto(initial, current, "  chuyển số  ");
    expect(dto).toEqual({
      changedFields: ["phone"],
      newValues: { phone: "0902" },
      reason: "chuyển số",
    });
  });

  it("reason rỗng → bỏ hẳn khỏi DTO (undefined), không gửi chuỗi rỗng", () => {
    const initial = baseValues({ phone: "0901" });
    const current = baseValues({ phone: "0902" });

    expect(buildChangeRequestDto(initial, current, "   ")?.reason).toBeUndefined();
  });

  it("ô bị xoá trắng: KHÔNG lọt vào DTO và được nêu riêng để cảnh báo", () => {
    const initial = baseValues({ phone: "0901", identity_number: "079123" });
    const current = baseValues({ phone: "", identity_number: "079123" });

    expect(clearedFieldsOf(initial, current)).toEqual(["phone"]);
    // Chỉ xoá trắng ⇒ không còn thay đổi hợp lệ nào ⇒ null (page chặn trước bằng clearedFieldsOf).
    expect(buildChangeRequestDto(initial, current, "")).toBeNull();
  });

  it("điền vào ô đang rỗng (giá trị bị mask) VẪN tính là đề nghị thay đổi", () => {
    const initial = baseValues({ identity_number: "" });
    const current = baseValues({ identity_number: "079123456789" });

    expect(buildChangeRequestDto(initial, current, "")).toEqual({
      changedFields: ["identity_number"],
      newValues: { identity_number: "079123456789" },
      reason: undefined,
    });
  });
});
