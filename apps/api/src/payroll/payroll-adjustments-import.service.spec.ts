import { describe, expect, it } from "vitest";
import {
  ADJUSTMENT_IMPORT_COLUMNS,
  ADJUSTMENT_KIND_LABELS,
  headerMatches,
  parseAdjustmentMatrix,
} from "./payroll-adjustments-import.columns";

/**
 * S15-PAYROLL-BE-4 — parser THUẦN của `PAYROLL-API-076` (plan §4.6 · §6.1.3): ma trận chuỗi → dòng đã validate +
 * lỗi theo dòng. Không Nest, không DB. Hợp đồng đo ở đây:
 *  · header hàng 0 phải khớp ĐÚNG 5 nhãn (trim, không phân biệt hoa/thường) — lệch ⇒ `header-mismatch`;
 *  · `Loại` nhận enum (`bonus`/`penalty`) HOẶC nhãn Việt (`Thưởng`/`Thu nhập` → bonus · `Phạt`/`Khấu trừ` → penalty);
 *  · `Kỳ` phải bằng `period_month` của kỳ trong URL (chống nộp nhầm tệp) ⇒ lỗi dòng;
 *  · mã NV trùng trong tệp ⇒ lỗi CẢ các dòng trùng;
 *  · > 5.000 dòng ⇒ `too-large`; 0 dòng ⇒ `empty`;
 *  · 🔴 message lỗi dòng KHÔNG BAO GIỜ lặp lại số tiền (API-18 §6.5).
 */

const HEADER = ADJUSTMENT_IMPORT_COLUMNS.map((c) => c.header);
const MONTH = "2028-07";
const row = (code: string, kind: string, amount: string, reason = "ok", month = MONTH) => [
  code,
  kind,
  amount,
  reason,
  month,
];

describe("S15-PAYROLL-BE-4 · khuôn cột import 076/077", () => {
  it("5 cột theo VỊ TRÍ: Mã NV · Loại · Số tiền · Lý do · Kỳ (YYYY-MM) — MỘT nguồn cho parser lẫn tệp mẫu", () => {
    expect(ADJUSTMENT_IMPORT_COLUMNS.map((c) => c.key)).toEqual([
      "employeeCode",
      "kind",
      "amount",
      "reason",
      "periodMonth",
    ]);
    expect(HEADER).toEqual(["Mã NV", "Loại", "Số tiền", "Lý do", "Kỳ (YYYY-MM)"]);
    // Mỗi cột có ví dụ (tệp mẫu 077 sinh từ chính đây); ví dụ phải NẠP LẠI được vào chính parser.
    for (const c of ADJUSTMENT_IMPORT_COLUMNS) expect(c.example.length).toBeGreaterThan(0);
  });

  it("headerMatches — trim + không phân biệt hoa/thường; thiếu/lệch/thừa cột ⇒ false", () => {
    expect(headerMatches(HEADER)).toBe(true);
    expect(headerMatches(HEADER.map((h) => `  ${h.toUpperCase()} `))).toBe(true);
    expect(headerMatches(HEADER.slice(0, 4))).toBe(false);
    expect(headerMatches([...HEADER, "Ghi chú"])).toBe(false);
    expect(headerMatches(["Mã NV", "Số tiền", "Loại", "Lý do", "Kỳ (YYYY-MM)"])).toBe(false);
  });

  it("nhãn Việt → enum: Thưởng/Thu nhập ⇒ bonus · Phạt/Khấu trừ ⇒ penalty; enum gốc cũng qua", () => {
    expect(ADJUSTMENT_KIND_LABELS["thưởng"]).toBe("bonus");
    expect(ADJUSTMENT_KIND_LABELS["thu nhập"]).toBe("bonus");
    expect(ADJUSTMENT_KIND_LABELS["phạt"]).toBe("penalty");
    expect(ADJUSTMENT_KIND_LABELS["khấu trừ"]).toBe("penalty");
    const out = parseAdjustmentMatrix(
      [HEADER, row("NV1", "Thưởng", "100"), row("NV2", "KHẤU TRỪ", "50"), row("NV3", "bonus", "7")],
      MONTH,
    );
    expect(out.kind).toBe("ok");
    expect(out.rowErrors).toEqual([]);
    expect(out.rows.map((r) => r.kind)).toEqual(["bonus", "penalty", "bonus"]);
    // Số tiền chuẩn hoá về chuỗi thập phân 2 số (numeric(18,2)) — KHÔNG float.
    expect(out.rows.map((r) => r.amount)).toEqual(["100.00", "50.00", "7.00"]);
    expect(out.rows.map((r) => r.row)).toEqual([1, 2, 3]);
  });
});

describe("S15-PAYROLL-BE-4 · parseAdjustmentMatrix — lỗi theo dòng, KHÔNG lặp lại số tiền", () => {
  const SECRET_AMOUNT = "1234567";

  it("header lệch ⇒ kind `header-mismatch`, 0 dòng", () => {
    const out = parseAdjustmentMatrix([["A", "B", "C", "D", "E"], row("NV1", "bonus", "1")], MONTH);
    expect(out.kind).toBe("header-mismatch");
    expect(out.rows).toEqual([]);
  });

  it("tệp chỉ có header ⇒ `empty`", () => {
    expect(parseAdjustmentMatrix([HEADER], MONTH).kind).toBe("empty");
  });

  it("> 5.000 dòng dữ liệu ⇒ `too-large` (5.000 đúng trần ⇒ ok)", () => {
    const many = (n: number) => [
      HEADER,
      ...Array.from({ length: n }, (_, i) => row(`NV${i}`, "bonus", "1")),
    ];
    expect(parseAdjustmentMatrix(many(5000), MONTH).kind).toBe("ok");
    expect(parseAdjustmentMatrix(many(5001), MONTH).kind).toBe("too-large");
  });

  it("`Kỳ` ≠ kỳ trong URL ⇒ lỗi dòng (chống nộp nhầm tệp); dòng khác vẫn parse", () => {
    const out = parseAdjustmentMatrix(
      [HEADER, row("NV1", "bonus", "10", "ok", "2028-08"), row("NV2", "bonus", "10")],
      MONTH,
    );
    expect(out.kind).toBe("ok");
    expect(out.rowErrors.map((e) => e.row)).toEqual([1]);
    expect(out.rows.map((r) => r.employeeCode)).toEqual(["NV2"]);
  });

  it("mã NV trùng trong tệp ⇒ lỗi CẢ HAI dòng, không dòng nào của mã đó được giữ", () => {
    const out = parseAdjustmentMatrix(
      [HEADER, row("NV1", "bonus", "10"), row("nv1", "penalty", "5"), row("NV2", "bonus", "1")],
      MONTH,
    );
    expect(out.rowErrors.map((e) => e.row).sort()).toEqual([1, 2]);
    expect(out.rows.map((r) => r.employeeCode)).toEqual(["NV2"]);
  });

  it("số tiền sai / ≤ 0 / lý do trống / loại lạ ⇒ lỗi dòng; message KHÔNG chứa số tiền", () => {
    const out = parseAdjustmentMatrix(
      [
        HEADER,
        row("NV1", "bonus", SECRET_AMOUNT + "x"),
        row("NV2", "bonus", "0"),
        row("NV3", "bonus", `-${SECRET_AMOUNT}`),
        row("NV4", "bonus", SECRET_AMOUNT, "   "),
        row("NV5", "quà", SECRET_AMOUNT),
        row("", "bonus", SECRET_AMOUNT),
      ],
      MONTH,
    );
    expect(out.kind).toBe("ok");
    expect(out.rows).toEqual([]);
    expect(out.rowErrors.map((e) => e.row).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const e of out.rowErrors) {
      expect(e.message, `row ${e.row} lặp lại số tiền`).not.toContain(SECRET_AMOUNT);
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  it("số tiền có 2 chữ số thập phân qua; 3 chữ số ⇒ lỗi (mirror numeric(18,2))", () => {
    const out = parseAdjustmentMatrix(
      [HEADER, row("NV1", "bonus", "10.5"), row("NV2", "bonus", "10.555")],
      MONTH,
    );
    expect(out.rows.map((r) => r.amount)).toEqual(["10.50"]);
    expect(out.rowErrors.map((e) => e.row)).toEqual([2]);
  });

  it("ví dụ của tệp mẫu (077) nạp lại vào parser ⇒ 0 lỗi (khuôn tự-nhất-quán)", () => {
    const example = ADJUSTMENT_IMPORT_COLUMNS.map((c) => c.example);
    const month = example[4];
    const out = parseAdjustmentMatrix([HEADER, example], month);
    expect(out.kind).toBe("ok");
    expect(out.rowErrors).toEqual([]);
    expect(out.rows).toHaveLength(1);
  });
});
