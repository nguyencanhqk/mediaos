import { describe, expect, it } from "vitest";

import { countOrThrow, intOrThrow, singleRowOrThrow } from "./payroll-sql.util";

/**
 * S15-PAYROLL-BE-4 — silent-failure-hunter H1: helper đếm gác quyết định KHÔNG được mặc định 0.
 * Ca «0 hàng ⇒ ném» là ca chính: đây chính là nhánh mà khuôn cũ `[0]?.n ?? 0` trả 0 (= «đủ phủ» / «không kỳ nào dùng»).
 */
describe("S15-PAYROLL-BE-4 · payroll-sql.util — scalar gác quyết định không mặc định 0", () => {
  it("countOrThrow: hình dạng `{rows:[{n}]}` của node-postgres ⇒ số", () => {
    expect(countOrThrow({ rows: [{ n: 3 }] }, "t")).toBe(3);
  });

  it("countOrThrow: hình dạng mảng thô + ô chuỗi số (`::int` qua text) ⇒ số; 0 hợp lệ vẫn là 0", () => {
    expect(countOrThrow([{ n: "0" }], "t")).toBe(0);
    expect(countOrThrow([{ n: "12" }], "t")).toBe(12);
  });

  it("countOrThrow: 0 hàng ⇒ NÉM (không phải 0) — nhánh fail-OPEN cũ", () => {
    expect(() => countOrThrow({ rows: [] }, "uncoveredPayeesTx")).toThrow(
      /uncoveredPayeesTx.*ĐÚNG 1 hàng.*nhận 0/,
    );
  });

  it("countOrThrow: ≥ 2 hàng ⇒ ném", () => {
    expect(() => countOrThrow({ rows: [{ n: 1 }, { n: 2 }] }, "t")).toThrow(/nhận 2/);
  });

  it("countOrThrow: kết quả undefined / không mảng / hàng null ⇒ ném", () => {
    expect(() => countOrThrow(undefined, "t")).toThrow(/không phải mảng hàng/);
    expect(() => countOrThrow({ rowCount: 1 }, "t")).toThrow(/không phải mảng hàng/);
    expect(() => countOrThrow({ rows: [null] }, "t")).toThrow(/không phải object/);
  });

  it("countOrThrow: ô không phải số nguyên ≥ 0 (thiếu khoá · chữ · âm · thập phân) ⇒ ném, nhãn kèm khoá", () => {
    expect(() => countOrThrow({ rows: [{}] }, "t")).toThrow(/t\.n.*không phải số nguyên/);
    expect(() => countOrThrow({ rows: [{ n: "abc" }] }, "t")).toThrow(/t\.n/);
    expect(() => countOrThrow({ rows: [{ n: -1 }] }, "t")).toThrow(/t\.n/);
    expect(() => countOrThrow({ rows: [{ n: 1.5 }] }, "t")).toThrow(/t\.n/);
    expect(() => countOrThrow({ rows: [{ m: 1 }] }, "t", "k")).toThrow(/t\.k/);
  });

  it("singleRowOrThrow: trả đúng hàng object để đọc nhiều cột (khuôn `lineCountsTx`)", () => {
    const row = singleRowOrThrow<{ live: number; unpaid: number }>(
      { rows: [{ live: 8, unpaid: 2 }] },
      "t",
    );
    expect(row).toEqual({ live: 8, unpaid: 2 });
    expect(intOrThrow(row.unpaid, "t.unpaid")).toBe(2);
  });

  it("thông báo lỗi chỉ chở nhãn + số hàng — không lặp nội dung hàng", () => {
    let message = "";
    try {
      countOrThrow({ rows: [{ n: "SECRET-4242" }] }, "t");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain("SECRET-4242");
  });
});
