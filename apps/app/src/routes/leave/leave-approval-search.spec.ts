import { describe, it, expect } from "vitest";
import { validateLeaveApprovalSearch } from "./leave-approval-search";

describe("validateLeaveApprovalSearch", () => {
  it.each([123, true, { a: 1 }, ["x"], null, undefined, ""])(
    "giá trị không phải chuỗi (%j) ⇒ bỏ khỏi search, không viết lại URL",
    (raw) => {
      expect(validateLeaveApprovalSearch({ request: raw })).toEqual({});
    },
  );
  it("chuỗi giữ nguyên (kể cả không phải UUID — trang tự báo không tìm thấy)", () => {
    expect(validateLeaveApprovalSearch({ request: "abc" })).toEqual({ request: "abc" });
  });
});
