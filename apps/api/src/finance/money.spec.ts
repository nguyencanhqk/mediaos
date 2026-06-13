import { describe, expect, it } from "vitest";
import {
  amountToCents,
  centsToDbString,
  centsToNumber,
  decimalStringToCents,
  MoneyError,
  splitCentsByWeights,
  sumCents,
} from "./money";

describe("money — decimalStringToCents", () => {
  it("parse chuỗi numeric chuẩn → cents", () => {
    expect(decimalStringToCents("1500000.50")).toBe(150000050n);
    expect(decimalStringToCents("0.01")).toBe(1n);
    expect(decimalStringToCents("42")).toBe(4200n);
    expect(decimalStringToCents("100.00")).toBe(10000n);
  });

  it("đệm phần thập phân thiếu, cắt phần thừa", () => {
    expect(decimalStringToCents("12.3")).toBe(1230n);
    expect(decimalStringToCents("12.349")).toBe(1234n); // cắt còn 2dp (DB scale 2)
  });

  it("xử lý dấu âm (bản ghi điều chỉnh giảm)", () => {
    expect(decimalStringToCents("-12.30")).toBe(-1230n);
  });

  it("ném MoneyError với chuỗi rác", () => {
    expect(() => decimalStringToCents("abc")).toThrow(MoneyError);
    expect(() => decimalStringToCents("")).toThrow(MoneyError);
    expect(() => decimalStringToCents("1.2.3")).toThrow(MoneyError);
  });
});

describe("money — amountToCents (biên DTO number)", () => {
  it("đổi number 2dp → cents không lỗi nhị phân", () => {
    expect(amountToCents(1500000.5)).toBe(150000050n);
    expect(amountToCents(0.1)).toBe(10n);
    expect(amountToCents(0.2)).toBe(20n);
    // 0.1 + 0.2 trong cents = 0.3 đúng tuyệt đối (float thì 0.30000000000000004)
    expect(amountToCents(0.1) + amountToCents(0.2)).toBe(amountToCents(0.3));
  });

  it("ném khi không hữu hạn hoặc vượt khoảng an toàn", () => {
    expect(() => amountToCents(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => amountToCents(Number.NaN)).toThrow(MoneyError);
    expect(() => amountToCents(Number.MAX_SAFE_INTEGER)).toThrow(MoneyError);
  });
});

describe("money — centsToDbString / centsToNumber (vòng lặp khứ hồi)", () => {
  it("cents → chuỗi DB numeric(18,2)", () => {
    expect(centsToDbString(150000050n)).toBe("1500000.50");
    expect(centsToDbString(1n)).toBe("0.01");
    expect(centsToDbString(0n)).toBe("0.00");
    expect(centsToDbString(-1230n)).toBe("-12.30");
  });

  it("cents → number DTO", () => {
    expect(centsToNumber(150000050n)).toBe(1500000.5);
    expect(centsToNumber(1n)).toBe(0.01);
    expect(centsToNumber(0n)).toBe(0);
  });

  it("khứ hồi number → cents → number giữ nguyên", () => {
    for (const v of [0, 0.01, 12.34, 999999.99, 5000000]) {
      expect(centsToNumber(amountToCents(v))).toBe(v);
    }
  });
});

describe("money — splitCentsByWeights (BẤT BIẾN: SUM === total)", () => {
  it("equal_split chia đều, dư dồn target cuối", () => {
    // 100.00 = 10000 cents / 3 → 3333,3333,3334
    const parts = splitCentsByWeights(10000n, [1, 1, 1]);
    expect(parts).toEqual([3333n, 3333n, 3334n]);
    expect(sumCents(parts)).toBe(10000n);
  });

  it("phân bổ theo trọng số (đếm video)", () => {
    // 100.00 theo [2,3,5] → 20,30,50
    const parts = splitCentsByWeights(10000n, [2, 3, 5]);
    expect(parts).toEqual([2000n, 3000n, 5000n]);
    expect(sumCents(parts)).toBe(10000n);
  });

  it("manual_percent 33.33/33.33/33.34 cộng đúng total", () => {
    const parts = splitCentsByWeights(10000n, [33.33, 33.33, 33.34]);
    expect(sumCents(parts)).toBe(10000n);
  });

  it("dư KHÔNG dồn vào target trọng số 0 (target cuối weight=0)", () => {
    // [1,1,0]: chia 10000 → 5000,5000,0 ; dư 0 nhưng nếu lệch thì target 0 vẫn phải = 0
    const parts = splitCentsByWeights(10001n, [1, 1, 0]);
    expect(parts[2]).toBe(0n); // target weight 0 KHÔNG nhận cent nào
    expect(sumCents(parts)).toBe(10001n);
    expect(parts[0] + parts[1]).toBe(10001n);
  });

  it("một target trọng số 0 ở giữa nhận 0", () => {
    const parts = splitCentsByWeights(9999n, [1, 0, 2]);
    expect(parts[1]).toBe(0n);
    expect(sumCents(parts)).toBe(9999n);
  });

  it("giữ bất biến SUM cho nhiều cấu hình biên", () => {
    const cases: Array<[bigint, number[]]> = [
      [1n, [1, 1, 1]],
      [7n, [1, 1, 1]],
      [100003n, [1, 2, 3, 4, 5, 6, 7]],
      [123457n, [0.5, 0.25, 0.25]],
      [999999999n, [3, 3, 3, 1]],
    ];
    for (const [total, weights] of cases) {
      const parts = splitCentsByWeights(total, weights);
      expect(sumCents(parts)).toBe(total);
      // mỗi phần không âm khi total dương
      expect(parts.every((p) => p >= 0n)).toBe(true);
    }
  });

  it("total âm (điều chỉnh giảm) vẫn giữ SUM === total", () => {
    const parts = splitCentsByWeights(-10000n, [1, 1, 1]);
    expect(sumCents(parts)).toBe(-10000n);
    expect(parts.every((p) => p <= 0n)).toBe(true);
  });

  it("ném MoneyError khi tổng trọng số = 0", () => {
    expect(() => splitCentsByWeights(10000n, [0, 0, 0])).toThrow(MoneyError);
  });

  it("ném khi trọng số âm", () => {
    expect(() => splitCentsByWeights(10000n, [1, -1])).toThrow(MoneyError);
  });
});
