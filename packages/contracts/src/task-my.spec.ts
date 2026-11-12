import { describe, expect, it } from "vitest";
import { MY_TASKS_CLOSED_LIMIT, myTasksQuerySchema } from "./task-my";
import { listTaskCoreQuerySchema } from "./task";

describe("myTasksQuerySchema", () => {
  it("không có tham số ⇒ includeClosed undefined", () => {
    expect(myTasksQuerySchema.parse({})).toEqual({});
  });
  it("nhận 'true'/'false' và boolean, idempotent khi parse hai lần", () => {
    const once = myTasksQuerySchema.parse({ includeClosed: "true" });
    expect(once.includeClosed).toBe(true);
    expect(myTasksQuerySchema.parse(once).includeClosed).toBe(true);
    expect(myTasksQuerySchema.parse({ includeClosed: "false" }).includeClosed).toBe(false);
  });
  it.each(["abc", "", "1", "TRUE", 1])("từ chối rác %j", (v) => {
    expect(myTasksQuerySchema.safeParse({ includeClosed: v }).success).toBe(false);
  });
  it("trần là hằng số dương", () => {
    expect(MY_TASKS_CLOSED_LIMIT).toBe(100);
  });
});

describe("listTaskCoreQuerySchema.goalId", () => {
  const uuid = "0190a1b2-c3d4-7e5f-8a6b-1c2d3e4f5a6b";
  it("nhận uuid", () => {
    expect(listTaskCoreQuerySchema.parse({ goalId: uuid }).goalId).toBe(uuid);
  });
  it("từ chối không phải uuid", () => {
    expect(listTaskCoreQuerySchema.safeParse({ goalId: "not-uuid" }).success).toBe(false);
  });
});
