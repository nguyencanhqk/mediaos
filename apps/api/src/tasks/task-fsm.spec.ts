import { describe, expect, it } from "vitest";
import { coalesceTaskStatus, deriveStatusTimestamps, evaluateTransition } from "./task-fsm";

/**
 * S5-TASK-PIPELINE-1 (lane fsm) — FSM transition table thuần theo SPEC-06 §6.10.1 (nới 18/07/2026,
 * DECISIONS-03 D-18). Unit, KHÔNG DB.
 *
 * Luật mới: 4 status hoạt động (Todo · In Progress · In Review · Done) thông nhau MỌI HƯỚNG + → Cancelled;
 * Cancelled → {Todo, In Progress} (khôi phục). Ca từ chối còn lại DUY NHẤT: Cancelled → In Review/Done
 * (409 WORKFLOW-INVALID — SPEC-06 §6.10.1). Same-status = no-op (kể cả Cancelled). Rời Done ⇒ clear
 * completed_at/by; rời Cancelled ⇒ clear cancelled_at (D-19).
 */
describe("task-fsm — evaluateTransition (SPEC-06 §6.10.1)", () => {
  it("coalesce from=NULL → 'Todo' (hàng legacy chưa backfill, CHECK 0478 cho phép NULL)", () => {
    expect(coalesceTaskStatus(null)).toBe("Todo");
    expect(coalesceTaskStatus(undefined)).toBe("Todo");
    expect(coalesceTaskStatus("In Progress")).toBe("In Progress");
  });

  // ── Transition HỢP LỆ — nhảy cấp mọi hướng giữa 4 status hoạt động (D-18) ─────
  it.each([
    ["Todo", "In Progress"],
    ["Todo", "In Review"], // nhảy cấp — trước 18/07 là 409
    ["Todo", "Done"], // nhảy cấp — thao tác hằng ngày trên board (bẫy M3)
    ["Todo", "Cancelled"],
    ["In Progress", "Todo"], // kéo ngược — trước 18/07 là 409
    ["In Progress", "In Review"],
    ["In Progress", "Done"],
    ["In Progress", "Cancelled"],
    ["In Review", "Todo"], // kéo ngược — trước 18/07 là 409
    ["In Review", "In Progress"],
    ["In Review", "Done"],
    ["In Review", "Cancelled"],
    ["Done", "Todo"], // reopen — trước 18/07 Done là ngõ cụt
    ["Done", "In Progress"], // reopen (trả-về-sửa trong sản xuất video)
    ["Done", "In Review"],
    ["Done", "Cancelled"],
  ] as const)("cho phép %s → %s", (from, to) => {
    const r = evaluateTransition(from, to);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.noop).toBe(false);
  });

  // ── Cancelled khôi phục được (D-18) — chứng minh early-return 422 đã BỎ (bẫy M4) ──
  it.each([
    ["Cancelled", "Todo"],
    ["Cancelled", "In Progress"],
  ] as const)("khôi phục %s → %s hợp lệ", (from, to) => {
    const r = evaluateTransition(from, to);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.noop).toBe(false);
  });

  // ── Ca từ chối CÒN LẠI duy nhất: Cancelled → In Review/Done (§6.10.1 dòng cuối) ──
  it.each([
    ["Cancelled", "In Review"],
    ["Cancelled", "Done"],
  ] as const)("chặn %s → %s (409 WORKFLOW-INVALID — tra BẢNG, không early-return)", (from, to) => {
    const r = evaluateTransition(from, to);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("TASK-ERR-WORKFLOW-INVALID");
      expect(r.httpStatus).toBe(409);
    }
  });

  // ── NULL coalesce → áp bảng Todo (giờ Todo → mọi đích đều hợp lệ) ─────────────
  it("from=NULL coi như Todo: NULL → In Progress và NULL → Done đều hợp lệ (luật mới)", () => {
    expect(evaluateTransition(null, "In Progress").ok).toBe(true);
    expect(evaluateTransition(null, "Done").ok).toBe(true);
  });

  // ── No-op same-value: from===to → ok + noop cho CẢ 5 status (kể cả Cancelled) ──
  it.each(["Todo", "In Progress", "In Review", "Done", "Cancelled"] as const)(
    "no-op %s → %s (same value) → ok + noop=true, không ghi/không event",
    (s) => {
      const r = evaluateTransition(s, s);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.noop).toBe(true);
    },
  );
});

describe("task-fsm — deriveStatusTimestamps (D-19: rời Done/Cancelled xoá mốc)", () => {
  it("vào Done ⇒ completedAt 'now'; vào Cancelled ⇒ cancelledAt 'now'", () => {
    expect(deriveStatusTimestamps("In Review", "Done")).toEqual({
      completedAt: "now",
      cancelledAt: "keep",
    });
    expect(deriveStatusTimestamps("Todo", "Cancelled")).toEqual({
      completedAt: "keep",
      cancelledAt: "now",
    });
  });

  it("rời Done ⇒ completedAt 'clear' (repo clear cả completed_by); rời Cancelled ⇒ cancelledAt 'clear'", () => {
    expect(deriveStatusTimestamps("Done", "In Progress")).toEqual({
      completedAt: "clear",
      cancelledAt: "keep",
    });
    expect(deriveStatusTimestamps("Cancelled", "Todo")).toEqual({
      completedAt: "keep",
      cancelledAt: "clear",
    });
  });

  it("Done → Cancelled ⇒ clear completed VÀ set cancelled (cùng lúc)", () => {
    expect(deriveStatusTimestamps("Done", "Cancelled")).toEqual({
      completedAt: "clear",
      cancelledAt: "now",
    });
  });

  it("chuyển giữa status thường ⇒ giữ nguyên cả hai mốc", () => {
    expect(deriveStatusTimestamps("Todo", "In Progress")).toEqual({
      completedAt: "keep",
      cancelledAt: "keep",
    });
  });
});
