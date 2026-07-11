import { describe, expect, it } from "vitest";
import { coalesceTaskStatus, evaluateTransition } from "./task-fsm";

/**
 * S4-TASK-BE-3 — FSM transition table thuần (SPEC-06 §14.11:1458-1472 nguồn gốc). Unit, KHÔNG DB.
 * Khoá bảng transition + mã lỗi slug (409 WORKFLOW-INVALID · 422 TASK-CLOSED) + coalesce NULL→Todo + no-op.
 */
describe("task-fsm — evaluateTransition (SPEC-06 §14.11)", () => {
  it("coalesce from=NULL → 'Todo' (hàng legacy chưa backfill, CHECK 0478 cho phép NULL)", () => {
    expect(coalesceTaskStatus(null)).toBe("Todo");
    expect(coalesceTaskStatus(undefined)).toBe("Todo");
    expect(coalesceTaskStatus("In Progress")).toBe("In Progress");
  });

  // ── Transition HỢP LỆ (bảng §14.11) ─────────────────────────────────────────
  it.each([
    ["Todo", "In Progress"],
    ["Todo", "Cancelled"],
    ["In Progress", "In Review"],
    ["In Progress", "Done"],
    ["In Progress", "Cancelled"],
    ["In Review", "In Progress"],
    ["In Review", "Done"],
    ["In Review", "Cancelled"],
  ] as const)("cho phép %s → %s", (from, to) => {
    const r = evaluateTransition(from, to);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.noop).toBe(false);
  });

  // ── NULL coalesce → áp bảng Todo ────────────────────────────────────────────
  it("from=NULL coi như Todo: NULL → In Progress hợp lệ, NULL → Done sai (409)", () => {
    expect(evaluateTransition(null, "In Progress").ok).toBe(true);
    const bad = evaluateTransition(null, "Done");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("TASK-ERR-WORKFLOW-INVALID");
  });

  // ── Transition SAI bảng → 409 TASK-ERR-WORKFLOW-INVALID ─────────────────────
  it.each([
    ["Todo", "Done"],
    ["Todo", "In Review"],
    ["In Progress", "Todo"],
    ["In Review", "Todo"],
    ["Done", "In Progress"], // reopen mặc định TẮT (hard-off)
    ["Done", "Todo"],
  ] as const)("chặn %s → %s (409 WORKFLOW-INVALID)", (from, to) => {
    const r = evaluateTransition(from, to);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("TASK-ERR-WORKFLOW-INVALID");
      expect(r.httpStatus).toBe(409);
    }
  });

  // ── Cancelled terminal → 422 TASK-ERR-TASK-CLOSED (mọi đích, kể cả chính nó) ──
  it.each(["In Progress", "Done", "Todo", "Cancelled", "In Review"] as const)(
    "Cancelled → %s là terminal (422 TASK-CLOSED)",
    (to) => {
      const r = evaluateTransition("Cancelled", to);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("TASK-ERR-TASK-CLOSED");
        expect(r.httpStatus).toBe(422);
      }
    },
  );

  // ── No-op same-value (open q #6): from===to (KHÔNG Cancelled) → ok + noop ────
  it.each(["Todo", "In Progress", "In Review", "Done"] as const)(
    "no-op %s → %s (same value) → ok + noop=true",
    (s) => {
      const r = evaluateTransition(s, s);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.noop).toBe(true);
    },
  );
});
