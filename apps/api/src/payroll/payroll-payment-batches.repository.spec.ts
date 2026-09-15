import { describe, expect, it, vi } from "vitest";

import type { TenantTx } from "../db/db.service";
import { PayrollPaymentBatchesRepository } from "./payroll-payment-batches.repository";
import { PayrollTemplatesRepository } from "./payroll-templates.repository";

/**
 * S15-PAYROLL-BE-4 — silent-failure-hunter H1, chứng minh ở CALL-SITE (không chỉ ở helper): ba câu đếm gác quyết định
 * (`uncoveredPayeesTx` = luật PHỦ `Published→Paid` · `lineCountsTx.unpaid` = 027 `batch-incomplete` · `periodsUsingTx` =
 * 409 `template-in-use`) phải NÉM khi driver trả 0 hàng — khuôn cũ `[0]?.n ?? 0` ở đúng chỗ này trả 0 = fail-OPEN.
 * Postgres không bao giờ trả 0 hàng cho `count(*)` nên int-spec không tới được nhánh này; stub `tx.execute` là cách duy nhất.
 */
const txReturning = (res: unknown): TenantTx =>
  ({ execute: vi.fn(async () => res) }) as unknown as TenantTx;
const COMPANY = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";

describe("S15-PAYROLL-BE-4 · call-site đếm gác quyết định KHÔNG mặc định 0", () => {
  it("uncoveredPayeesTx: 0 hàng ⇒ NÉM kèm nhãn (không phải 0 = «đủ phủ»); 1 hàng {n} ⇒ số", async () => {
    const repo = new PayrollPaymentBatchesRepository();
    await expect(repo.uncoveredPayeesTx(txReturning({ rows: [] }), COMPANY, ID)).rejects.toThrow(
      /uncoveredPayeesTx/,
    );
    await expect(
      repo.uncoveredPayeesTx(txReturning({ rows: [{ n: 2 }] }), COMPANY, ID),
    ).resolves.toBe(2);
  });

  it("lineCountsTx: 0 hàng ⇒ NÉM; ô `unpaid` thiếu ⇒ NÉM; hàng đủ ⇒ {live, unpaid}", async () => {
    const repo = new PayrollPaymentBatchesRepository();
    await expect(repo.lineCountsTx(txReturning({ rows: [] }), COMPANY, ID)).rejects.toThrow(
      /lineCountsTx/,
    );
    await expect(
      repo.lineCountsTx(txReturning({ rows: [{ live: 3 }] }), COMPANY, ID),
    ).rejects.toThrow(/lineCountsTx\.unpaid/);
    await expect(
      repo.lineCountsTx(txReturning({ rows: [{ live: 8, unpaid: "2" }] }), COMPANY, ID),
    ).resolves.toEqual({ live: 8, unpaid: 2 });
  });

  it("periodsUsingTx (052 template-in-use): 0 hàng ⇒ NÉM (không phải 0 = «không kỳ nào dùng»)", async () => {
    const repo = new PayrollTemplatesRepository();
    await expect(repo.periodsUsingTx(txReturning({ rows: [] }), COMPANY, ID)).rejects.toThrow(
      /periodsUsingTx/,
    );
    await expect(repo.periodsUsingTx(txReturning({ rows: [{ n: 0 }] }), COMPANY, ID)).resolves.toBe(
      0,
    );
  });
});
