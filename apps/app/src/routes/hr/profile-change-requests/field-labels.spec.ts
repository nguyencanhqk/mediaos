import { describe, expect, it } from "vitest";
import { PROFILE_CHANGE_FIELD_LIST, PROFILE_CHANGE_FIELD_META } from "./field-labels";

/**
 * S19-HR-AVATARWRITE-1 — form «Gửi yêu cầu sửa hồ sơ» thôi mời đổi ảnh đại diện: ảnh đổi trực tiếp qua
 * `/me/avatar`, không qua đề nghị duyệt. Danh sách ô tick lặp `PROFILE_CHANGE_FIELD_LIST` (nguồn contracts).
 */
describe("PROFILE_CHANGE_FIELD_LIST", () => {
  it("R12: không có trường ảnh đại diện", () => {
    expect(PROFILE_CHANGE_FIELD_LIST.map((m) => m.field as string)).not.toContain("avatar_file_id");
    expect(Object.keys(PROFILE_CHANGE_FIELD_META)).not.toContain("avatar_file_id");
  });

  it("neo dương: vẫn có số điện thoại", () => {
    expect(PROFILE_CHANGE_FIELD_LIST.map((m) => m.field as string)).toContain("phone");
  });
});
