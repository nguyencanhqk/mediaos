import { describe, expect, it } from "vitest";
import type { LeavePolicyView } from "@mediaos/contracts";
import {
  EMPTY_LEAVE_POLICY_FORM,
  leavePolicyFormSchema,
  leavePolicyToForm,
  leavePolicyToUpdate,
} from "./leave-policy-form";

/**
 * S6-LEAVE-CARRYOVER-1 — vòng ĐI-VỀ của cấu hình chuyển tiếp trên màn Chính sách.
 *
 * Vì sao đáng một file test riêng: form này gửi PATCH ĐẦY ĐỦ (`leavePolicyToUpdate` liệt kê mọi field).
 * Nếu view của server không trả 4 field carry-over, hoặc `leavePolicyToForm` pre-fill mặc định thay vì
 * đọc từ view, thì HR sửa MỘT field bất kỳ (đổi tên chính sách) cũng gửi kèm `allowCarryForward=false`
 * ⇒ engine tắt trong im lặng, không lỗi, không ai biết. Đó đúng là lớp lỗi cả họ Work Order này đi vá,
 * nên nó phải có test neo chứ không phải chỉ có comment.
 */

const POLICY_WITH_CARRYOVER: LeavePolicyView = {
  id: "pol-1",
  leaveTypeId: "11111111-1111-4111-8111-111111111111",
  leaveTypeCode: "ANNUAL",
  leaveTypeName: "Nghỉ phép năm",
  policyCode: "DEFAULT_ANNUAL",
  name: "Chính sách chuẩn",
  description: null,
  policyScope: "Company",
  departmentId: null,
  employeeId: null,
  jobLevelId: null,
  contractTypeId: null,
  yearlyQuotaDays: 12,
  yearlyQuotaHours: null,
  accrualMethod: "Monthly",
  reserveBalanceOnPending: true,
  allowNegativeBalance: false,
  maxNegativeDays: null,
  allowCarryForward: true,
  maxCarryForwardDays: 5,
  carryForwardExpiryMonth: 6,
  carryForwardExpiryDay: 30,
  requiresManagerApproval: true,
  requiresHrApproval: false,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  priority: 0,
  status: "Active",
};

describe("leave-policy-form — cấu hình chuyển tiếp (S6-LEAVE-CARRYOVER-1)", () => {
  it("pre-fill ĐỌC TỪ VIEW, không dùng mặc định", () => {
    const form = leavePolicyToForm(POLICY_WITH_CARRYOVER);
    expect(form.allowCarryForward).toBe(true);
    expect(form.maxCarryForwardDays).toBe("5");
    expect(form.carryForwardExpiryMonth).toBe("6");
    expect(form.carryForwardExpiryDay).toBe("30");
  });

  it("ĐI-VỀ không đổi giá trị: sửa TÊN chính sách KHÔNG được tắt chuyển tiếp", () => {
    const form = leavePolicyToForm(POLICY_WITH_CARRYOVER);
    const patch = leavePolicyToUpdate({ ...form, name: "Tên mới" });
    expect(patch.name).toBe("Tên mới");
    expect(patch.allowCarryForward).toBe(true);
    expect(patch.maxCarryForwardDays).toBe(5);
    expect(patch.carryForwardExpiryMonth).toBe(6);
    expect(patch.carryForwardExpiryDay).toBe(30);
  });

  it("trần bỏ trống ⇒ gửi null = KHÔNG trần (owner D-A3), không phải 0", () => {
    const form = leavePolicyToForm({ ...POLICY_WITH_CARRYOVER, maxCarryForwardDays: null });
    expect(form.maxCarryForwardDays).toBe("");
    expect(leavePolicyToUpdate(form).maxCarryForwardDays).toBeNull();
  });

  it("form mặc định (tạo mới): tắt chuyển tiếp, mốc 31/03", () => {
    expect(EMPTY_LEAVE_POLICY_FORM.allowCarryForward).toBe(false);
    expect(EMPTY_LEAVE_POLICY_FORM.carryForwardExpiryMonth).toBe("3");
    expect(EMPTY_LEAVE_POLICY_FORM.carryForwardExpiryDay).toBe("31");
  });

  it("CHẶN mốc không có thật trên lịch, báo đúng vào ô ngày (gương của DTO server)", () => {
    const r = leavePolicyFormSchema.safeParse({
      ...EMPTY_LEAVE_POLICY_FORM,
      leaveTypeId: POLICY_WITH_CARRYOVER.leaveTypeId,
      policyCode: "STD",
      name: "X",
      effectiveFrom: "2026-01-01",
      allowCarryForward: true,
      carryForwardExpiryMonth: "2",
      carryForwardExpiryDay: "31",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join(".") === "carryForwardExpiryDay")).toBe(true);
    }
  });

  it("công tắc TẮT ⇒ mốc không bị soi (HR vẫn lưu được chính sách)", () => {
    const r = leavePolicyFormSchema.safeParse({
      ...EMPTY_LEAVE_POLICY_FORM,
      leaveTypeId: POLICY_WITH_CARRYOVER.leaveTypeId,
      policyCode: "STD",
      name: "X",
      effectiveFrom: "2026-01-01",
      allowCarryForward: false,
      carryForwardExpiryMonth: "2",
      carryForwardExpiryDay: "31",
    });
    expect(r.success).toBe(true);
  });
});
