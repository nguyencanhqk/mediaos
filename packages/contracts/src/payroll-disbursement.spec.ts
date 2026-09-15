import { describe, expect, it } from "vitest";

import {
  approvePayrollAdvanceSchema,
  completePaymentBatchSchema,
  payrollAdvanceListQuerySchema,
  rejectPayrollAdvanceSchema,
} from "./payroll-disbursement";

/**
 * S15-PAYROLL-BE-4B (plan BE-4 §11b, security L7) — bốn schema còn lại của track C nhận `.strict()`:
 *  · 063 approve · 064 reject · 072 complete: body chở quyết định trên tiền — khoá lạ (`amount`, `userId`, `status`…) bị
 *    Zod cũ lặng lẽ bỏ ⇒ client tưởng đã «duyệt kèm sửa» mà server chỉ duyệt; giờ ⇒ 400.
 *  · 059 list (bộ lọc `userId`): khoá gõ sai (`user_id`, `userid`) bị bỏ ⇒ trả DANH SÁCH TOÀN CÔNG TY (có `amount`) trong khi
 *    người gọi tưởng đã lọc theo một người ⇒ 400 thay vì mở rộng tập kết quả im lặng.
 * Route Own 065 KHÔNG nhận `userId` từ query (chủ thể = JWT) và các schema tạo/sửa đã strict từ BE-4.
 */
describe("S15-PAYROLL-BE-4B · .strict() — khoá lạ ⇒ từ chối, không âm thầm bỏ", () => {
  it.each([
    ["approvePayrollAdvanceSchema (063)", approvePayrollAdvanceSchema, { note: "ok" }],
    ["rejectPayrollAdvanceSchema (064)", rejectPayrollAdvanceSchema, { note: "không đủ công" }],
    ["completePaymentBatchSchema (072)", completePaymentBatchSchema, { confirmAllPaid: true }],
    ["payrollAdvanceListQuerySchema (059)", payrollAdvanceListQuerySchema, { page: "1" }],
  ] as const)("%s: hợp lệ qua; thêm khoá lạ ⇒ unrecognized_keys", (_name, schema, valid) => {
    expect(schema.safeParse(valid).success).toBe(true);
    const r = schema.safeParse({ ...valid, amount: 1 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.code)).toContain("unrecognized_keys");
    }
  });

  it("059: `user_id` (snake_case gõ nhầm) ⇒ 400 thay vì lặng lẽ liệt kê toàn công ty", () => {
    const r = payrollAdvanceListQuerySchema.safeParse({
      user_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(r.success).toBe(false);
  });
});
