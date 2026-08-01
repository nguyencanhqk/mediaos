import { describe, expect, it } from "vitest";
import {
  buildCarryPlan,
  buildExpirePlan,
  carryoverSettlementDate,
  expiryDateFor,
  floor1,
  type CarryoverBalanceInput,
  type CarryoverEmployeeInput,
  type CarryoverPolicyInput,
} from "./leave-carryover.logic";

/**
 * S6-LEAVE-CARRYOVER-1 — unit của LÕI THUẦN (không DB, không Nest). Viết & chạy ĐỎ TRƯỚC khi có engine.
 *
 * Mỗi ca dưới đây neo một quyết định trong docs/plans/S6-LEAVE-CARRYOVER-1.md §3. Ca nào mất đi thì một
 * lỗ đã từng được vá sẽ mở lại — đặc biệt #12 (bật công tắc sau mốc), #5 (pending), #3 (mốc chốt sổ).
 */

const POLICY: CarryoverPolicyInput = {
  policyId: "p1",
  policyCode: "DEFAULT_ANNUAL",
  leaveTypeId: "t1",
  allowCarryForward: true,
  maxCarryForwardDays: null,
  expiryMonth: 3,
  expiryDay: 31,
  reserveBalanceOnPending: true,
};

const EMPLOYEE: CarryoverEmployeeInput = {
  employeeId: "e1",
  userId: "u1",
  employeeCode: "1001",
  endDate: null,
};

/** Dòng số dư năm 2026: cấp 12, chưa dùng gì. */
function balance(over: Partial<CarryoverBalanceInput> = {}): CarryoverBalanceInput {
  return {
    balanceId: "b1",
    year: 2026,
    totalDays: "12.0",
    usedDays: "0.0",
    pendingDays: "0.00",
    carriedOverDays: null,
    expiredDays: null,
    ...over,
  };
}

function carry(
  over: {
    policy?: Partial<CarryoverPolicyInput>;
    balance?: Partial<CarryoverBalanceInput>;
    employee?: Partial<CarryoverEmployeeInput>;
    today?: string;
    alreadyCarriedDays?: number;
    lastCarryTxDate?: string | null;
  } = {},
) {
  return buildCarryPlan({
    policy: { ...POLICY, ...over.policy },
    balance: balance(over.balance),
    employee: { ...EMPLOYEE, ...over.employee },
    today: over.today ?? "2027-02-01",
    alreadyCarriedDays: over.alreadyCarriedDays ?? 0,
    lastCarryTxDate: over.lastCarryTxDate ?? null,
  });
}

function expire(
  over: {
    policy?: Partial<CarryoverPolicyInput>;
    balance?: Partial<CarryoverBalanceInput>;
    today?: string;
    /** Bỏ qua ⇒ suy ra MỘT dòng ghi có đúng bằng `carried_over_days`, ngày 01/02 (trước mốc mặc định). */
    carryCredits?: { transactionDate: string; amountDays: number }[];
    lastExpireTxDate?: string | null;
  } = {},
) {
  const bal = balance({ year: 2027, ...over.balance });
  const carried = Number(bal.carriedOverDays ?? 0);
  return buildExpirePlan({
    policy: { ...POLICY, ...over.policy },
    balance: bal,
    today: over.today ?? "2027-04-01",
    carryCredits:
      over.carryCredits ??
      (carried > 0 ? [{ transactionDate: "2027-02-01", amountDays: carried }] : []),
    lastExpireTxDate: over.lastExpireTxDate ?? null,
  });
}

describe("expiryDateFor — mốc LẶP theo năm (§3.5)", () => {
  it("dựng mốc 31/03 của đúng năm được hỏi", () => {
    expect(expiryDateFor(2027, 3, 31)).toBe("2027-03-31");
    expect(expiryDateFor(2028, 3, 31)).toBe("2028-03-31");
  });

  it("cắt 29/02 về 28/02 ở năm KHÔNG nhuận, giữ nguyên ở năm nhuận", () => {
    expect(expiryDateFor(2027, 2, 29)).toBe("2027-02-28");
    expect(expiryDateFor(2028, 2, 29)).toBe("2028-02-29");
  });

  it("cắt ngày 31 về ngày cuối tháng thật của tháng 30 ngày", () => {
    expect(expiryDateFor(2027, 4, 31)).toBe("2027-04-30");
  });
});

describe("floor1 — làm tròn XUỐNG 1 chữ số (§3.3)", () => {
  it("không bao giờ vượt số gốc", () => {
    expect(floor1(5.25)).toBe(5.2);
    expect(floor1(7.29)).toBe(7.2);
    expect(floor1(3)).toBe(3);
    expect(floor1(0.05)).toBe(0);
  });

  it("không rơi xuống bậc dưới vì sai số dấu phẩy động", () => {
    expect(floor1(0.1 + 0.2)).toBe(0.3);
    expect(floor1(7.2)).toBe(7.2);
  });
});

describe("carryoverSettlementDate — mốc chốt sổ 01/02 (§3.3 · F7)", () => {
  it("chuyển năm Y chỉ mở từ 01/02 của năm Y+1", () => {
    expect(carryoverSettlementDate(2026)).toBe("2027-02-01");
  });
});

describe("buildCarryPlan", () => {
  it("#3 chưa tới mốc chốt sổ ⇒ BEFORE_SETTLEMENT, không chuyển ngày nào", () => {
    const r = carry({ today: "2027-01-31" });
    expect(r.skipReason).toBe("BEFORE_SETTLEMENT");
    expect(r.amountDays).toBe(0);
  });

  it("#3 đúng ngày mốc chốt sổ ⇒ chuyển", () => {
    const r = carry({ today: "2027-02-01" });
    expect(r.skipReason).toBeNull();
    expect(r.amountDays).toBe(12);
  });

  it("#4 trần cắt số chuyển; trần 0 ⇒ không chuyển", () => {
    expect(carry({ policy: { maxCarryForwardDays: "5" } }).amountDays).toBe(5);
    expect(carry({ policy: { maxCarryForwardDays: "0" } }).amountDays).toBe(0);
    expect(carry({ policy: { maxCarryForwardDays: null } }).amountDays).toBe(12);
  });

  it("#5 pending_days bị LOẠI khỏi phần chuyển (F3 — nếu không sẽ vỡ CHECK lúc duyệt đơn)", () => {
    const r = carry({ balance: { totalDays: "12.0", usedDays: "2.0", pendingDays: "3.00" } });
    expect(r.amountDays).toBe(7);
  });

  it("#6 mọi cột phân rã NULL (đúng hình dòng ensureBalanceTx vừa tạo) ⇒ vẫn tính đúng", () => {
    const r = carry({
      balance: { usedDays: null, pendingDays: null, carriedOverDays: null, expiredDays: null },
    });
    expect(r.amountDays).toBe(12);
    expect(Number.isNaN(r.amountDays)).toBe(false);
  });

  it("#7 làm tròn XUỐNG ở chỗ số lẻ 2 chữ số thật sự xuất hiện: trần 5.25 ⇒ 5.2", () => {
    expect(carry({ policy: { maxCarryForwardDays: "5.25" } }).amountDays).toBe(5.2);
  });

  it("#8 trần trừ phần ĐÃ chuyển ⇒ dòng bù không được cấp lại trọn trần", () => {
    const r = carry({ policy: { maxCarryForwardDays: "5" }, alreadyCarriedDays: 3 });
    expect(r.amountDays).toBe(2);
  });

  it("#L1 trần đã dùng HẾT mà vẫn còn ngày khả dụng ⇒ BÁO CAP_EXHAUSTED, không lặng lẽ trả 0", () => {
    // "Không còn gì để chuyển" và "còn nhưng chính sách chặn" cần hành động khác nhau ⇒ phải phân biệt được.
    const r = carry({ policy: { maxCarryForwardDays: "3" }, alreadyCarriedDays: 3 });
    expect(r.skipReason).toBe("CAP_EXHAUSTED");
    expect(r.amountDays).toBe(0);
  });

  it("#H3 đã ghi CARRY_OVER hôm nay rồi ⇒ hoãn sang mai thay vì đâm khoá mỗi 60 giây", () => {
    // Khoá `uq_..._carryover_daily` chỉ cho 1 dòng/ngày/dòng-số-dư. Số khả dụng tăng lại NGAY TRONG NGÀY
    // (HR từ chối đơn lúc 10:05 sau khi engine chạy lúc 10:00) là chuyện thường — nếu cứ lên kế hoạch thì
    // mỗi nhịp một run 'Failed' + một dòng ERROR tới nửa đêm UTC, dù KHÔNG mất ngày phép nào.
    const r = carry({ lastCarryTxDate: "2027-02-01" });
    expect(r.skipReason).toBe("ALREADY_WROTE_TODAY");
    expect(r.amountDays).toBe(0);
  });

  it("#H3b ghi hôm QUA thì hôm nay vẫn chuyển bù bình thường", () => {
    const r = carry({ today: "2027-02-02", lastCarryTxDate: "2027-02-01" });
    expect(r.skipReason).toBeNull();
    expect(r.amountDays).toBe(12);
  });

  it("#9 khả dụng ≤ 0 ⇒ NOTHING_TO_CARRY", () => {
    const r = carry({ balance: { totalDays: "5.0", usedDays: "5.0" } });
    expect(r.skipReason).toBe("NOTHING_TO_CARRY");
    expect(r.amountDays).toBe(0);
  });

  it("#9 reserve_balance_on_pending = false ⇒ RESERVE_DISABLED (số 'khả dụng' không đáng tin)", () => {
    const r = carry({ policy: { reserveBalanceOnPending: false } });
    expect(r.skipReason).toBe("RESERVE_DISABLED");
    expect(r.amountDays).toBe(0);
  });

  it("#10 nghỉ việc TRƯỚC 01/01 năm mới ⇒ EMPLOYEE_LEFT; nghỉ việc TRONG năm mới ⇒ vẫn chuyển", () => {
    expect(carry({ employee: { endDate: "2026-06-30" } }).skipReason).toBe("EMPLOYEE_LEFT");
    expect(carry({ employee: { endDate: "2027-03-15" } }).skipReason).toBeNull();
    // đúng ranh giới: nghỉ ngày cuối năm cũ = chưa sang năm mới
    expect(carry({ employee: { endDate: "2026-12-31" } }).skipReason).toBe("EMPLOYEE_LEFT");
    expect(carry({ employee: { endDate: "2027-01-01" } }).skipReason).toBeNull();
  });

  it("công tắc TẮT ⇒ không chuyển và KHÔNG báo lý do (là lựa chọn của HR, không phải lỗi)", () => {
    const r = carry({ policy: { allowCarryForward: false } });
    expect(r.amountDays).toBe(0);
    expect(r.skipReason).toBeNull();
  });
});

describe("buildExpirePlan", () => {
  it("#2 ĐÚNG ngày mốc vẫn dùng được; SAU mốc mới hết hạn", () => {
    const b = { carriedOverDays: "5.00" };
    expect(expire({ balance: b, today: "2027-03-31" }).amountDays).toBe(0);
    expect(expire({ balance: b, today: "2027-04-01" }).amountDays).toBe(5);
  });

  it("#11 FIFO — phần chuyển tiếp được TIÊU TRƯỚC", () => {
    expect(
      expire({ balance: { carriedOverDays: "5.00", totalDays: "17.0", usedDays: "6.0" } })
        .amountDays,
    ).toBe(0);
    expect(
      expire({ balance: { carriedOverDays: "5.00", totalDays: "17.0", usedDays: "0.0" } })
        .amountDays,
    ).toBe(5);
    expect(
      expire({
        balance: {
          carriedOverDays: "5.00",
          totalDays: "17.0",
          usedDays: "2.0",
          pendingDays: "1.00",
        },
      }).amountDays,
    ).toBe(2);
  });

  it("#12 đã hết hạn rồi ⇒ lần sau 0 (hội tụ, không đâm khoá mỗi nhịp)", () => {
    const r = expire({ balance: { carriedOverDays: "5.00", expiredDays: "5.00" } });
    expect(r.amountDays).toBe(0);
  });

  it("#13 ngày được chuyển vào SAU mốc thì mốc đó KHÔNG áp dụng (chống xoá sạch phép sau 60 giây)", () => {
    const r = expire({
      balance: { carriedOverDays: "12.00", totalDays: "12.0" },
      today: "2027-06-01",
      carryCredits: [{ transactionDate: "2027-06-01", amountDays: 12 }],
    });
    expect(r.skipReason).toBe("CARRIED_AFTER_DEADLINE");
    expect(r.amountDays).toBe(0);
  });

  it("#13b mốc chỉ ăn phần chuyển vào TRƯỚC nó — một dòng ghi có muộn KHÔNG miễn nhiễm cả dòng số dư", () => {
    // 12 ngày vào 01/02 (trước mốc 31/03) + 3 ngày vào 10/04 (sau mốc). Chỉ 12 ngày kia được hết hạn.
    const r = expire({
      balance: { carriedOverDays: "15.00", totalDays: "15.0" },
      today: "2027-06-01",
      carryCredits: [
        { transactionDate: "2027-02-01", amountDays: 12 },
        { transactionDate: "2027-04-10", amountDays: 3 },
      ],
    });
    expect(r.amountDays).toBe(12);
    expect(r.skipReason).toBeNull();
  });

  it("#H2 có carried_over_days nhưng KHÔNG có dòng sổ cái nào ⇒ BÁO CARRIED_NO_LEDGER, không im lặng", () => {
    // Nhập tay/import: engine không biết những ngày đó được ghi có lúc nào ⇒ không được đoán, và cũng
    // KHÔNG được lặng lẽ bỏ qua (bản đầu trả về 0 không kèm lý do ⇒ số ngày đó sống mãi mà không ai biết).
    const r = expire({
      balance: { carriedOverDays: "5.00", totalDays: "17.0" },
      carryCredits: [],
    });
    expect(r.skipReason).toBe("CARRIED_NO_LEDGER");
    expect(r.amountDays).toBe(0);
  });

  it("#H3 đã ghi EXPIRE hôm nay rồi ⇒ hoãn sang mai (khoá chỉ cho 1 dòng/ngày/dòng-số-dư)", () => {
    const r = expire({
      balance: { carriedOverDays: "5.00", totalDays: "17.0" },
      lastExpireTxDate: "2027-04-01",
    });
    expect(r.skipReason).toBe("ALREADY_WROTE_TODAY");
    expect(r.amountDays).toBe(0);
  });

  it("#14 mốc 31/12 ⇒ không hết hạn trong năm", () => {
    const r = expire({
      policy: { expiryMonth: 12, expiryDay: 31 },
      balance: { carriedOverDays: "5.00" },
      today: "2027-12-31",
    });
    expect(r.amountDays).toBe(0);
  });

  it("hết hạn KHÔNG phụ thuộc công tắc allow_carry_forward (tắt sau khi đã chuyển vẫn phải dọn)", () => {
    const r = expire({
      policy: { allowCarryForward: false },
      balance: { carriedOverDays: "5.00" },
    });
    expect(r.amountDays).toBe(5);
  });

  it("không có phần chuyển tiếp nào ⇒ không hết hạn, cũng KHÔNG báo lý do (không có gì để nói)", () => {
    const r = expire({ balance: { carriedOverDays: null }, carryCredits: [] });
    expect(r.amountDays).toBe(0);
    expect(r.skipReason).toBeNull();
  });

  it("cận trên thứ hai: không bao giờ đẩy total_days xuống dưới used + pending", () => {
    const r = expire({
      balance: { carriedOverDays: "10.00", totalDays: "4.0", usedDays: "3.0", pendingDays: "1.00" },
    });
    expect(r.amountDays).toBe(0);
  });
});
