/**
 * role-form-schema — S7-SEC-ROLE2FA-UI-1.
 *
 * Ô "Bắt buộc 2FA" (roles.requires_two_factor) là cờ AN NINH: prefill sai không chỉ hiển thị sai, nó
 * khoá luôn chiều TẮT — react-hook-form chỉ đưa field DIRTY vào PATCH, mà "bỏ tick" từ mặc-định-false
 * lại trả giá trị VỀ đúng mặc định ⇒ hết dirty ⇒ field rơi khỏi payload ⇒ DB giữ nguyên true.
 * Vì vậy hai chiều bật/tắt được khoá ở ĐÂY (map thuần) và ở RoleFormPage.spec.tsx (qua RHF thật).
 */
import { describe, it, expect } from "vitest";
import { roleToFormValues, toCreateRoleDto, toUpdateRoleDto } from "./role-form-schema";

describe("roleToFormValues — prefill phản chiếu trạng thái THẬT của role", () => {
  it("role đang ép 2FA → form khởi tạo requiresTwoFactor=true (KHÔNG hard-code false)", () => {
    const values = roleToFormValues({
      name: "Quản lý cấp cao",
      description: "Ban điều hành",
      requiresTwoFactor: true,
    });

    expect(values).toEqual({
      name: "Quản lý cấp cao",
      description: "Ban điều hành",
      requiresTwoFactor: true,
    });
  });

  it("role KHÔNG ép 2FA → false; description null → chuỗi rỗng", () => {
    const values = roleToFormValues({
      name: "Kế toán",
      description: null,
      requiresTwoFactor: false,
    });

    expect(values).toEqual({ name: "Kế toán", description: "", requiresTwoFactor: false });
  });
});

describe("toCreateRoleDto / toUpdateRoleDto — cờ 2FA đi CẢ HAI chiều", () => {
  it("create: cờ luôn gửi tường minh (server mặc định false, nhưng UI nói rõ ý định)", () => {
    expect(
      toCreateRoleDto({ name: "Bảo mật", description: "  ", requiresTwoFactor: true }),
    ).toEqual({ name: "Bảo mật", description: null, requiresTwoFactor: true });
  });

  it("patch: dirty + false → payload CHỨA requiresTwoFactor:false (chiều TẮT)", () => {
    expect(
      toUpdateRoleDto(
        { name: "Kế toán", description: "x", requiresTwoFactor: false },
        {
          requiresTwoFactor: true,
        },
      ),
    ).toEqual({ requiresTwoFactor: false });
  });

  it("patch: KHÔNG dirty → cờ vắng mặt (không ghi đè giá trị người khác vừa đổi)", () => {
    expect(
      toUpdateRoleDto(
        { name: "Kế toán mới", description: "x", requiresTwoFactor: true },
        {
          name: true,
        },
      ),
    ).toEqual({ name: "Kế toán mới" });
  });
});
