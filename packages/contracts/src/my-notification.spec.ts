import { describe, expect, it } from "vitest";
import { markAllNotificationsReadRequestSchema as schema } from "./my-notification";

describe("markAllNotificationsReadRequestSchema (S20-NOTI-PRIORITYFILTER-1)", () => {
  it("tương thích ngược: body rỗng và body cũ vẫn hợp lệ", () => {
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ source_module: "TASK" })).toEqual({ source_module: "TASK" });
  });

  it("nhận priority hợp lệ, từ chối priority rác", () => {
    expect(schema.parse({ priority: "Normal" }).priority).toBe("Normal");
    expect(schema.safeParse({ priority: "Bogus" }).success).toBe(false);
  });

  it("created_before IDEMPOTENT dưới pipe kép: parse lại kết quả đã là Date vẫn hợp lệ", () => {
    const first = schema.parse({ created_before: "2026-01-02T00:00:00Z" });
    expect(first.created_before).toBeInstanceOf(Date);
    const second = schema.parse(first);
    expect(second.created_before?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("created_before rác bị từ chối", () => {
    expect(schema.safeParse({ created_before: "nope" }).success).toBe(false);
  });

  it("ĐO: khoá lạ bị STRIP lặng lẽ (API cũ bỏ qua priority) — lý do tách PR FE sau API", () => {
    const parsed = schema.parse({ priority_x: "High" } as Record<string, unknown>);
    expect(parsed).toEqual({});
  });
});
