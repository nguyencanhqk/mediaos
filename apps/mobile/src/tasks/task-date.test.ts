import { isDueToday, isOverdue, summarizeTasks } from "./task-date";
import { makeTask as task } from "../test-utils/fixtures";

// Built with the LOCAL-time constructor (not a UTC "Z" string) so the day-boundary assertions are
// timezone-independent — isDueToday compares LOCAL calendar days (matching how the UI shows dates).
const NOW = new Date(2026, 5, 16, 12, 0, 0); // 2026-06-16 12:00 local
const localIso = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m, d, h, 0, 0).toISOString();

describe("isOverdue / isDueToday", () => {
  it("treats a null due date as neither overdue nor due-today", () => {
    expect(isOverdue(null, NOW)).toBe(false);
    expect(isDueToday(null, NOW)).toBe(false);
  });

  it("flags a past due date as overdue", () => {
    expect(isOverdue(localIso(2026, 5, 15), NOW)).toBe(true);
  });

  it("does not flag a future due date as overdue", () => {
    expect(isOverdue(localIso(2026, 5, 17), NOW)).toBe(false);
  });

  it("flags same-calendar-day as due today", () => {
    expect(isDueToday(localIso(2026, 5, 16, 23), NOW)).toBe(true);
    expect(isDueToday(localIso(2026, 5, 17, 1), NOW)).toBe(false);
  });
});

describe("summarizeTasks", () => {
  it("counts only open tasks; completed/approved are excluded", () => {
    const tasks = [
      task({ status: "in_progress" }),
      task({ status: "not_started" }),
      task({ status: "completed" }),
      task({ status: "approved" }),
    ];
    expect(summarizeTasks(tasks, NOW).open).toBe(2);
  });

  it("counts overdue and due-today among open tasks", () => {
    const tasks = [
      task({ status: "in_progress", dueDate: localIso(2026, 5, 15) }), // overdue (yesterday)
      task({ status: "not_started", dueDate: localIso(2026, 5, 16, 20) }), // due today, later
      task({ status: "completed", dueDate: localIso(2026, 5, 15) }), // closed → ignored
    ];
    const summary = summarizeTasks(tasks, NOW);
    expect(summary.open).toBe(2);
    expect(summary.overdue).toBe(1);
    expect(summary.dueToday).toBe(1);
  });
});
