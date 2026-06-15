import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { decideExpenseSchema } from "@mediaos/contracts";
import { ExpenseRequestService } from "./expense.service";

/**
 * G13-4 — Unit (no-DB) cho ExpenseRequestService. Khẳng định HỢP ĐỒNG SHAPE + biên validate KHÔNG cần
 * Postgres (deny-path RLS/permission/append-only chạy ở finance-expense-deny.int-spec.ts):
 *  - Service KHÔNG có update()/delete() tay (append-only expense_approvals + cost_records).
 *  - decide(rejected) thiếu comment bị chặn (mirror contract decideExpenseSchema.refine).
 */
describe("ExpenseRequestService (unit, no-DB)", () => {
  /** Service tạo với deps null — chỉ kiểm shape + validate trước khi chạm DB (không gọi method ghi). */
  const svc = new ExpenseRequestService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );

  it("phơi bày create()/decide()/list(); KHÔNG có update()/delete() (append-only)", () => {
    expect(typeof svc.create).toBe("function");
    expect(typeof svc.decide).toBe("function");
    expect(typeof svc.list).toBe("function");
    expect((svc as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).delete).toBeUndefined();
  });

  describe("decide(rejected) bắt buộc comment", () => {
    it("decide(rejected) thiếu comment → BadRequestException (không chạm DB)", async () => {
      await expect(
        svc.decide("co-1", "user-1", "exp-1", { decision: "rejected" } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("decide(rejected) comment rỗng/space → BadRequestException", async () => {
      await expect(
        svc.decide("co-1", "user-1", "exp-1", {
          decision: "rejected",
          comment: "   ",
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("contract decideExpenseSchema (nguồn sự thật DTO)", () => {
    it("rejected thiếu comment → parse fail", () => {
      expect(decideExpenseSchema.safeParse({ decision: "rejected" }).success).toBe(false);
    });
    it("rejected có comment → parse ok", () => {
      expect(
        decideExpenseSchema.safeParse({ decision: "rejected", comment: "lý do" }).success,
      ).toBe(true);
    });
    it("approved không cần comment → parse ok", () => {
      expect(decideExpenseSchema.safeParse({ decision: "approved" }).success).toBe(true);
    });
  });
});
