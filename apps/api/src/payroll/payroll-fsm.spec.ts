import { describe, expect, it } from "vitest";
import type { PayrollPeriodStatus } from "@mediaos/contracts";
import { payrollPeriods } from "../db/schema/payroll";
import {
  assertPeriodTransition,
  assertReopenAllowed,
  IN_PLACE_ACTIONS,
  isAllowedTransition,
  nextStatus,
  PERIOD_TRANSITIONS,
  TRAIL_RESET,
  type PeriodAction,
  type TrailCol,
} from "./payroll-fsm";

/**
 * S13-PAYROLL-BE-1 → 🔁 S15-PAYROLL-DB-2 — FSM kỳ lương, ma trận **64 ô** (8 × 8, SPEC-11 §13.1 bản v2).
 *
 * ⚠️ Spec này CỐ Ý có CẢ ca ALLOW lẫn ca DENY. 50 ca "phải ném" mà không có ca đối chứng "phải KHÔNG
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
  "Published",
  "Paid",
  "Locked",
];

/** Chép TAY từ bảng SPEC-11 §13.1 v2 — 11 ô đổi trạng thái. */
const EXPECTED_MOVES: ReadonlyArray<[PayrollPeriodStatus, PayrollPeriodStatus, PeriodAction]> = [
  ["Draft", "CollectingData", "collect"],
  ["CollectingData", "Calculated", "calculate"],
  ["Calculated", "Reviewing", "submit"],
  ["Reviewing", "Calculated", "reject"],
  ["Reviewing", "Approved", "approve"],
  ["Approved", "Published", "publish"],
  ["Published", "Paid", "complete-batch"],
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
  "complete-batch",
  "lock",
  "reopen",
];

const ALL_TRAIL_COLS: TrailCol[] = [
  "calculated",
  "submitted",
  "approved",
  "payslipsGenerated",
  "published",
  "paid",
  "locked",
];

const key = (from: string, to: string, via: string) => `${from}->${to}:${via}`;

describe("S15-PAYROLL-DB-2 · FSM kỳ lương v2 (SPEC-11 §13.1)", () => {
  it("(a) 11 ô ĐỔI trạng thái — ALLOW đối chứng: không ném", () => {
    expect(EXPECTED_MOVES).toHaveLength(11);
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

  it("(c) 50 ô CẤM (64 − 11 − 3) — ném PAYROLL-ERR-001 kèm from/to", () => {
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
    expect(denied).toHaveLength(50);
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
    expect(fromConst.size).toBe(14);
  });

  it("(d2) v2: `publish` dừng ở Published; `Paid` CHỈ vào được bằng `complete-batch`", () => {
    expect(nextStatus("Approved", "publish")).toBe("Published");
    const intoPaid = PERIOD_TRANSITIONS.filter((t) => t.to === "Paid");
    expect(intoPaid).toEqual([{ action: "complete-batch", from: "Published", to: "Paid" }]);
    // ÂM: `lock` không nhảy cóc từ Published (khoá kỳ khi chưa chi trả xong).
    expect(isAllowedTransition("Published", "Locked", "lock")).toBe(false);
    // DƯƠNG đối chứng: `lock` vẫn hợp lệ từ Paid.
    expect(isAllowedTransition("Paid", "Locked", "lock")).toBe(true);
  });

  it("(e) TRAIL_RESET đủ 10 action, `clear ∩ set = ∅`, không thiếu `generate-payslips`/`complete-batch`", () => {
    expect(Object.keys(TRAIL_RESET).sort()).toEqual([...ALL_ACTIONS].sort());
    // Ô này là lý do bảng RESET của plan v1 sai: thiếu nó, BE-2 tự chế cặp ghi ⇒ 23514 từ
    // `payroll_periods_generated_pair_check`.
    expect(TRAIL_RESET["generate-payslips"].set).toEqual(["payslipsGenerated"]);
    // Thiếu `paid` ⇒ UPDATE status='Paid' không kèm paid_by/at ⇒ 23514 từ `paid_pair_check`.
    expect(TRAIL_RESET["complete-batch"]).toEqual({ clear: [], set: ["paid"] });
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

  it("(e2) CENSUS trail → cột drizzle THẬT: mọi `${col}By`/`${col}At` là cột của payrollPeriods", () => {
    // `applyTransitionTx` ghi `patch[`${col}By`]` động và drizzle BỎ QUA IM LẶNG khoá không phải cột.
    // Đổi tên `paidBy` trong schema mà quên ở đây = đường hoàn tất đợt ăn 23514 thay vì ghi vết.
    const used = new Set<TrailCol>();
    for (const via of ALL_ACTIONS) {
      for (const c of [...TRAIL_RESET[via].clear, ...TRAIL_RESET[via].set]) used.add(c);
    }
    expect([...used].sort()).toEqual([...ALL_TRAIL_COLS].sort());
    const cols = payrollPeriods as unknown as Record<string, unknown>;
    for (const c of ALL_TRAIL_COLS) {
      expect(cols[`${c}By`], `${c}By`).toBeDefined();
      expect(cols[`${c}At`], `${c}At`).toBeDefined();
    }
    // ĐỐI CHỨNG: khoá không tồn tại phải ra undefined (kẻo phép thử trên luôn xanh).
    expect(cols["nonexistentTrailBy"]).toBeUndefined();
  });

  it("(f) `reopen` xoá ĐÚNG 3 cặp vết — KHÔNG chạm published/paid/locked", () => {
    expect([...TRAIL_RESET.reopen.clear].sort()).toEqual(["approved", "calculated", "submitted"]);
    expect(TRAIL_RESET.reopen.clear).not.toContain("published");
    expect(TRAIL_RESET.reopen.clear).not.toContain("paid");
    expect(TRAIL_RESET.reopen.clear).not.toContain("locked");
    // `reject` xoá đúng vết gửi duyệt — không xoá `approved` (kỳ chưa từng được duyệt ở nhánh này).
    expect(TRAIL_RESET.reject.clear).toEqual(["submitted"]);
  });

  it("(g) cổng `reopen`: đã sinh phiếu ⇒ 004; Published/Paid/Locked ⇒ 004; còn lại cho qua", () => {
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

    // `Published` với cờ NULL là dữ liệu bất khả (publish đòi đã sinh phiếu) — vế hai vẫn phải chặn.
    for (const status of ["Published", "Paid", "Locked"] as PayrollPeriodStatus[]) {
      const terminal = kindOf(() => assertReopenAllowed({ status, payslipsGeneratedAt: null }));
      expect(terminal.code, status).toBe("PAYROLL-ERR-004");
      expect(terminal.kind, status).toBe("period-terminal");
    }
    // ALLOW đối chứng — thiếu ca này thì hàm luôn-ném cũng làm các ca trên xanh.
    for (const status of ["Calculated", "Reviewing", "Approved"] as PayrollPeriodStatus[]) {
      expect(
        () => assertReopenAllowed({ status, payslipsGeneratedAt: null }),
        status,
      ).not.toThrow();
    }
  });
});
