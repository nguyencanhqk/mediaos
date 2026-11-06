import { describe, expect, it } from "vitest";
import * as contracts from "./index";
import {
  assetSummaryResponseSchema,
  payrollSysRefEnum,
  payrollTemplatePreviewSchema,
  updateShiftSchema,
} from "./index";

/**
 * S19-OPS-ZOD4-1 — C1.3 + C1.4: ca GHIM hành vi trước khi nâng zod 3 → 4 (plan §3.3, §4.3–4.4).
 *
 * Mọi ca XANH trên zod 3.25.76. Chúng tồn tại để ĐỎ trên zod 4 nếu bản vá thiếu:
 *  - C1.3 `.partial()` trên object có `.default()`: zod 4 ÁP default cho field vắng (`optional(default)`) ⇒ PATCH
 *    `{ name }` sẽ ghi đè im lặng `shiftType`/`breakMinutes`/`isDefault`… Bản vá: tách `shiftCoreSchema`.
 *  - C1.4 `z.record(<enum>, X)`: zod 4 coi enum-key là VÉT CẠN ⇒ map thiếu khoá thành lỗi. Bản vá: `z.partialRecord`.
 *
 * Chỉ dùng API công khai (`parse`/`safeParse`/`.shape`) — không đọc `_def` (đổi hình ở zod 4).
 */

describe("C1.3 — update/patch không sinh khoá ngoài body (partial trên default)", () => {
  it("updateShiftSchema.parse({ name }) chỉ trả đúng { name }", () => {
    expect(updateShiftSchema.parse({ name: "x" })).toEqual({ name: "x" });
  });

  it("updateShiftSchema.parse({}) trả {} — không default nào lọt vào PATCH", () => {
    expect(updateShiftSchema.parse({})).toEqual({});
  });

  /**
   * Quét MỌI schema export tên `update…Schema`/`patch…Schema`: schema nào nhận `{}` thì output PHẢI rỗng.
   * Schema có refine «ít nhất một field» từ chối `{}` ⇒ không đo được ở đây (đã soát tay, plan §10).
   */
  it("mọi update/patch schema nhận {} đều trả {} (kèm chống xanh rỗng)", () => {
    const names = Object.keys(contracts).filter((k) => /^(update|patch)\w*Schema$/.test(k));
    const accepting: string[] = [];
    const leaking: string[] = [];
    for (const name of names) {
      const schema = (contracts as Record<string, unknown>)[name] as {
        safeParse?: (v: unknown) => { success: boolean; data?: unknown };
      };
      if (typeof schema?.safeParse !== "function") continue;
      const res = schema.safeParse({});
      if (!res.success) continue;
      accepting.push(name);
      if (res.data && typeof res.data === "object" && Object.keys(res.data).length > 0) {
        leaking.push(`${name}: ${Object.keys(res.data).join(",")}`);
      }
    }
    expect(names.length, "không thấy schema update/patch nào ⇒ quét rỗng").toBeGreaterThan(30);
    expect(accepting, "updateShiftSchema phải nằm trong tập đo được").toContain(
      "updateShiftSchema",
    );
    expect(accepting.length, "quá ít schema nhận {} ⇒ ca này gần như không đo gì").toBeGreaterThan(
      10,
    );
    expect(leaking).toEqual([]);
  });
});

describe("C1.4 — z.record(<enum>) nhận map THIẾU khoá", () => {
  it("asset byStatus (RESPONSE): chỉ một trạng thái vẫn parse được", () => {
    expect(assetSummaryResponseSchema.shape.byStatus.parse({ Assigned: 3 })).toEqual({
      Assigned: 3,
    });
    expect(assetSummaryResponseSchema.shape.byStatus.parse({})).toEqual({});
  });

  it("asset byStatus vẫn từ chối khoá ngoài enum (không nới thành record chuỗi)", () => {
    expect(assetSummaryResponseSchema.shape.byStatus.safeParse({ Bogus: 1 }).success).toBe(false);
  });

  it("payroll preview inputs (BODY): một khoá sys-ref vẫn parse được, vắng ⇒ {}", () => {
    const key = payrollSysRefEnum.options[0];
    const one = payrollTemplatePreviewSchema.shape.inputs.parse({ [key]: "100.00" });
    expect(one).toEqual({ [key]: "100.00" });
    expect(payrollTemplatePreviewSchema.shape.inputs.parse(undefined)).toEqual({});
  });
});
