import { describe, expect, it } from "vitest";

import {
  PROFILE_CHANGE_ALLOWED_FIELDS,
  PROFILE_CHANGE_SENSITIVE_FIELDS,
  createProfileChangeRequestSchema,
} from "./profile-change-request";

/**
 * S19-HR-AVATARWRITE-1 (D-2a) — ảnh đại diện KHÔNG đổi qua đề nghị sửa hồ sơ: nhân viên đổi trực tiếp qua
 * `/me/avatar`, HR qua endpoint ảnh của HR (cả hai đã kiểm tệp). Danh sách cho phép là nguồn sự thật DUY
 * NHẤT mà service dùng để kiểm `changedFields` ∪ khoá `newValues` ⇒ ghim ở đây.
 */
describe("PROFILE_CHANGE_ALLOWED_FIELDS", () => {
  it("R10: không chứa trường ảnh đại diện", () => {
    expect(PROFILE_CHANGE_ALLOWED_FIELDS as readonly string[]).not.toContain("avatar_file_id");
  });

  it("nhóm Giấy tờ là tập con của danh sách cho phép", () => {
    for (const f of PROFILE_CHANGE_SENSITIVE_FIELDS) {
      expect(PROFILE_CHANGE_ALLOWED_FIELDS as readonly string[]).toContain(f);
    }
  });
});

describe("createProfileChangeRequestSchema", () => {
  it("R10: changedFields có avatar_file_id ⇒ không hợp lệ", () => {
    const res = createProfileChangeRequestSchema.safeParse({
      changedFields: ["avatar_file_id"],
      newValues: { avatar_file_id: "00000000-0000-4000-8000-000000000000" },
    });
    expect(res.success).toBe(false);
  });

  it("neo dương: changedFields chỉ phone ⇒ hợp lệ", () => {
    const res = createProfileChangeRequestSchema.safeParse({
      changedFields: ["phone"],
      newValues: { phone: "0900000000" },
    });
    expect(res.success).toBe(true);
  });
});
