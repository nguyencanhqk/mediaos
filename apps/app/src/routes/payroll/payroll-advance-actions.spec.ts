import { describe, it, expect } from "vitest";
import {
  canDecideAdvance,
  canEditAdvance,
  canCompletePaymentBatch,
  paymentBatchHasUnpaidLines,
  type PayrollAdvanceActionSubject,
  type PaymentBatchActionSubject,
} from "./payroll-actions";

/**
 * S15-PAYROLL-FE-3 — ma trận nút của track C (tạm ứng · đợt chi trả). Hàm THUẦN ⇒ neo được toàn bộ
 * ma trận mà không dựng DOM.
 *
 * ⚠️ Mỗi nhóm DENY luôn có ca ALLOW đặt cạnh. Bảng chỉ-DENY là bảng **xanh-RỖNG**: hàm trả `false`
 * vì một lý do khác hẳn (sai tên trường, chữ hoa/thường) vẫn cho mọi ca DENY qua
 * (`deny-cases-vacuous-without-allow-case`).
 */

const ME = "11111111-1111-1111-1111-111111111111";
const SOMEONE_ELSE = "22222222-2222-2222-2222-222222222222";
const BENEFICIARY = "33333333-3333-3333-3333-333333333333";

function advance(over: Partial<PayrollAdvanceActionSubject> = {}): PayrollAdvanceActionSubject {
  return {
    status: "Pending",
    payrollPeriodId: null,
    createdBy: SOMEONE_ELSE,
    userId: BENEFICIARY,
    ...over,
  };
}

function batch(over: Partial<PaymentBatchActionSubject> = {}): PaymentBatchActionSubject {
  return { status: "Ready", lineCount: 3, paidLineCount: 0, createdBy: SOMEONE_ELSE, ...over };
}

describe("canDecideAdvance — four-eyes tạm ứng chặn CẢ người tạo LẪN người thụ hưởng", () => {
  it("cho phép người thứ ba duyệt khoản đang Pending", () => {
    expect(canDecideAdvance(advance(), true, ME)).toBe(true);
  });

  it("chặn chính người TẠO khoản (mirror `before.createdBy === user.id` ở BE)", () => {
    expect(canDecideAdvance(advance({ createdBy: ME }), true, ME)).toBe(false);
  });

  /**
   * 🔴 Ca đắt nhất của WO. BE chặn vế này ở SERVICE (`before.userId === user.id` ⇒ 409
   * `self-approval`), còn CHECK `payroll_advances_four_eyes_check` ở DB **chỉ soi `created_by`** —
   * nên không suy luật từ CHECK. SPEC-11 §9.1 cũng chỉ viết «ẩn với chính người tạo», HẸP HƠN BE.
   * Thiếu ca này thì người được cấp tạm ứng vẫn thấy nút «Duyệt» trên khoản của mình rồi ăn 409.
   */
  it("chặn chính người THỤ HƯỞNG dù họ không phải người tạo", () => {
    expect(canDecideAdvance(advance({ userId: ME }), true, ME)).toBe(false);
  });

  it("chặn khi khoản không còn Pending (Approved / Rejected / Deducted là terminal)", () => {
    for (const status of ["Approved", "Rejected", "Deducted"] as const) {
      expect(canDecideAdvance(advance({ status }), true, ME), status).toBe(false);
    }
  });

  it("chặn khi thiếu cặp `approve:payroll-advance`", () => {
    expect(canDecideAdvance(advance(), false, ME)).toBe(false);
  });

  it("KHÔNG chặn khi chưa biết mình là ai (fail-open có chủ đích — BE vẫn chặn)", () => {
    // `/auth/me` chưa về ⇒ fail-closed sẽ giấu nút khỏi MỌI người trong khoảnh khắc đó.
    expect(canDecideAdvance(advance({ createdBy: ME, userId: ME }), true, null)).toBe(true);
  });
});

describe("canEditAdvance — chỉ Pending và chưa khấu trừ", () => {
  it("cho phép sửa khoản Pending chưa gắn kỳ", () => {
    expect(canEditAdvance(advance(), true)).toBe(true);
  });

  it("chặn khi đã gắn vào kỳ lương (đã khấu trừ ⇒ 409 advance-already-deducted)", () => {
    expect(canEditAdvance(advance({ payrollPeriodId: "kỳ-nào-đó" }), true)).toBe(false);
  });

  it("chặn khi đã rời Pending, kể cả khi chưa gắn kỳ", () => {
    expect(canEditAdvance(advance({ status: "Approved" }), true)).toBe(false);
  });

  it("chặn khi thiếu cặp `manage:payroll-advance`", () => {
    expect(canEditAdvance(advance(), false)).toBe(false);
  });
});

describe("canCompletePaymentBatch — ẩn nút thay vì hiện rồi 409", () => {
  it("cho phép hoàn tất đợt Ready có dòng, người hoàn tất khác người lập", () => {
    expect(canCompletePaymentBatch(batch(), true, ME)).toBe(true);
  });

  /**
   * Còn dòng chưa chi là ca **HỢP LỆ**, KHÔNG phải lý do ẩn nút: 072 nhận `confirmAllPaid: true` để
   * ghi `paid_at` cho mọi dòng trong cùng tx. Ẩn ở đây sẽ khoá chết một đợt hợp lệ.
   */
  it("VẪN cho phép khi còn dòng chưa đánh dấu đã chi", () => {
    expect(canCompletePaymentBatch(batch({ paidLineCount: 1, lineCount: 3 }), true, ME)).toBe(true);
  });

  it("chặn đợt đã hoàn tất (terminal — trigger DB đóng băng đợt)", () => {
    expect(canCompletePaymentBatch(batch({ status: "Completed" }), true, ME)).toBe(false);
  });

  it("chặn đợt RỖNG (0 dòng sống ⇒ 409 batch-empty)", () => {
    expect(canCompletePaymentBatch(batch({ lineCount: 0, paidLineCount: 0 }), true, ME)).toBe(
      false,
    );
  });

  it("chặn chính người LẬP đợt (four-eyes ⇒ 409 batch-four-eyes)", () => {
    expect(canCompletePaymentBatch(batch({ createdBy: ME }), true, ME)).toBe(false);
  });

  it("chặn khi thiếu cặp `manage:payment-batch`", () => {
    expect(canCompletePaymentBatch(batch(), false, ME)).toBe(false);
  });

  it("KHÔNG chặn khi chưa biết mình là ai (fail-open, cùng luật tạm ứng)", () => {
    expect(canCompletePaymentBatch(batch({ createdBy: ME }), true, null)).toBe(true);
  });
});

describe("paymentBatchHasUnpaidLines — quyết định có hiện ô «Xác nhận đã chi tất cả» không", () => {
  it("true khi số dòng đã chi nhỏ hơn tổng số dòng", () => {
    expect(paymentBatchHasUnpaidLines(batch({ lineCount: 3, paidLineCount: 1 }))).toBe(true);
  });

  it("false khi mọi dòng đã đánh dấu đã chi", () => {
    expect(paymentBatchHasUnpaidLines(batch({ lineCount: 3, paidLineCount: 3 }))).toBe(false);
  });
});
