/**
 * S13-PAYROLL-FE-1 — ma trận FSM ∩ quyền ∩ four-eyes của thanh hành động kỳ lương.
 *
 * ⚠️ **Mọi ca DENY ở đây đi CẶP với một ca ALLOW đối chứng.** Một spec chỉ chứng minh "không hiện nút"
 * là ca xanh-RỖNG: `availablePeriodActions` trả `[]` cho mọi thứ cũng làm nó xanh. Với từng vế bị chặn
 * (FSM · quyền · four-eyes · đã-sinh-phiếu) phải có một ca chứng minh rằng **gỡ đúng vế đó thì nút hiện
 * lại** — memory `deny-cases-vacuous-without-allow-case`.
 */
import { describe, it, expect } from "vitest";
import type { PayrollPeriodStatus } from "@mediaos/contracts";
import {
  availablePeriodActions,
  canAdjustLines,
  canDecideBonusPenalty,
  canEditBonusPenalty,
  IN_PLACE_ACTIONS,
  isFourEyesBlocked,
  isPeriodActionAllowedByFsm,
  isReopenBlocked,
  PAYROLL_PERIOD_ACTIONS,
  periodActionAvailability,
  periodActionTarget,
  PERIOD_ACTION_PAIR,
  PERIOD_TRANSITIONS,
  type PayrollPeriodAction,
  type PeriodActionSubject,
} from "./payroll-actions";

const ALL_STATUSES: readonly PayrollPeriodStatus[] = [
  "Draft",
  "CollectingData",
  "Calculated",
  "Reviewing",
  "Approved",
  "Paid",
  "Locked",
];

const ALLOW_ALL = () => true;
const DENY_ALL = () => false;

const subject = (over: Partial<PeriodActionSubject> = {}): PeriodActionSubject => ({
  status: "Calculated",
  payslipsGeneratedAt: null,
  submittedBy: null,
  ...over,
});

describe("PAYROLL FSM — bảng chuyển tiếp", () => {
  it("có ĐÚNG 10 chuyển tiếp đổi trạng thái + 3 hành động tại chỗ", () => {
    expect(PERIOD_TRANSITIONS).toHaveLength(10);
    expect(Object.keys(IN_PLACE_ACTIONS).sort()).toEqual([
      "calculate",
      "collect",
      "generate-payslips",
    ]);
  });

  it("`collect` lại TẠI CHỖ ở CollectingData (BẢNG §13.1 thắng văn xuôi)", () => {
    expect(isPeriodActionAllowedByFsm("collect", "CollectingData")).toBe(true);
    expect(periodActionTarget("collect", "CollectingData")).toBe("CollectingData");
  });

  it("Locked là terminal — KHÔNG hành động nào hợp lệ", () => {
    for (const action of PAYROLL_PERIOD_ACTIONS) {
      expect(isPeriodActionAllowedByFsm(action, "Locked"), action).toBe(false);
    }
  });

  it("`reopen` chỉ hợp lệ theo FSM từ Calculated/Reviewing/Approved", () => {
    const from = ALL_STATUSES.filter((s) => isPeriodActionAllowedByFsm("reopen", s));
    expect(from).toEqual(["Calculated", "Reviewing", "Approved"]);
  });

  it("ô không hợp lệ trả `null` ở periodActionTarget (không rơi về from)", () => {
    expect(periodActionTarget("approve", "Draft")).toBeNull();
    expect(periodActionTarget("approve", "Reviewing")).toBe("Approved");
  });
});

describe("PAYROLL — cặp quyền của từng hành động khớp bảng route", () => {
  it("9 hành động đều có cặp; 7 trong số đó là cặp SENSITIVE", () => {
    expect(Object.keys(PERIOD_ACTION_PAIR).sort()).toEqual([...PAYROLL_PERIOD_ACTIONS].sort());
    const sensitive = PAYROLL_PERIOD_ACTIONS.filter((a) => PERIOD_ACTION_PAIR[a].isSensitive);
    expect(sensitive.sort()).toEqual(
      [
        "approve",
        "calculate",
        "collect",
        "generate-payslips",
        "publish",
        "reject",
        "reopen",
        "submit",
      ].sort(),
    );
    // `lock` là cặp THƯỜNG (`manage:payroll-period`) — wildcard thoả được, gate bằng `useCan`.
    expect(PERIOD_ACTION_PAIR.lock).toEqual({
      action: "manage",
      resourceType: "payroll-period",
      isSensitive: false,
    });
  });
});

describe("PAYROLL — FSM ∩ quyền (deny CÓ ĐỐI CHỨNG allow)", () => {
  it("ALLOW đối chứng: Reviewing + đủ quyền ⇒ có `approve` và `reject`", () => {
    const actions = availablePeriodActions(subject({ status: "Reviewing" }), ALLOW_ALL, "u1");
    expect(actions).toContain("approve");
    expect(actions).toContain("reject");
  });

  it("DENY vì FSM: cùng quyền đó ở Draft thì KHÔNG có `approve`", () => {
    const actions = availablePeriodActions(subject({ status: "Draft" }), ALLOW_ALL, "u1");
    expect(actions).not.toContain("approve");
    // …nhưng vẫn có `collect` — chứng minh danh sách không rỗng vì lý do khác.
    expect(actions).toEqual(["collect"]);
  });

  it("DENY vì QUYỀN: cùng trạng thái Reviewing nhưng không quyền ⇒ rỗng", () => {
    expect(availablePeriodActions(subject({ status: "Reviewing" }), DENY_ALL, "u1")).toEqual([]);
  });

  it("lý do chặn ưu tiên FSM trước quyền (tooltip nói đúng chuyện)", () => {
    const rows = periodActionAvailability(subject({ status: "Draft" }), DENY_ALL, "u1");
    const approve = rows.find((r) => r.action === "approve");
    expect(approve?.reason).toBe("fsm");
    const collect = rows.find((r) => r.action === "collect");
    expect(collect?.reason).toBe("permission");
  });
});

describe("PAYROLL — four-eyes ẩn nút Duyệt (deny CÓ ĐỐI CHỨNG allow)", () => {
  const reviewing = subject({ status: "Reviewing", submittedBy: "u-submitter" });

  it("ALLOW đối chứng: người KHÁC người gửi duyệt vẫn thấy `approve`", () => {
    expect(availablePeriodActions(reviewing, ALLOW_ALL, "u-approver")).toContain("approve");
  });

  it("DENY: chính người gửi duyệt KHÔNG thấy `approve`…", () => {
    expect(availablePeriodActions(reviewing, ALLOW_ALL, "u-submitter")).not.toContain("approve");
  });

  it("…nhưng VẪN thấy `reject`/`reopen` (four-eyes chỉ chặn duyệt, không khoá cả thanh)", () => {
    const actions = availablePeriodActions(reviewing, ALLOW_ALL, "u-submitter");
    expect(actions).toContain("reject");
    expect(actions).toContain("reopen");
  });

  it("lý do chặn là `four-eyes`, KHÔNG phải `permission`", () => {
    const rows = periodActionAvailability(reviewing, ALLOW_ALL, "u-submitter");
    expect(rows.find((r) => r.action === "approve")?.reason).toBe("four-eyes");
  });

  it("currentUserId null ⇒ fail-OPEN ở FE (BE vẫn chặn) — nút không biến mất lúc /auth/me chưa về", () => {
    expect(isFourEyesBlocked(reviewing, null)).toBe(false);
    expect(availablePeriodActions(reviewing, ALLOW_ALL, null)).toContain("approve");
  });

  it("submittedBy null ⇒ không chặn ai", () => {
    expect(isFourEyesBlocked(subject({ status: "Reviewing" }), "u1")).toBe(false);
  });
});

describe("PAYROLL — reopen bị chặn khi đã sinh phiếu (deny CÓ ĐỐI CHỨNG allow)", () => {
  it("ALLOW đối chứng: Approved + CHƯA sinh phiếu ⇒ có `reopen`", () => {
    const p = subject({ status: "Approved", payslipsGeneratedAt: null });
    expect(isReopenBlocked(p)).toBe(false);
    expect(availablePeriodActions(p, ALLOW_ALL, "u1")).toContain("reopen");
  });

  it("DENY: Approved + ĐÃ sinh phiếu ⇒ KHÔNG có `reopen`…", () => {
    const p = subject({ status: "Approved", payslipsGeneratedAt: "2026-09-01T00:00:00.000Z" });
    expect(isReopenBlocked(p)).toBe(true);
    expect(availablePeriodActions(p, ALLOW_ALL, "u1")).not.toContain("reopen");
  });

  it("…nhưng `publish` vẫn còn (chặn đúng MỘT hành động, không khoá cả kỳ)", () => {
    const p = subject({ status: "Approved", payslipsGeneratedAt: "2026-09-01T00:00:00.000Z" });
    expect(availablePeriodActions(p, ALLOW_ALL, "u1")).toContain("publish");
  });

  it("lý do chặn là `payslips-generated`", () => {
    const p = subject({ status: "Approved", payslipsGeneratedAt: "2026-09-01T00:00:00.000Z" });
    const rows = periodActionAvailability(p, ALLOW_ALL, "u1");
    expect(rows.find((r) => r.action === "reopen")?.reason).toBe("payslips-generated");
  });

  it("Paid/Locked chặn reopen kể cả khi chưa sinh phiếu", () => {
    expect(isReopenBlocked(subject({ status: "Paid" }))).toBe(true);
    expect(isReopenBlocked(subject({ status: "Locked" }))).toBe(true);
  });
});

describe("PAYROLL — điều chỉnh dòng chỉ mở ở Calculated", () => {
  it("ALLOW đối chứng: Calculated + có quyền", () => {
    expect(canAdjustLines(subject({ status: "Calculated" }), true)).toBe(true);
  });

  it("DENY vì trạng thái: Approved trở đi là snapshot đóng băng", () => {
    for (const s of ["Reviewing", "Approved", "Paid", "Locked"] as const) {
      expect(canAdjustLines(subject({ status: s }), true), s).toBe(false);
    }
  });

  it("DENY vì quyền: Calculated nhưng thiếu cặp `calculate`", () => {
    expect(canAdjustLines(subject({ status: "Calculated" }), false)).toBe(false);
  });
});

describe("PAYROLL — thưởng/phạt: sửa & four-eyes", () => {
  const pending = { status: "Pending" as const, payrollPeriodId: null, createdBy: "u-creator" };

  it("ALLOW đối chứng: Pending + chưa consume + có quyền ⇒ sửa được", () => {
    expect(canEditBonusPenalty(pending, true)).toBe(true);
  });

  it("DENY vì đã consume (dù vẫn Pending)", () => {
    expect(canEditBonusPenalty({ ...pending, payrollPeriodId: "p1" }, true)).toBe(false);
  });

  it("DENY vì không còn Pending (dù chưa consume)", () => {
    expect(canEditBonusPenalty({ ...pending, status: "Approved" }, true)).toBe(false);
  });

  it("ALLOW đối chứng: người KHÁC người tạo quyết định được", () => {
    expect(canDecideBonusPenalty(pending, true, "u-other")).toBe(true);
  });

  it("DENY: chính người tạo KHÔNG quyết định được (PAYROLL-ERR-012)", () => {
    expect(canDecideBonusPenalty(pending, true, "u-creator")).toBe(false);
  });

  it("currentUserId null ⇒ fail-OPEN ở FE (cùng lý do với kỳ lương)", () => {
    expect(canDecideBonusPenalty(pending, true, null)).toBe(true);
  });
});

describe("PAYROLL — bao phủ: mọi (hành động, trạng thái) đều có phán quyết", () => {
  it("không ô nào ném/undefined trên 9×7 tổ hợp", () => {
    for (const action of PAYROLL_PERIOD_ACTIONS) {
      for (const status of ALL_STATUSES) {
        expect(typeof isPeriodActionAllowedByFsm(action, status)).toBe("boolean");
      }
    }
  });

  it("mỗi hành động hợp lệ ở ÍT NHẤT một trạng thái (không có hành động chết)", () => {
    for (const action of PAYROLL_PERIOD_ACTIONS as readonly PayrollPeriodAction[]) {
      const anywhere = ALL_STATUSES.some((s) => isPeriodActionAllowedByFsm(action, s));
      expect(anywhere, `${action} không hợp lệ ở bất kỳ trạng thái nào`).toBe(true);
    }
  });
});
