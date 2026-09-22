import { describe, expect, it } from "vitest";
import {
  PAYROLL_STATUTORY_RATE_SEED,
  PAYROLL_SYSTEM_COMPONENTS,
} from "../payroll-master-data.seeder";
import { D, SCALE_INTERMEDIATE, SCALE_MONEY } from "./formula.decimal";
import { compileGraph, type GraphComponent } from "./formula.graph";
import { evaluateLine, type LineInput, type LineResult } from "./formula.line";
import { toStatutoryValues, type StatutoryValues } from "./formula.statutory";

/**
 * S15-PAYROLL-BE-2B — **ĐỐI SOÁT TAY ở tầng UNIT** cho cấu hình số học đang GIỮ (`precision: 50` ·
 * `ROUND_HALF_UP` · scale trung gian 10 · scale tiền 2 — SPEC-11 §13.6 F, owner chốt 22/09/2026).
 *
 * VÌ SAO THÊM FILE NÀY khi `s15-payroll-qa1-arith.int-spec.ts` đã có CÙNG bộ số: int-spec đó
 * `describe.skipIf(!hasLaneDb)` — không có `LANE_DB` là **im lặng SKIP, không FAIL**. Một lượt đổi
 * `precision`/scale (hoặc một refactor vô tình đụng đường dựng đồ thị ở `S15-PAYROLL-BE-2B` §2/§4) đi qua
 * CI mà không dòng nào đỏ. Ca dưới đây THUẦN (không Nest, không DB) nên chạy ở MỌI lượt, kể cả lượt không
 * có Postgres.
 *
 * 🔴 **ORACLE ĐỘC LẬP, KHÔNG do engine sinh**: mọi con số kỳ vọng lấy từ
 * `docs/QA/evidence/S15-PAYROLL-QA-1-doi-soat.py` (nhân sự **NV-L**) — Python `fractions.Fraction`, số học
 * PHÂN SỐ chính xác, KHÔNG import engine TS. Oracle tự-xác-nhận (chạy engine rồi chép kết quả xuống) là ca
 * RỖNG: nó ghim đúng con số hiện tại kể cả khi con số đó sai.
 *
 * Đồ thị = catalog hệ thống seed THẬT (`PAYROLL_SYSTEM_COMPONENTS`, 19 hàng) + bản tỉ lệ seed THẬT — spec
 * KHÔNG chép lại công thức/tỉ lệ (chép lại là tautology).
 */

const SEED_COMPONENTS: readonly GraphComponent[] = PAYROLL_SYSTEM_COMPONENTS.map((c) => ({
  code: c.code,
  kind: c.kind,
  valueType: c.valueType,
  formula: c.formula,
  fixedAmount: null,
  pitDeductible: c.pitDeductible,
}));
const SEED_STATUTORY: StatutoryValues = toStatutoryValues(PAYROLL_STATUTORY_RATE_SEED);

/**
 * NV-L — GROSS, bậc thuế THẤP, đủ mọi khoản. Đầu vào CỐ Ý LẺ (`…678.95` · `…567.85` · `…111.15` ·
 * `…222.25`) và ngày công 20/2 trên 22: fixture toàn số tròn làm ca này xanh-RỖNG vì mọi đường làm tròn
 * cho cùng kết quả. Khớp ĐÚNG BẰNG khối `if __name__ == "__main__"` của oracle.
 */
const NV_L: LineInput = {
  profile: {
    salaryType: "GROSS",
    baseSalary: "21345678.95",
    insuranceSalary: null,
    probationSalary: null,
    payRatioPct: "100.00",
    pitPayer: "EMPLOYEE",
  },
  days: {
    workDays: "22.00",
    presentDays: "20.00",
    paidLeaveDays: "0.00",
    unpaidLeaveDays: "2.00",
    lateMinutes: "0",
  },
  profileItems: { PHU_CAP: "234567.85" },
  participation: { socialInsurance: true, union: true },
  dependents: 1,
  bonusAmount: "111111.15",
  penaltyAmount: "22222.25",
  advanceAmount: "50000.00",
};

/** Bảng tay NV-L — `python docs/QA/evidence/S15-PAYROLL-QA-1-doi-soat.py`, đủ CẢ 19 mã seed. */
const ORACLE_NV_L: Readonly<Record<string, string>> = {
  LUONG_CO_BAN: "21345678.95",
  PHU_CAP: "234567.85",
  THUONG: "111111.15",
  NGHI_KHONG_LUONG: "-1940516.27",
  PHAT: "22222.25",
  TAM_UNG: "50000.00",
  TONG_THU_NHAP: "19750841.68",
  BHXH_NV: "1707654.32",
  BHYT_NV: "320185.18",
  BHTN_NV: "213456.79",
  DOAN_PHI: "213456.79",
  TONG_BH_NV: "2241296.29",
  THU_NHAP_CHIU_THUE: "2109545.39",
  TNCN: "105477.27",
  TONG_KHAU_TRU: "2632452.60",
  BHXH_DN: "3735493.82",
  BHYT_DN: "640370.37",
  BHTN_DN: "213456.79",
  KPCD: "426913.58",
};
/** `net` TRƯỚC clamp — clamp là việc của câu SQL ghi dòng, không phải của engine. */
const ORACLE_NET_BEFORE_CLAMP = "17118389.08";

const money = (r: LineResult): Record<string, string> =>
  Object.fromEntries([...r.values].map(([code, v]) => [code, v.toFixed(2)]));

describe("S15-PAYROLL-BE-2B — đối soát tay: cấu hình số học GIỮ nguyên thì số KHÔNG đổi một đồng", () => {
  it("neo chống xanh-RỖNG: bảng tay phủ ĐÚNG 19 mã của catalog seed (không thiếu, không thừa)", () => {
    const seeded = SEED_COMPONENTS.map((c) => c.code).sort();
    expect(seeded.length, "catalog seed v4 = 19 thành phần").toBe(19);
    expect(Object.keys(ORACLE_NV_L).sort()).toEqual(seeded);
  });

  it("NV-L (GROSS, bậc thuế thấp, đủ khoản): CẢ 19 cột khớp bảng tay ĐÚNG BẰNG", () => {
    const result = evaluateLine(
      compileGraph([...SEED_COMPONENTS], { requireEngineNodes: true }),
      SEED_STATUTORY,
      NV_L,
    );
    // `toEqual` chứ không `toMatchObject`: thiếu MỘT cột cũng phải đỏ.
    expect(money(result)).toEqual(ORACLE_NV_L);
    expect(result.gross.toFixed(2)).toBe(ORACLE_NV_L.TONG_THU_NHAP);
    expect(result.deduction.toFixed(2)).toBe(ORACLE_NV_L.TONG_KHAU_TRU);
    expect(result.gross.minus(result.deduction).toFixed(2)).toBe(ORACLE_NET_BEFORE_CLAMP);
    expect(result.grossUp, "hồ sơ GROSS không chạy vòng gross-up").toBeNull();
  });

  it("tự-kiểm ORACLE: bảng tay nhất quán nội tại (bốn nút tổng hợp cộng đúng từ các cột lẻ)", () => {
    // Không dùng engine — cộng THẲNG bằng `D` trên chính các con số của bảng tay. Nếu ai đó «sửa cho xanh»
    // một ô của ORACLE_NV_L thì ca này đỏ, kể cả khi ca trên vẫn xanh vì engine cũng bị sửa theo.
    const o = (code: string) => new D(ORACLE_NV_L[code]);
    expect(
      o("LUONG_CO_BAN").plus(o("PHU_CAP")).plus(o("THUONG")).plus(o("NGHI_KHONG_LUONG")).toFixed(2),
      "TONG_THU_NHAP = lương cơ bản + phụ cấp + thưởng + nghỉ không lương (earning ÂM)",
    ).toBe(ORACLE_NV_L.TONG_THU_NHAP);
    expect(
      o("BHXH_NV").plus(o("BHYT_NV")).plus(o("BHTN_NV")).toFixed(2),
      "TONG_BH_NV lọc theo `pit_deductible` ⇒ ĐOÀN PHÍ KHÔNG nằm trong (SPEC-11 §13.6 E)",
    ).toBe(ORACLE_NV_L.TONG_BH_NV);
    expect(
      o("PHAT")
        .plus(o("TAM_UNG"))
        .plus(o("BHXH_NV"))
        .plus(o("BHYT_NV"))
        .plus(o("BHTN_NV"))
        .plus(o("DOAN_PHI"))
        .plus(o("TNCN"))
        .toFixed(2),
      "TONG_KHAU_TRU cộng TNCN vì `pitPayer = EMPLOYEE`; đoàn phí CÓ trong khấu trừ",
    ).toBe(ORACLE_NV_L.TONG_KHAU_TRU);
    expect(new D(ORACLE_NV_L.TONG_THU_NHAP).minus(ORACLE_NV_L.TONG_KHAU_TRU).toFixed(2)).toBe(
      ORACLE_NET_BEFORE_CLAMP,
    );
  });

  it("chỉ số học ở scale tiền mới ĐÓNG BĂNG — phép trung gian vẫn giữ scale 10", () => {
    // Ghim quan hệ hai scale ngay trong ca đối soát: đảo hai hằng cho nhau (2 ↔ 10) là làm tròn từng
    // thành phần về 10 chữ số ⇒ `toFixed(2)` của ca trên vẫn có thể xanh, nhưng quan hệ dưới đây đỏ.
    expect(SCALE_MONEY).toBeLessThan(SCALE_INTERMEDIATE);
    expect(D.precision, "precision phải ĐỦ cho 18 chữ số + scale trung gian 10").toBeGreaterThan(
      18 + SCALE_INTERMEDIATE,
    );
  });
});
