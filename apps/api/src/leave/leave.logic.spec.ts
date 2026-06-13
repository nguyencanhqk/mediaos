/**
 * G11-2 — RED suite for the pure leave-day counter. Weekend/off-day exclusion is the core rule that
 * keeps quota deduction honest, so it is pinned independently of any DB.
 */

import { describe, expect, it } from "vitest";
import { countLeaveDays } from "./leave.logic";

const MON_FRI = [1, 2, 3, 4, 5];
// 2024-06-03 = Mon, 06-07 = Fri, 06-08 = Sat, 06-09 = Sun.

describe("countLeaveDays", () => {
  it("counts a single working day as 1", () => {
    expect(countLeaveDays("2024-06-03", "2024-06-03", MON_FRI)).toBe(1);
  });

  it("counts a full Mon–Fri week as 5", () => {
    expect(countLeaveDays("2024-06-03", "2024-06-07", MON_FRI)).toBe(5);
  });

  it("excludes the weekend inside a Mon–Sun range (5, not 7)", () => {
    expect(countLeaveDays("2024-06-03", "2024-06-09", MON_FRI)).toBe(5);
  });

  it("returns 0 for a weekend-only range under a Mon–Fri schedule", () => {
    expect(countLeaveDays("2024-06-08", "2024-06-09", MON_FRI)).toBe(0);
  });

  it("counts Saturday when the schedule works six days", () => {
    expect(countLeaveDays("2024-06-08", "2024-06-09", [1, 2, 3, 4, 5, 6])).toBe(1); // Sat only
  });

  it("returns 0 when start is after end (defensive)", () => {
    expect(countLeaveDays("2024-06-09", "2024-06-03", MON_FRI)).toBe(0);
  });
});
