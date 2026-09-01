import { describe, expect, it } from "vitest";
import type { PayrollPeriodStatus } from "@mediaos/contracts";
import {
  assertPeriodTransition,
  assertReopenAllowed,
  IN_PLACE_ACTIONS,
  isAllowedTransition,
  nextStatus,
  PERIOD_TRANSITIONS,
  TRAIL_RESET,
  type PeriodAction,
} from "./payroll-fsm";

/**
 * S13-PAYROLL-BE-1 — FSM kỳ lương, ma trận **49 ô** (SPEC-11 §13.1).
 *
 * ⚠️ Spec này CỐ Ý có CẢ ca ALLOW lẫn ca DENY. 36 ca "phải ném" mà không có ca đối chứng "phải KHÔNG
 * ném" là **xanh RỖNG** — một hàm `assertPeriodTransition` luôn-ném cũng làm chúng xanh
 * (memory `deny-cases-vacuous-without-allow-case`).
 *
 * ⚠️ Và spec KHÔNG đếm tay: ca (d) suy tập ô hợp lệ **từ chính hằng** rồi so hai chiều với danh sách
 * liệt kê dưới đây. Plan v1 từng viết "11 ô ✓" — sai; con số viết tay không ai kiểm được.
 */

const STATUSES: PayrollPeriodStatus[] = [
  "Draft",
  "CollectingData",
  "Calculated",
  "Reviewing",
  "Approved",
  "Paid",
  "Locked",
];

/** Chép TAY từ bảng SPEC-11 §13.1 — 10 ô đổi trạng thái. */
const EXPECTED_MOVES: ReadonlyArray<[PayrollPeriodStatus, PayrollPeriodStatus, PeriodAction]> = [
  ["Draft", "CollectingData", "collect"],
  ["CollectingData", "Calculated", "calculate"],
  ["Calculated", "Reviewing", "submit"],
  ["Reviewing", "Calculated", "reject"],
  ["Reviewing", "Approved", "approve"],
  ["Approved", "Paid", "publish"],
  ["Paid", "Locked", "lock"],
  ["Calculated", "CollectingData", "reopen"],
  ["Reviewing", "CollectingData", "reopen"],
  ["Approved", "CollectingData", "reopen"],
];

/** Chép TAY — 3 ô TẠI CHỖ (đường chéo hợp lệ). */
const EXPECTED_IN_PLACE: ReadonlyArray<[PayrollPeriodStatus, PeriodAction]> = [
  ["CollectingData", "collect"],
  ["Calculated", "calculate"],
  ["Approved", "generate-payslips"],
];

const ALL_ACTIONS: PeriodAction[] = [
  "collect",
  "calculate",
  "submit",
  "approve",
  "reject",
  "generate-payslips",
  "publish",
  "lock",
  "reopen",
];

const key = (from: string, to: string, via: string) => `${from}->${to}:${via}`;

describe("S13-PAYROLL-BE-1 · FSM kỳ lương (SPEC-11 §13.1)", () => {
  it("(a) 10 ô ĐỔI trạng thái — ALLOW đối chứng: không ném", () => {
    expect(EXPECTED_MOVES).toHaveLength(10);
    for (const [from, to, via] of EXPECTED_MOVES) {
      expect(() => assertPeriodTransition(from, to, via), key(from, to, via)).not.toThrow();
      expect(nextStatus(from, via), key(from, to, via)).toBe(to);
    }
  });

  it("(b) 3 ô TẠI CHỖ — không ném, và `nextStatus` trả chính trạng thái đó", () => {
    expect(EXPECTED_IN_PLACE).toHaveLength(3);
    for (const [at, via] of EXPECTED_IN_PLACE) {
      expect(() => assertPeriodTransition(at, at, via), key(at, at, via)).not.toThrow();
      expect(nextStatus(at, via), key(at, at, via)).toBe(at);
    }
  });

  it("(c) 36 ô CẤM (49 − 10 − 3) — ném PAYROLL-ERR-001 kèm from/to", () => {
    const allowed = new Set<string>();
    for (const [f, t] of EXPECTED_MOVES) allowed.add(`${f}->${t}`);
    for (const [at] of EXPECTED_IN_PLACE) allowed.add(`${at}->${at}`);

    const denied: string[] = [];
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        if (allowed.has(`${from}->${to}`)) continue;
        denied.push(`${from}->${to}`);
        // Ô cấm phải cấm với MỌI action, không chỉ action "tự nhiên" của nó.
        for (const via of ALL_ACTIONS) {
          expect(isAllowedTransition(from, to, via), `${from}->${to}:${via}`).toBe(false);
          let thrown: unknown;
          try {
            assertPeriodTransition(from, to, via);
          } catch (e) {
            thrown = e;
          }
          const res = (thrown as { response?: { code?: string; message?: string } })?.response;
          expect(res?.code, `${from}->${to}:${via}`).toBe("PAYROLL-ERR-001");
          expect(res?.message).toContain(from);
          expect(res?.message).toContain(to);
        }
      }
    }
    expect(denied).toHaveLength(36);
  });

  it("(d) SUY NGƯỢC từ hằng — tập ô hợp lệ khớp danh sách chép tay, HAI CHIỀU", () => {
    const fromConst = new Set<string>();
    for (const t of PERIOD_TRANSITIONS) fromConst.add(key(t.from, t.to, t.action));
    for (const [via, at] of Object.entries(IN_PLACE_ACTIONS)) fromConst.add(key(at, at, via));

    const fromHand = new Set<string>();
    for (const [f, t, via] of EXPECTED_MOVES) fromHand.add(key(f, t, via));
    for (const [at, via] of EXPECTED_IN_PLACE) fromHand.add(key(at, at, via));

    // Hai chiều: hằng không được có ô nào ngoài danh sách, và ngược lại.
    expect([...fromConst].sort()).toEqual([...fromHand].sort());
    expect(fromConst.size).toBe(13);
  });

  it("(e) TRAIL_RESET đủ 9 action, `clear ∩ set = ∅`, không thiếu `generate-payslips`", () => {
    expect(Object.keys(TRAIL_RESET).sort()).toEqual([...ALL_ACTIONS].sort());
    // Ô này là lý do bảng RESET của plan v1 sai: thiếu nó, BE-2 tự chế cặp ghi ⇒ 23514 từ
    // `payroll_periods_generated_pair_check`.
    expect(TRAIL_RESET["generate-payslips"].set).toEqual(["payslipsGenerated"]);
    for (const via of ALL_ACTIONS) {
      const { clear, set } = TRAIL_RESET[via];
      expect(
        clear.filter((c) => set.includes(c)),
        via,
      ).toEqual([]);
    }
    // Mọi action ĐỔI trạng thái phải có mặt trong bảng RESET (kể cả khi cả hai vế rỗng).
    for (const t of PERIOD_TRANSITIONS) expect(TRAIL_RESET[t.action]).toBeDefined();
  });

  it("(f) `reopen` xoá ĐÚNG 3 cặp vết — KHÔNG chạm published/locked", () => {
    expect([...TRAIL_RESET.reopen.clear].sort()).toEqual(["approved", "calculated", "submitted"]);
    expect(TRAIL_RESET.reopen.clear).not.toContain("published");
    expect(TRAIL_RESET.reopen.clear).not.toContain("locked");
    // `reject` xoá đúng vết gửi duyệt — không xoá `approved` (kỳ chưa từng được duyệt ở nhánh này).
    expect(TRAIL_RESET.reject.clear).toEqual(["submitted"]);
  });

  it("(g) cổng `reopen`: đã sinh phiếu ⇒ 004; Paid/Locked ⇒ 004; còn lại cho qua", () => {
    const kindOf = (fn: () => void): { code?: string; kind?: string } => {
      try {
        fn();
      } catch (e) {
        const res = (e as { response?: { code?: string; details?: Array<Record<string, string>> } })
          .response;
        return {
          code: res?.code,
          kind: res?.details?.find((d) => d["field"] === "kind")?.["message"],
        };
      }
      return {};
    };

    const generated = kindOf(() =>
      assertReopenAllowed({ status: "Approved", payslipsGeneratedAt: new Date() }),
    );
    expect(generated.code).toBe("PAYROLL-ERR-004");
    expect(generated.kind).toBe("payslip-already-generated");

    for (const status of ["Paid", "Locked"] as PayrollPeriodStatus[]) {
      const terminal = kindOf(() => assertReopenAllowed({ status, payslipsGeneratedAt: null }));
      expect(terminal.code, status).toBe("PAYROLL-ERR-004");
      expect(terminal.kind, status).toBe("period-terminal");
    }
    // ALLOW đối chứng — thiếu ca này thì hàm luôn-ném cũng làm 3 ca trên xanh.
    for (const status of ["Calculated", "Reviewing", "Approved"] as PayrollPeriodStatus[]) {
      expect(
        () => assertReopenAllowed({ status, payslipsGeneratedAt: null }),
        status,
      ).not.toThrow();
    }
  });
});
