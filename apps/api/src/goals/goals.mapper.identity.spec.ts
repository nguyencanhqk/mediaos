import { describe, expect, it } from "vitest";
import { goalCoreResponseSchema, goalUpdateResponseSchema } from "@mediaos/contracts";
import type { Goal, GoalUpdate } from "../db/schema/goals";
import { toGoalCoreDto, toGoalUpdateDto } from "./goals.mapper";

const ID = "11111111-1111-4111-8111-111111111111";
const goalRow = {
  id: ID,
  companyId: ID,
  goalCode: "G-1",
  name: "Mục tiêu",
  description: null,
  level: "employee",
  departmentId: null,
  projectId: null,
  employeeId: ID,
  parentGoalId: null,
  ownerEmployeeId: ID,
  periodType: "quarter",
  periodStart: "2026-10-01",
  periodEnd: "2026-12-31",
  measureType: "percent",
  targetValue: "100",
  currentValue: "10",
  unit: null,
  progressMode: "manual",
  progressPercent: "10",
  weight: "1",
  status: "Active",
  finalizedAt: null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
} as unknown as Goal;

const updRow = {
  id: ID,
  goalId: ID,
  updateType: "checkin",
  actorUserId: ID,
  oldCurrentValue: null,
  newCurrentValue: "10",
  oldProgressPercent: null,
  newProgressPercent: "10",
  confidence: 70,
  note: null,
  createdAt: new Date("2026-10-02T00:00:00Z"),
} as unknown as GoalUpdate;

describe("S20-GOAL-OWNERCHECKIN-1 — mapper chỉ thêm tên hiển thị + lastCheckinAt", () => {
  it("không có extra ⇒ KHÔNG có khoá ownerName/lastCheckinAt (client cũ parse được)", () => {
    const dto = toGoalCoreDto(goalRow);
    expect("ownerName" in dto).toBe(false);
    expect("lastCheckinAt" in dto).toBe(false);
    expect(goalCoreResponseSchema.safeParse(dto).success).toBe(true);
  });

  it("có extra ⇒ đúng ba trường tên/mốc, không rò trường danh tính khác", () => {
    const dto = toGoalCoreDto(goalRow, {
      ownerName: "Trưởng phòng A",
      lastCheckinAt: "2026-10-02T00:00:00.000Z",
    });
    expect(dto.ownerName).toBe("Trưởng phòng A");
    expect(dto.lastCheckinAt).toBe("2026-10-02T00:00:00.000Z");
    const keys = Object.keys(dto).join(",");
    expect(keys).not.toMatch(/email|phone|employeeCode|fullName/i);
    expect(goalCoreResponseSchema.safeParse(dto).success).toBe(true);
  });

  it("update: actorName qua extra, ngược lại vắng khoá", () => {
    expect("actorName" in toGoalUpdateDto(updRow)).toBe(false);
    const dto = toGoalUpdateDto({ ...updRow, actorName: "Người check-in" });
    expect(dto.actorName).toBe("Người check-in");
    expect(goalUpdateResponseSchema.safeParse(dto).success).toBe(true);
  });
});
